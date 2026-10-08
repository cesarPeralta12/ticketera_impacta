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
      final outcome = await widget.service.scan(widget.meta, raw, method);
      if (!mounted) return;
      outcome.verdict.ok ? HapticFeedback.lightImpact() : HapticFeedback.heavyImpact();
      setState(() => _outcome = outcome);
      _clearTimer?.cancel();
      _clearTimer = Timer(const Duration(milliseconds: 3500), () {
        if (mounted) setState(() => _outcome = null);
      });
      await _refreshCounts();
    } finally {
      _busy = false;
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
