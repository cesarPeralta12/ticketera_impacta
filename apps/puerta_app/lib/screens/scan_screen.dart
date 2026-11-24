import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../app_services.dart';
import '../code_tracker.dart';
import '../door_service.dart';
import '../feedback.dart';
import '../models.dart';
import '../nfc_reader.dart';
import '../nfc_uid.dart';
import '../scan_cooldown.dart';
import '../settings.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';
import '../external_code.dart' show externalKeyCandidates;
import '../validator.dart' show extractTicketCode;
import 'consult_sheet.dart';
import 'result_overlay.dart';
import 'scan_widgets.dart';

/// Pantalla de lectura. Una sola pantalla para todo: la cámara lee QR y códigos de barras a la vez y, si la función admite
/// NFC, también queda atento a una pulsera o tarjeta, sin que el portero tenga que cambiar de modo.
class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key, required this.service, required this.meta, required this.methods, required this.assignment, this.previewOverride});

  /// Solo para pruebas visuales: en lugar de la cámara y del NFC (que necesitan el teléfono), se dibuja esto.
  final Widget? previewOverride;

  final DoorService service;
  final SessionMeta meta;
  /// Métodos que admite la función: según ellos se activan la cámara (QR, barras) y el NFC.
  final List<AccessMethod> methods;
  final Assignment assignment;

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  bool get _testing => widget.previewOverride != null;
  bool get _hasQr => widget.methods.contains(AccessMethod.qr);
  bool get _hasBarcode => widget.methods.contains(AccessMethod.barcode);
  bool get _hasNfc => widget.methods.contains(AccessMethod.nfc);
  bool get _useCamera => _hasQr || _hasBarcode;

  late final MobileScannerController? _camera = !_useCamera || _testing
      ? null
      : MobileScannerController(
          formats: [
            if (_hasQr) BarcodeFormat.qrCode,
            if (_hasBarcode) ...const [BarcodeFormat.code128, BarcodeFormat.code39, BarcodeFormat.ean13, BarcodeFormat.ean8],
          ],
          // "noDuplicates" no vuelve a leer el mismo QR hasta que la cámara vea otro: había que salir y volver a entrar a la
          // pantalla. Con "normal" sigue leyendo; las repeticiones las filtra la pausa por entrada (ScanCooldown).
          detectionSpeed: DetectionSpeed.normal,
          // Más seguido que antes para que el marco siga al código con fluidez; las repeticiones las filtra la pausa por
          // entrada (ScanCooldown), no esta cadencia.
          detectionTimeoutMs: 150,
        );

  late AppSettings _settings;
  late DoorFeedback _feedback;
  bool _servicesReady = false;

  ScanOutcome? _outcome;
  int _serial = 0;
  bool _locked = false;
  Timer? _clearTimer;
  bool _busy = false;
  String? _lastRaw;
  DateTime _lastAt = DateTime.fromMillisecondsSinceEpoch(0);

  /// Entradas recién procesadas: la cámara no las vuelve a leer sola (ver ScanCooldown).
  final ScanCooldown _cooldown = ScanCooldown();
  String? _nfcMessage;
  Timer? _syncTimer;

  /// Dónde está en la pantalla el código que ve la cámara (el marco lo sigue). Nulo: marco fijo en el centro.
  Rect? _target;
  Timer? _targetTimer;

  Gate? get _gate => widget.meta.gate;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final app = AppServices.of(context);
    _settings = app.settings;
    _feedback = app.feedback;
    if (!_servicesReady) {
      _servicesReady = true;
      _applyWakelock();
      _settings.addListener(_applyWakelock);
    }
  }

  void _applyWakelock() {
    // Sin el plugin (pruebas) o sin permiso, la pantalla simplemente puede apagarse: no es un error de la lectura.
    (_settings.keepAwake ? WakelockPlus.enable() : WakelockPlus.disable()).catchError((_) {});
  }

  @override
  void initState() {
    super.initState();
    if (_testing) return;
    if (_hasNfc) _startNfc();
    // Mientras se lee, sube las lecturas en cuanto hay internet.
    _syncTimer = Timer.periodic(const Duration(seconds: 15), (_) => widget.service.sync(widget.meta.sessionId).catchError((_) => false));
  }

  @override
  void dispose() {
    _clearTimer?.cancel();
    _targetTimer?.cancel();
    _syncTimer?.cancel();
    _settings.removeListener(_applyWakelock);
    WakelockPlus.disable().catchError((_) {});
    _camera?.dispose();
    if (_hasNfc && !_testing) NfcManager.instance.stopSession().catchError((_) {});
    super.dispose();
  }

  /// El marco sigue al código que ve la cámara: se ubica con sus esquinas y, si deja de verse un momento, vuelve al centro.
  void _track(BarcodeCapture capture) {
    if (_outcome != null || _locked) return;
    final screen = MediaQuery.sizeOf(context);
    final image = uprightImageSize(capture.size, screen);
    // Con varios códigos a la vista, el más cercano al centro (es el que el portero está apuntando).
    Rect? best;
    var bestDistance = double.infinity;
    for (final b in capture.barcodes) {
      final rect = codeRectOnScreen(corners: b.corners, image: image, screen: screen);
      if (rect == null) continue;
      final distance = (rect.center - screen.center(Offset.zero)).distance;
      if (distance < bestDistance) {
        best = rect;
        bestDistance = distance;
      }
    }
    _targetTimer?.cancel();
    if (best == null) return;
    setState(() => _target = best);
    _targetTimer = Timer(const Duration(milliseconds: 450), () {
      if (mounted) setState(() => _target = null);
    });
  }

  void _dismiss() {
    _clearTimer?.cancel();
    if (mounted) setState(() => _outcome = null);
  }

  void _show(ScanOutcome outcome) {
    _clearTimer?.cancel();
    setState(() {
      _outcome = outcome;
      _serial++;
      _locked = false;
    });
    _clearTimer = Timer(_shownFor(outcome), _dismiss);
  }

  Duration _shownFor(ScanOutcome o) {
    if (!o.verdict.ok) return const Duration(milliseconds: 4200);
    return o.movement == Movement.exit ? const Duration(milliseconds: 2000) : const Duration(milliseconds: 2600);
  }

  /// Modo consulta: solo mira dónde está la persona; no registra ingresos, salidas ni rechazos.
  bool _consultOnly = false;

  Future<void> _consultRead(String raw, AccessMethod? method) async {
    _busy = true;
    try {
      if (method != null) _feedback.detected();
      final (outcome, view) = await widget.service.consult(widget.meta, raw, method);
      if (!mounted) return;
      await showConsultSheet(context, outcome: outcome, view: view, gateName: _gate?.name, zoneName: _gate?.zoneName);
    } finally {
      _busy = false;
      // La cámara sigue viendo el mismo código: se ignora un momento para que la consulta no reaparezca sola.
      _lastRaw = raw;
      _lastAt = DateTime.now();
    }
  }

  Future<void> _handle(String raw, AccessMethod? method) async {
    if (_busy) {
      // Mientras se atiende una lectura la cámara sigue viendo el QR: se anota para saber cuándo lo retiran.
      if (method != null) {
        final seen = extractTicketCode(raw) ?? externalKeyCandidates(raw, widget.meta.codeRules).firstOrNull;
        if (seen != null) _cooldown.saw(seen, DateTime.now());
      }
      return;
    }
    if (_consultOnly) {
      final at = DateTime.now();
      if (method != null && raw == _lastRaw && at.difference(_lastAt) < const Duration(seconds: 4)) return;
      return _consultRead(raw, method);
    }
    // La cámara ve el mismo código muchos cuadros seguidos: se ignora si es el mismo de hace un momento.
    final now = DateTime.now();
    // Una entrada recién procesada no se vuelve a leer sola mientras la cámara siga viendo su QR (y el de una entrada
    // dinámica cambia cada 30 s), pero sí cuando se retira y vuelve a pasar. Escribir el código a mano (method == null)
    // siempre se atiende. Una entrada de otro proveedor no tiene código de iPass en lo leído: la pausa va por la clave
    // limpia de su código.
    final code = extractTicketCode(raw) ?? externalKeyCandidates(raw, widget.meta.codeRules).firstOrNull;
    if (method != null && code != null && _cooldown.blocked(code, now)) return;
    // Un QR sin entrada reconocible (basura, de otro sistema): solo se repite pasado un momento.
    if (method != null && code == null && raw == _lastRaw && now.difference(_lastAt) < const Duration(seconds: 3)) return;
    if (method == null && code != null) _cooldown.release(code);
    _lastRaw = raw;
    _lastAt = now;
    _busy = true;
    try {
      _clearTimer?.cancel();
      if (method != null) _feedback.detected();
      if (mounted) {
        setState(() {
          _outcome = null;
          _locked = true;
        });
      }
      final outcome = await widget.service.inspect(widget.meta, raw, method);
      if (!mounted) return;

      var shown = outcome;
      if (outcome.verdict.ok) {
        final movement = outcome.movement ?? Movement.entry;
        // Un ingreso lo confirma el portero (ve los datos y decide); una salida o un paso de zona se registra solo,
        // y con "ingreso rápido" también el ingreso.
        final ask = !_settings.autoAccept && (movement == Movement.entry || movement == Movement.reentry);
        var accepted = true;
        var declinedExit = false;
        if (outcome.askExit) {
          // La entrada ya ingresó: ¿la persona está saliendo? (aunque esté activado el ingreso rápido)
          final choice = await showExitSheet(context, outcome: outcome);
          accepted = choice == ExitChoice.exit;
          declinedExit = choice == ExitChoice.used;
        } else if (ask) {
          accepted = await showConfirmSheet(context, outcome: outcome, sectionName: widget.meta.sections[outcome.ticket!.sectionId], gateName: widget.meta.gate?.name);
        }
        if (!mounted) return;
        if (declinedExit) {
          // "No es una salida": se trata como una entrada que ya se usó.
          shown = await widget.service.declineExit(widget.meta, raw, method, outcome);
          if (code != null) _cooldown.block(code, CooldownFor.rejected, DateTime.now());
        } else if (accepted) {
          shown = await widget.service.confirm(widget.meta, raw, method);
          if (code != null) _cooldown.block(code, shown.movement == Movement.exit ? CooldownFor.exited : CooldownFor.accepted, DateTime.now());
          // Sube el movimiento al servidor de una vez (si hay internet), para que el panel lo vea en vivo.
          unawaited(widget.service.sync(widget.meta.sessionId).catchError((_) => false));
        } else {
          // Cancelada o se acabó el tiempo: la entrada sigue válida. Se espera unos segundos antes de volver a leerla
          // sola (si no, el diálogo reaparece al instante); escribir el código a mano la atiende ya.
          if (code != null) _cooldown.block(code, CooldownFor.cancelled, DateTime.now());
          _lastRaw = null;
          setState(() => _locked = false);
          ScaffoldMessenger.of(context)
            ..clearSnackBars()
            ..showSnackBar(const SnackBar(content: Text('Lectura cancelada. La entrada no se marcó como usada.')));
          return;
        }
      } else {
        if (code != null) _cooldown.block(code, CooldownFor.rejected, DateTime.now());
      }
      _feedback.outcome(shown);
      _show(shown);
    } finally {
      _busy = false;
      if (mounted && _outcome == null && _locked) setState(() => _locked = false);
    }
  }

  Future<void> _startNfc() async {
    final availability = await NfcManager.instance.checkAvailability();
    if (availability != NfcAvailability.enabled) {
      if (mounted) {
        setState(() => _nfcMessage = availability == NfcAvailability.disabled
            ? 'El NFC está apagado. Actívalo en los ajustes del teléfono.'
            : 'Este teléfono no tiene NFC.');
      }
      return;
    }
    await NfcManager.instance.startSession(
      pollingOptions: {NfcPollingOption.iso14443, NfcPollingOption.iso15693},
      onDiscovered: (tag) async {
        // 1) Tarjeta vinculada en el canje: se reconoce por su número de serie (sin leer ni escribir nada en ella).
        // 2) Pulsera grabada con el código de la entrada (la forma anterior): el código viaja en su texto.
        final uid = uidOf(tag);
        final linked = uid == null ? null : await widget.service.ticketByNfcUid(widget.meta.sessionId, uid);
        final code = linked?.code ?? codeFromTag(tag);
        if (code == null) {
          if (mounted) {
            final bad = ScanOutcome(
              verdict: ScanVerdict.invalid,
              detail: uid != null ? 'Esta tarjeta no está vinculada a ninguna entrada. Actualiza los datos si se canjeó hace poco.' : 'La etiqueta no tiene una entrada.',
            );
            _feedback.outcome(bad);
            _show(bad);
          }
        } else {
          await _handle(code, AccessMethod.nfc);
        }
        // En iPhone cada lectura cierra la sesión: se vuelve a abrir para la siguiente.
        if (defaultTargetPlatform == TargetPlatform.iOS && mounted) {
          await NfcManager.instance.stopSession();
          await _startNfc();
        }
      },
    );
  }

  /// Código escrito en el campo de la pantalla (respaldo si el lector falla). Siempre se atiende.
  Future<void> _typedCode(String code) async {
    if (code.trim().isNotEmpty) await _handle(code.trim(), null);
  }

  /// Qué debe hacer el portero, según lo que admite la función.
  String get _hint {
    final what = [if (_hasQr) 'al QR', if (_hasBarcode) 'al código de barras'].join(' o ');
    return _hasNfc ? 'Apunta $what\no acerca la pulsera o tarjeta' : 'Apunta $what de la entrada';
  }

  Color get _gateColor => switch (_gate?.direction ?? GateDirection.inward) {
        GateDirection.inward => Brand.green,
        GateDirection.outward => Brand.amber,
        GateDirection.both => Brand.blue,
      };

  String get _gateLabel {
    final g = _gate;
    if (g == null) return 'Entrada';
    final base = g.direction == GateDirection.both ? 'Entrada y salida' : g.direction.label;
    return g.zoneName != null ? '$base · ${g.zoneName}' : base;
  }

  @override
  Widget build(BuildContext context) {
    final style = _outcome == null ? null : OutcomeStyle.of(_outcome!);
    final frameColor = style?.color ?? (_locked ? Brand.highlight : Colors.white);
    final zoneLabel = (_outcome?.verdict.ok ?? false) && (_gate?.zoneId != null) && _outcome?.movement != Movement.exit ? (_gate?.zoneName ?? _gate?.name) : null;

    return Scaffold(
      backgroundColor: Colors.black,
      // El teclado sube el campo del código; no encoge la cámara.
      resizeToAvoidBottomInset: false,
      body: Stack(
        fit: StackFit.expand,
        children: [
          // 1. Cámara o espera de NFC
          if (_testing && _useCamera)
            widget.previewOverride!
          else if (_camera != null)
            MobileScanner(
              controller: _camera,
              onDetect: (capture) {
                _track(capture);
                // El tipo de código decide el método: un QR es «QR»; cualquier código de barras, «Código de barras».
                final read = capture.barcodes.where((b) => b.rawValue != null).firstOrNull;
                if (read != null) _handle(read.rawValue!, read.format == BarcodeFormat.qrCode ? AccessMethod.qr : AccessMethod.barcode);
              },
              errorBuilder: (context, error) => Center(
                child: Padding(
                  padding: const EdgeInsets.all(30),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.no_photography_outlined, size: 64, color: Brand.red),
                      const SizedBox(height: 14),
                      const Text('No se pudo usar la cámara', textAlign: TextAlign.center, style: Type.title),
                      const SizedBox(height: 8),
                      Text('Revisa el permiso de la cámara en los ajustes del teléfono.\n(${error.errorCode.name})', textAlign: TextAlign.center, style: Type.muted),
                    ],
                  ),
                ),
              ),
            )
          else
            Container(color: Brand.ink, child: NfcWaiting(message: _nfcMessage)),

          // 2. Sombras arriba y abajo para que los controles se lean sobre la cámara
          IgnorePointer(
            child: Column(
              children: [
                Container(height: 190, decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Colors.black.withValues(alpha: 0.82), Colors.transparent]))),
                const Spacer(),
                Container(height: 150, decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.bottomCenter, end: Alignment.topCenter, colors: [Colors.black.withValues(alpha: 0.9), Colors.transparent]))),
              ],
            ),
          ),

          // 3. Visor
          if (_useCamera) ScanFrame(color: frameColor, locked: _locked || _outcome != null, target: _outcome == null ? _target : null),

          // 4. Barra superior
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  RoundIconButton(icon: Icons.arrow_back_rounded, tooltip: 'Volver', onTap: () => Navigator.of(context).maybePop()),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(top: 1),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(widget.meta.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: Type.title.copyWith(fontSize: 17)),
                          const SizedBox(height: 6),
                          Wrap(
                            spacing: 6,
                            runSpacing: 6,
                            children: [
                              Pill(_gate == null ? _gateLabel : '${_gate!.name} · $_gateLabel', icon: (_gate?.direction ?? GateDirection.inward).icon, color: _gateColor, small: true),
                              ListenableBuilder(
                                listenable: _settings,
                                builder: (context, _) => _settings.autoAccept && !_consultOnly ? const Pill('Ingreso rápido', icon: Icons.bolt_rounded, color: Brand.highlight, small: true) : const SizedBox.shrink(),
                              ),
                              if (_hasNfc && _useCamera) Pill(_nfcMessage == null ? 'NFC activo' : 'NFC no disponible', icon: Icons.nfc_rounded, color: _nfcMessage == null ? Brand.violet : Brand.amber, small: true),
                              if (_consultOnly) const Pill('Solo consulta', icon: Icons.visibility_outlined, color: Brand.violet, small: true),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  if (_camera != null)
                    ValueListenableBuilder<MobileScannerState>(
                      valueListenable: _camera,
                      builder: (context, state, _) => RoundIconButton(
                        icon: state.torchState == TorchState.on ? Icons.flashlight_on_rounded : Icons.flashlight_off_rounded,
                        active: state.torchState == TorchState.on,
                        tooltip: 'Linterna',
                        onTap: () => _camera.toggleTorch(),
                      ),
                    ),
                  const SizedBox(width: 8),
                  RoundIconButton(
                    icon: Icons.visibility_outlined,
                    active: _consultOnly,
                    tooltip: _consultOnly ? 'Volver a registrar' : 'Solo consultar (no registra)',
                    onTap: () => setState(() => _consultOnly = !_consultOnly),
                  ),
                  const SizedBox(width: 8),
                  ListenableBuilder(
                    listenable: _settings,
                    builder: (context, _) => RoundIconButton(
                      icon: _settings.sound ? Icons.volume_up_rounded : Icons.volume_off_rounded,
                      active: _settings.sound,
                      tooltip: 'Sonido',
                      onTap: () => _settings.setSound(!_settings.sound),
                    ),
                  ),
                ],
              ),
            ),
          ),

          // 5. Instrucción sobre el visor
          if (_useCamera && _outcome == null && !_locked)
            Align(
              alignment: const Alignment(0, 0.52),
              child: IgnorePointer(
                child: Text(_hint, textAlign: TextAlign.center, style: Type.body.copyWith(color: Colors.white70, fontWeight: FontWeight.w600)),
              ),
            ),

          // 6. Campo para escribir el código y últimas lecturas (los ingresos y el aforo no se muestran aquí: están en los
          // ajustes, con contraseña)
          Align(
            alignment: Alignment.bottomCenter,
            child: AnimatedPadding(
              duration: const Duration(milliseconds: 150),
              padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  child: Row(
                    children: [
                      Expanded(child: _CodeField(onSubmit: _typedCode)),
                      const SizedBox(width: 10),
                      Tooltip(
                        message: 'Últimas lecturas',
                        child: PressScale(
                          onTap: () => showRecentScans(context, () => widget.service.recentScans(widget.meta.sessionId)),
                          child: Container(
                            width: 56,
                            height: 56,
                            decoration: BoxDecoration(color: Brand.surface.withValues(alpha: 0.92), borderRadius: BorderRadius.circular(18), border: Border.all(color: Brand.stroke)),
                            child: const Icon(Icons.history_rounded, color: Brand.text),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),

          // 7. Resultado a pantalla completa
          if (_outcome != null)
            Positioned.fill(
              child: ResultOverlay(
                key: ValueKey(_serial),
                outcome: _outcome!,
                zoneLabel: zoneLabel,
                duration: _shownFor(_outcome!),
                onDismiss: _dismiss,
              ),
            ),
        ],
      ),
    );
  }
}

/// Campo para escribir el código de la entrada, siempre a la vista en la pantalla del escáner (respaldo si el lector
/// falla o la entrada está dañada). Acepta el código con o sin guion y en minúsculas.
class _CodeField extends StatefulWidget {
  const _CodeField({required this.onSubmit});

  final Future<void> Function(String code) onSubmit;

  @override
  State<_CodeField> createState() => _CodeFieldState();
}

class _CodeFieldState extends State<_CodeField> {
  final _controller = TextEditingController();
  final _focus = FocusNode();

  @override
  void dispose() {
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final code = _controller.text.trim();
    if (code.isEmpty) return;
    _controller.clear();
    _focus.unfocus();
    await widget.onSubmit(code);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 56,
      decoration: BoxDecoration(color: Brand.surface.withValues(alpha: 0.94), borderRadius: BorderRadius.circular(18), border: Border.all(color: Brand.stroke)),
      child: Row(
        children: [
          const Padding(padding: EdgeInsets.only(left: 14, right: 10), child: Icon(Icons.keyboard_alt_outlined, color: Brand.muted, size: 21)),
          Expanded(
            child: TextField(
              controller: _controller,
              focusNode: _focus,
              textCapitalization: TextCapitalization.characters,
              textInputAction: TextInputAction.send,
              autocorrect: false,
              enableSuggestions: false,
              style: Type.body.copyWith(fontWeight: FontWeight.w700, letterSpacing: 1.2),
              decoration: InputDecoration(
                hintText: 'Escribir el código',
                hintStyle: Type.muted.copyWith(fontSize: 15),
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                filled: false,
                isDense: true,
                contentPadding: EdgeInsets.zero,
              ),
              onSubmitted: (_) => _send(),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(6),
            child: PressScale(
              onTap: _send,
              child: Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(color: Brand.accent, borderRadius: BorderRadius.circular(14)),
                child: const Icon(Icons.arrow_forward_rounded, color: Brand.accentInk),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
