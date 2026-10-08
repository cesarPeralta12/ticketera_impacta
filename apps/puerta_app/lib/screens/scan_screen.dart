import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:nfc_manager/nfc_manager.dart';

import '../door_service.dart';
import '../models.dart';
import '../nfc_reader.dart';

/// Pantalla de lectura: cámara (QR), código de barras o NFC, según lo elegido en el inicio.
class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key, required this.service, required this.meta, required this.method, required this.assignment});

  final DoorService service;
  final SessionMeta meta;
  final AccessMethod method;
  final Assignment assignment;

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  late final MobileScannerController? _camera = widget.method == AccessMethod.nfc
      ? null
      : MobileScannerController(
          formats: widget.method == AccessMethod.qr
              ? const [BarcodeFormat.qrCode]
              : const [BarcodeFormat.code128, BarcodeFormat.code39, BarcodeFormat.ean13, BarcodeFormat.ean8],
          detectionSpeed: DetectionSpeed.noDuplicates,
        );

  ScanOutcome? _outcome;
  Timer? _clearTimer;
  bool _busy = false;
  String? _lastRaw;
  DateTime _lastAt = DateTime.fromMillisecondsSinceEpoch(0);
  ({int total, int used}) _counts = (total: 0, used: 0);
  String? _nfcMessage;
  Timer? _syncTimer;

  @override
  void initState() {
    super.initState();
    _refreshCounts();
    if (widget.method == AccessMethod.nfc) _startNfc();
    // Mientras se lee, sube las lecturas en cuanto hay internet.
    _syncTimer = Timer.periodic(const Duration(seconds: 20), (_) => widget.service.sync(widget.meta.sessionId).catchError((_) => false));
  }

  @override
  void dispose() {
    _clearTimer?.cancel();
    _syncTimer?.cancel();
    _camera?.dispose();
    if (widget.method == AccessMethod.nfc) NfcManager.instance.stopSession().catchError((_) {});
    super.dispose();
  }

  Future<void> _refreshCounts() async {
    final c = await widget.service.gateCounts(widget.meta.sessionId);
    if (mounted) setState(() => _counts = c);
  }

  Future<void> _handle(String raw, AccessMethod? method) async {
    if (_busy) return;
    // La cámara ve el mismo código muchos cuadros seguidos: se ignora si es el mismo de hace un momento.
    final now = DateTime.now();
    if (method != null && raw == _lastRaw && now.difference(_lastAt) < const Duration(seconds: 3)) return;
    _lastRaw = raw;
    _lastAt = now;
    _busy = true;
    try {
      _clearTimer?.cancel();
      if (mounted) setState(() => _outcome = null);
      final outcome = await widget.service.inspect(widget.meta, raw, method);
      if (!mounted) return;

      var shown = outcome;
      if (outcome.verdict.ok) {
        // Entrada válida: el portero ve todos los datos y decide. Nada se marca hasta que acepte.
        HapticFeedback.selectionClick();
        final accepted = await _askConfirm(outcome);
        if (!mounted) return;
        if (accepted) {
          shown = await widget.service.confirm(widget.meta, raw, method);
          HapticFeedback.lightImpact();
        } else {
          // Cancelada o se acabó el tiempo: la entrada sigue válida y se puede volver a leer ya.
          _lastRaw = null;
          ScaffoldMessenger.of(context)
            ..clearSnackBars()
            ..showSnackBar(const SnackBar(content: Text('Lectura cancelada. La entrada no se marcó como usada.')));
          return;
        }
      } else {
        HapticFeedback.heavyImpact();
      }
      setState(() => _outcome = shown);
      _clearTimer = Timer(const Duration(milliseconds: 3500), () {
        if (mounted) setState(() => _outcome = null);
      });
      await _refreshCounts();
    } finally {
      _busy = false;
    }
  }

  /// Ventana con los datos de la entrada. Devuelve true solo si el portero toca Aceptar a tiempo.
  Future<bool> _askConfirm(ScanOutcome outcome) async {
    final accepted = await showDialog<bool>(
      context: context,
      barrierDismissible: true,
      builder: (context) => _ConfirmDialog(
        ticket: outcome.ticket!,
        sectionName: widget.meta.sections[outcome.ticket!.sectionId],
        gateName: widget.meta.gate?.name,
      ),
    );
    return accepted == true;
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
        final code = codeFromTag(tag);
        if (code == null) {
          if (mounted) {
            setState(() => _outcome = const ScanOutcome(verdict: ScanVerdict.invalid, detail: 'La etiqueta no tiene una entrada.'));
          }
          return;
        }
        await _handle(code, AccessMethod.nfc);
        // En iPhone cada lectura cierra la sesión: se vuelve a abrir para la siguiente.
        if (defaultTargetPlatform == TargetPlatform.iOS && mounted) {
          await NfcManager.instance.stopSession();
          await _startNfc();
        }
      },
    );
  }

  Future<void> _manualEntry() async {
    final controller = TextEditingController();
    final code = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Escribir el código'),
        content: TextField(
          controller: controller,
          autofocus: true,
          textCapitalization: TextCapitalization.characters,
          decoration: const InputDecoration(hintText: 'K7Q3M-XPA2B'),
          onSubmitted: (v) => Navigator.pop(context, v),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text),
            style: FilledButton.styleFrom(minimumSize: const Size(100, 44)),
            child: const Text('Validar'),
          ),
        ],
      ),
    );
    if (code != null && code.trim().isNotEmpty) await _handle(code, null);
  }

  @override
  Widget build(BuildContext context) {
    final method = widget.method;
    return Scaffold(
      appBar: AppBar(
        title: Text(method.label),
        actions: [
          if (_camera != null)
            IconButton(
              tooltip: 'Linterna',
              icon: const Icon(Icons.flashlight_on_outlined),
              onPressed: () => _camera.toggleTorch(),
            ),
          IconButton(tooltip: 'Escribir el código', icon: const Icon(Icons.keyboard_outlined), onPressed: _manualEntry),
        ],
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            color: Theme.of(context).colorScheme.surfaceContainerHigh,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Flexible(child: Text(widget.meta.title, overflow: TextOverflow.ellipsis)),
                Text('${_counts.used} / ${_counts.total}', style: const TextStyle(fontWeight: FontWeight.w700)),
              ],
            ),
          ),
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (_camera != null)
                  MobileScanner(
                    controller: _camera,
                    onDetect: (capture) {
                      final raw = capture.barcodes.map((b) => b.rawValue).whereType<String>().firstOrNull;
                      if (raw != null) _handle(raw, method);
                    },
                    errorBuilder: (context, error) => Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text('No se pudo usar la cámara. Revisa el permiso en los ajustes.\n${error.errorCode.name}', textAlign: TextAlign.center),
                      ),
                    ),
                  )
                else
                  _NfcWaiting(message: _nfcMessage),
                if (_camera != null && _outcome == null) const _Viewfinder(),
                if (_outcome != null) Positioned(left: 0, right: 0, bottom: 0, child: _ResultBanner(outcome: _outcome!)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Viewfinder extends StatelessWidget {
  const _Viewfinder();

  @override
  Widget build(BuildContext context) => IgnorePointer(
        child: Center(
          child: Container(
            width: 260,
            height: 260,
            decoration: BoxDecoration(
              border: Border.all(color: Colors.white70, width: 2),
              borderRadius: BorderRadius.circular(18),
            ),
          ),
        ),
      );
}

class _NfcWaiting extends StatelessWidget {
  const _NfcWaiting({this.message});

  final String? message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.nfc, size: 96, color: message == null ? scheme.primary : scheme.error),
            const SizedBox(height: 16),
            Text(
              message ?? 'Acerca la pulsera o tarjeta a la parte trasera del teléfono',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ],
        ),
      ),
    );
  }
}

class _ResultBanner extends StatelessWidget {
  const _ResultBanner({required this.outcome});

  final ScanOutcome outcome;

  @override
  Widget build(BuildContext context) {
    final v = outcome.verdict;
    final color = v.ok
        ? const Color(0xFF0F8A6B)
        : switch (v) {
            ScanVerdict.alreadyUsed || ScanVerdict.cancelled || ScanVerdict.wrongGate || ScanVerdict.methodNotAllowed => const Color(0xFFB45309),
            _ => const Color(0xFFB91C1C),
          };
    final t = outcome.ticket;
    final lines = [
      if (t?.holder != null) t!.holder!,
      [if (t?.type != null) t!.type!, if (t?.seat != null) t!.seat!].join(' · '),
      if (outcome.detail != null) outcome.detail!,
    ].where((l) => l.isNotEmpty);
    return Container(
      color: color,
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(v.ok ? Icons.check_circle : Icons.cancel, color: Colors.white, size: 52),
          const SizedBox(height: 6),
          Text(v.title, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w800)),
          for (final line in lines) Text(line, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 16)),
        ],
      ),
    );
  }
}

/// Cuánto tiempo tiene el portero para aceptar antes de que la lectura se cancele sola.
const _confirmSeconds = 12;

class _ConfirmDialog extends StatefulWidget {
  const _ConfirmDialog({required this.ticket, this.sectionName, this.gateName});

  final TicketRow ticket;
  final String? sectionName;
  final String? gateName;

  @override
  State<_ConfirmDialog> createState() => _ConfirmDialogState();
}

class _ConfirmDialogState extends State<_ConfirmDialog> with SingleTickerProviderStateMixin {
  late final AnimationController _timer = AnimationController(vsync: this, duration: const Duration(seconds: _confirmSeconds))
    ..addStatusListener((status) {
      if (status == AnimationStatus.completed && mounted) Navigator.of(context).pop(false);
    })
    ..forward();

  @override
  void dispose() {
    _timer.dispose();
    super.dispose();
  }

  String _code(String c) => c.length == 10 ? '${c.substring(0, 5)}-${c.substring(5)}' : c;

  @override
  Widget build(BuildContext context) {
    final t = widget.ticket;
    final scheme = Theme.of(context).colorScheme;
    final rows = <(String, String)>[
      ('Tipo de entrada', t.type ?? '—'),
      if (widget.sectionName != null) ('Sector', widget.sectionName!),
      if (t.seat != null) ('Asiento', t.seat!),
      if (t.document != null && t.document!.isNotEmpty) ('Carnet', t.document!),
      ('Código', _code(t.code)),
      if (widget.gateName != null) ('Puerta', widget.gateName!),
    ];
    return AlertDialog(
      scrollable: true,
      title: Row(
        children: [
          Icon(Icons.verified_outlined, color: scheme.primary),
          const SizedBox(width: 10),
          const Expanded(child: Text('Entrada válida')),
        ],
      ),
      content: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(t.holder ?? 'Sin nombre', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          for (final (label, value) in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(width: 120, child: Text(label, style: TextStyle(color: scheme.onSurfaceVariant))),
                  Expanded(child: Text(value, style: const TextStyle(fontWeight: FontWeight.w600))),
                ],
              ),
            ),
          const SizedBox(height: 14),
          AnimatedBuilder(
            animation: _timer,
            builder: (context, _) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                LinearProgressIndicator(value: 1 - _timer.value, minHeight: 6, borderRadius: BorderRadius.circular(3)),
                const SizedBox(height: 6),
                Text(
                  'Se cancela sola en ${(_confirmSeconds * (1 - _timer.value)).ceil()} s si no aceptas',
                  style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
        ],
      ),
      actionsAlignment: MainAxisAlignment.spaceBetween,
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancelar')),
        FilledButton.icon(
          onPressed: () => Navigator.of(context).pop(true),
          style: FilledButton.styleFrom(minimumSize: const Size(190, 52)),
          icon: const Icon(Icons.login),
          label: const Text('ACEPTAR INGRESO'),
        ),
      ],
    );
  }
}
