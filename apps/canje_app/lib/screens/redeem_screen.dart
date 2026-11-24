import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:nfc_manager/nfc_manager.dart';

import '../api.dart';
import '../app_services.dart';
import '../card_fingerprint.dart';
import '../code_tracker.dart';
import '../door_service.dart';
import '../external_code.dart' show externalKeyCandidates;
import '../models.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';
import '../validator.dart' show extractTicketCode;
import 'scan_widgets.dart';

/// Canje: se lee la entrada (QR, código de barras o a mano), se muestran sus datos y se acerca la tarjeta o manilla NFC.
/// La app lee el número de serie de la tarjeta y lo vincula a la entrada en el servidor. No se escribe nada en la tarjeta,
/// así que no hay nada que se pueda editar: la puerta reconoce la tarjeta por ese número.
class RedeemScreen extends StatefulWidget {
  const RedeemScreen({super.key, required this.service, required this.meta, required this.assignment});

  final DoorService service;
  final SessionMeta meta;
  final Assignment assignment;

  @override
  State<RedeemScreen> createState() => _RedeemScreenState();
}

enum _Step { scan, review, waiting, working, done, failed }

class _RedeemScreenState extends State<RedeemScreen> {
  final MobileScannerController _camera = MobileScannerController(
    formats: const [BarcodeFormat.qrCode, BarcodeFormat.code128, BarcodeFormat.code39, BarcodeFormat.ean13, BarcodeFormat.ean8],
    detectionSpeed: DetectionSpeed.normal,
    // Más seguido para que el marco siga al código con fluidez; las repeticiones se filtran en _read.
    detectionTimeoutMs: 150,
  );

  _Step _step = _Step.scan;
  TicketRow? _ticket;
  CardFingerprint? _linked;
  bool _looking = false;
  String? _scanError;
  String? _failure;
  String? _nfcProblem;
  String? _lastRaw;
  DateTime _lastAt = DateTime.fromMillisecondsSinceEpoch(0);

  /// Dónde está en la pantalla el código que ve la cámara (el marco lo sigue). Nulo: marco fijo en el centro.
  Rect? _target;
  Timer? _targetTimer;

  String get _sessionId => widget.meta.sessionId;

  /// La entrada ya tiene una tarjeta vinculada: se pregunta si es una reposición.
  bool get _hasCard => _ticket?.nfcUid != null;

  @override
  void dispose() {
    _targetTimer?.cancel();
    _camera.dispose();
    NfcManager.instance.stopSession().catchError((_) {});
    super.dispose();
  }

  String _code(String c) => c.length == 10 ? '${c.substring(0, 5)}-${c.substring(5)}' : c;

  /// El marco sigue al código que ve la cámara: se ubica con sus esquinas y, si deja de verse un momento, vuelve al centro.
  void _track(BarcodeCapture capture) {
    if (_step != _Step.scan) return;
    final screen = MediaQuery.sizeOf(context);
    final image = uprightImageSize(capture.size, screen);
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

  Future<void> _read(String raw) async {
    if (_step != _Step.scan || _looking) return;
    final now = DateTime.now();
    if (raw == _lastRaw && now.difference(_lastAt) < const Duration(seconds: 3)) return;
    _lastRaw = raw;
    _lastAt = now;
    _looking = true;
    try {
      final feedback = AppServices.of(context).feedback;
      final db = widget.service.db;
      final code = extractTicketCode(raw);
      var ticket = code == null ? null : await db.find(_sessionId, code);
      if (ticket == null && widget.meta.codeRules.isNotEmpty) {
        ticket = await db.findByExternalKey(_sessionId, externalKeyCandidates(raw, widget.meta.codeRules));
      }
      if (!mounted) return;
      final problem = _problemWith(ticket);
      if (problem != null) {
        feedback.fail();
        setState(() => _scanError = problem);
        return;
      }
      feedback.detected();
      setState(() {
        _ticket = ticket;
        _linked = null;
        _scanError = null;
        _step = _Step.review;
      });
    } finally {
      _looking = false;
    }
  }

  /// Motivo por el que la entrada no se puede canjear, o null si sí.
  String? _problemWith(TicketRow? t) {
    if (t == null) return 'No está en la lista descargada. Actualiza las entradas si se vendió hace poco.';
    if (t.status == TicketStatus.cancelled) return 'Esta entrada está anulada.';
    if (t.status == TicketStatus.used) return 'Esta entrada ya se usó para ingresar.';
    if (!t.methods.contains(AccessMethod.nfc.api)) {
      return 'Este tipo de entrada no tiene NFC activado en el panel: la puerta no aceptaría la tarjeta.';
    }
    return null;
  }

  Future<void> _manual() async {
    final code = await showManualEntry(context);
    if (code != null && code.trim().isNotEmpty) {
      _lastRaw = null;
      await _read(code.trim());
    }
  }

  void _back() {
    NfcManager.instance.stopSession().catchError((_) {});
    setState(() {
      _step = _Step.scan;
      _ticket = null;
      _linked = null;
      _failure = null;
      _lastRaw = null;
    });
  }

  void _fail(String message) {
    AppServices.of(context).feedback.fail();
    setState(() {
      _failure = message;
      _step = _Step.failed;
    });
  }

  Future<void> _startLink() async {
    final ticket = _ticket;
    if (ticket == null) return;
    final feedback = AppServices.of(context).feedback;
    final availability = await NfcManager.instance.checkAvailability();
    if (availability != NfcAvailability.enabled) {
      setState(() => _nfcProblem = availability == NfcAvailability.disabled ? 'El NFC está apagado. Actívalo en los ajustes del teléfono.' : 'Este teléfono no tiene NFC.');
      return;
    }
    setState(() {
      _nfcProblem = null;
      _failure = null;
      _step = _Step.waiting;
    });
    try {
      await NfcManager.instance.startSession(
        pollingOptions: {NfcPollingOption.iso14443, NfcPollingOption.iso15693},
        onDiscovered: (tag) async {
          // El número de serie se lee de una vez: no hace falta mantener la tarjeta pegada mientras se habla con el servidor.
          final fingerprint = fingerprintOf(tag);
          await NfcManager.instance.stopSession().catchError((_) {});
          if (!mounted) return;
          feedback.detected();
          if (fingerprint == null) {
            _fail('No se pudo leer el número de serie de la tarjeta. Los teléfonos y las tarjetas virtuales no sirven: usa una tarjeta o manilla física.');
            return;
          }
          setState(() => _step = _Step.working);
          try {
            await widget.service.linkNfcCard(sessionId: _sessionId, code: ticket.code, uid: fingerprint.uid, card: fingerprint.toJson(), replace: _hasCard);
            if (!mounted) return;
            feedback.done();
            setState(() {
              _linked = fingerprint;
              _ticket = ticket.copyWith(nfcUid: fingerprint.uid);
              _step = _Step.done;
            });
          } on ApiException catch (e) {
            if (!mounted) return;
            _fail(switch (e.code) {
              _ when e.offline => 'Se necesita internet para vincular la tarjeta. Conéctate e inténtalo otra vez.',
              'UID_IN_USE' => 'Esta tarjeta ya está vinculada a otra entrada${e.detail == null ? '' : ' (${_code(e.detail!)})'}. Usa una tarjeta vacía.',
              _ => e.message,
            });
          }
        },
      );
    } catch (_) {
      if (mounted) _fail('No se pudo leer la tarjeta. Mantenla quieta contra el teléfono e inténtalo otra vez.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Brand.ink,
      body: Stack(
        fit: StackFit.expand,
        children: [
          // La cámara queda siempre debajo: los otros pasos la tapan y mientras tanto sus lecturas se ignoran.
          MobileScanner(
            controller: _camera,
            onDetect: (capture) {
              _track(capture);
              final raw = capture.barcodes.map((b) => b.rawValue).whereType<String>().firstOrNull;
              if (raw != null) _read(raw);
            },
            errorBuilder: (context, error) => Center(child: Padding(padding: const EdgeInsets.all(30), child: Text('No se pudo usar la cámara (${error.errorCode.name}). Revisa el permiso.', textAlign: TextAlign.center, style: Type.muted))),
          ),
          if (_step == _Step.scan) ..._scanLayer() else _stepLayer(),
        ],
      ),
    );
  }

  List<Widget> _scanLayer() => [
        IgnorePointer(child: Container(decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Colors.black.withValues(alpha: 0.8), Colors.transparent, Colors.black.withValues(alpha: 0.85)], stops: const [0, 0.5, 1])))),
        ScanFrame(target: _target),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
            child: Row(
              children: [
                RoundIconButton(icon: Icons.arrow_back_rounded, tooltip: 'Volver', onTap: () => Navigator.of(context).maybePop()),
                const SizedBox(width: 12),
                const Expanded(child: Text('Canjear entrada', style: Type.title)),
              ],
            ),
          ),
        ),
        Align(
          alignment: const Alignment(0, 0.52),
          child: IgnorePointer(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 28),
              child: Text(_scanError ?? 'Lee el QR o el código de barras de la entrada', textAlign: TextAlign.center, style: Type.body.copyWith(color: _scanError == null ? Colors.white70 : const Color(0xFFFFC2C8), fontWeight: FontWeight.w600)),
            ),
          ),
        ),
        Align(
          alignment: Alignment.bottomCenter,
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: PrimaryButton(label: 'Escribir el código', icon: Icons.keyboard_alt_outlined, onPressed: _manual),
            ),
          ),
        ),
      ];

  Widget _stepLayer() {
    final t = _ticket;
    final waiting = _step == _Step.waiting || _step == _Step.working;
    final ok = _step == _Step.done;
    final color = ok ? Brand.green : (_step == _Step.failed ? Brand.red : Brand.violet);
    final sectionName = t?.sectionId == null ? null : widget.meta.sections[t!.sectionId];
    return Container(
      color: Brand.ink,
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Row(
                children: [
                  RoundIconButton(icon: Icons.arrow_back_rounded, tooltip: 'Otra entrada', onTap: waiting ? null : _back),
                  const SizedBox(width: 12),
                  const Expanded(child: Text('Canjear entrada', style: Type.title)),
                ],
              ),
            ),
            Expanded(
              child: Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(26),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (waiting)
                        SizedBox(height: 240, child: NfcWaiting(color: color))
                      else if (_step != _Step.review)
                        Container(
                          width: 120,
                          height: 120,
                          decoration: BoxDecoration(shape: BoxShape.circle, color: color.withValues(alpha: 0.16), border: Border.all(color: color, width: 3)),
                          child: Icon(ok ? Icons.check_rounded : Icons.error_outline_rounded, size: 70, color: color),
                        ),
                      const SizedBox(height: 16),
                      Text(
                        switch (_step) {
                          _Step.review => _hasCard ? 'ESTA ENTRADA YA TIENE TARJETA' : 'ENTRADA LISTA PARA CANJEAR',
                          _Step.waiting => 'ACERCA LA TARJETA',
                          _Step.working => 'VINCULANDO…',
                          _Step.done => 'TARJETA VINCULADA',
                          _ => 'NO SE PUDO VINCULAR',
                        },
                        textAlign: TextAlign.center,
                        style: Type.title.copyWith(fontSize: 24),
                      ),
                      const SizedBox(height: 14),
                      if (t != null)
                        SoftCard(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(t.holder ?? 'Sin nombre', style: Type.heading.copyWith(fontSize: 22), maxLines: 2, overflow: TextOverflow.ellipsis),
                              const SizedBox(height: 6),
                              Text([if (t.type != null) t.type!, if (sectionName != null) sectionName, if (t.seat != null) t.seat!].join(' · '), style: Type.muted),
                              if (t.document?.isNotEmpty ?? false) Text('Carnet ${t.document}', style: Type.muted),
                              Text('Código ${_code(t.code)}', style: Type.muted),
                            ],
                          ),
                        ),
                      if (_step == _Step.review && _hasCard)
                        Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: Text(
                            'Tarjeta actual: ${formatUid(t!.nfcUid!)}. Si la cambias (perdida o dañada), la anterior deja de abrir la puerta.',
                            textAlign: TextAlign.center,
                            style: Type.body.copyWith(color: Brand.amber, fontSize: 14),
                          ),
                        ),
                      if (_step == _Step.done && _linked != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: Text(
                            'Número de serie ${_linked!.uidLabel}${_linked!.model == null ? '' : '\n${_linked!.model}'}',
                            textAlign: TextAlign.center,
                            style: Type.muted,
                          ),
                        ),
                      if (_nfcProblem != null)
                        Padding(padding: const EdgeInsets.only(top: 12), child: Text(_nfcProblem!, textAlign: TextAlign.center, style: Type.body.copyWith(color: const Color(0xFFFFC2C8)))),
                      if (_step == _Step.failed && _failure != null)
                        Padding(padding: const EdgeInsets.only(top: 12), child: Text(_failure!, textAlign: TextAlign.center, style: Type.body.copyWith(color: const Color(0xFFFFC2C8)))),
                      const SizedBox(height: 24),
                      if (_step == _Step.review) ...[
                        PrimaryButton(label: _hasCard ? 'CAMBIAR LA TARJETA' : 'ACERCAR TARJETA', icon: Icons.nfc_rounded, onPressed: _startLink),
                        const SizedBox(height: 12),
                        GhostButton(label: 'Otra entrada', onPressed: _back),
                      ],
                      if (_step == _Step.waiting)
                        GhostButton(
                          label: 'Cancelar',
                          onPressed: () {
                            NfcManager.instance.stopSession().catchError((_) {});
                            setState(() => _step = _Step.review);
                          },
                        ),
                      if (_step == _Step.done) PrimaryButton(label: 'CANJEAR OTRA', icon: Icons.qr_code_scanner_rounded, onPressed: _back),
                      if (_step == _Step.failed) ...[
                        PrimaryButton(label: 'REINTENTAR', icon: Icons.refresh_rounded, onPressed: _startLink),
                        const SizedBox(height: 12),
                        GhostButton(label: 'Otra entrada', onPressed: _back),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
