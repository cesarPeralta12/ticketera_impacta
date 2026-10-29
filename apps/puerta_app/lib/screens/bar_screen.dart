import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../api.dart';
import '../bar.dart';
import '../door_service.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';
import 'account_sheet.dart';
import 'scan_widgets.dart';

String _hhmm(DateTime t) => '${t.toLocal().hour.toString().padLeft(2, '0')}:${t.toLocal().minute.toString().padLeft(2, '0')}';

String _day(DateTime t) {
  const days = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
  final l = t.toLocal();
  return '${days[l.weekday - 1]} ${l.day}/${l.month} ${_hhmm(l)}';
}

/// Inicio del modo Barra: las noches con consumo que esta cuenta atiende. Al elegir una se descargan sus QR de consumo
/// y se abre la lectura.
class BarHomeScreen extends StatefulWidget {
  const BarHomeScreen({super.key, required this.service, this.canGoBack = false});

  final DoorService service;

  /// Un administrador llega desde la puerta y puede volver; la cuenta de barra no tiene otra pantalla.
  final bool canGoBack;

  @override
  State<BarHomeScreen> createState() => _BarHomeScreenState();
}

class _BarHomeScreenState extends State<BarHomeScreen> {
  DoorService get _s => widget.service;
  List<BarNight>? _nights;
  String? _error;
  String? _opening;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final nights = await _s.barNights();
      if (mounted) setState(() => _nights = nights);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _open(BarNight night) async {
    setState(() => _opening = night.sessionId);
    try {
      // Con internet: sube lo pendiente y baja la lista al día. Sin internet: se usa lo que ya está en el teléfono.
      var ready = (await _s.barCounts(night.sessionId)).total > 0;
      try {
        await _s.barSync(night.sessionId);
        ready = true;
      } on ApiException catch (e) {
        if (!e.offline && !ready) rethrow;
      }
      if (!ready) {
        await _s.barDownload(night.sessionId);
      }
      if (!mounted) return;
      await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => BarScanScreen(service: _s, night: night)));
      unawaited(_load());
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.offline ? 'Sin internet: descarga la noche una vez con conexión.' : e.message)));
    } finally {
      if (mounted) setState(() => _opening = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final name = (_s.staffName ?? '').trim();
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          color: Brand.accent,
          backgroundColor: Brand.surface3,
          onRefresh: _load,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(20, 10, 20, 36),
            children: [
              Row(
                children: [
                  if (widget.canGoBack) ...[
                    RoundIconButton(icon: Icons.arrow_back_rounded, tooltip: 'Volver', onTap: () => Navigator.of(context).maybePop()),
                    const SizedBox(width: 12),
                  ],
                  const BrandMark(height: 26, suffix: 'BARRA'),
                  const Spacer(),
                  if (!widget.canGoBack) RoundIconButton(icon: Icons.person_outline_rounded, tooltip: 'Cuenta', onTap: () => showAccountSheet(context, service: _s)),
                ],
              ),
              const SizedBox(height: 22),
              Text(name.isEmpty ? 'Barra' : 'Hola, ${name.split(' ').first}', style: Type.title.copyWith(fontSize: 24)),
              const SizedBox(height: 4),
              Text('Elige la noche. Lees el QR de consumo, ves cuánto tiene y lo marcas como leído (se usa una sola vez).', style: Type.muted),
              const SizedBox(height: 20),
              if (_error != null) Text(_error!, style: Type.body.copyWith(color: Brand.red)),
              if (_nights == null && _error == null) const Center(child: Padding(padding: EdgeInsets.all(30), child: CircularProgressIndicator())),
              if (_nights != null && _nights!.isEmpty)
                Text('No tienes noches con consumo asignadas ahora. Pídele a iPass que te asigne la noche.', style: Type.body),
              for (final (i, n) in (_nights ?? const <BarNight>[]).indexed)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: StaggerIn(
                    index: i,
                    child: PressScale(
                      onTap: _opening == null ? () => _open(n) : null,
                      child: Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(color: Brand.surface2, borderRadius: BorderRadius.circular(20), border: Border.all(color: Brand.stroke)),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(n.title, style: Type.title.copyWith(fontSize: 18), maxLines: 2, overflow: TextOverflow.ellipsis),
                                  const SizedBox(height: 4),
                                  Text('${_day(n.startsAt)} · ${n.venue}', style: Type.muted),
                                  const SizedBox(height: 8),
                                  Pill('${n.read} de ${n.vouchers} QR leídos', icon: Icons.local_bar_outlined, color: Brand.highlight, small: true),
                                ],
                              ),
                            ),
                            if (_opening == n.sessionId) const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2.5)) else const Icon(Icons.chevron_right_rounded),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Lectura de QR de consumo de una noche: cámara, ficha del consumo y marca de «leído».
class BarScanScreen extends StatefulWidget {
  const BarScanScreen({super.key, required this.service, required this.night, this.previewOverride});

  final DoorService service;
  final BarNight night;

  /// Para pruebas: en lugar de la cámara.
  final Widget? previewOverride;

  @override
  State<BarScanScreen> createState() => _BarScanScreenState();
}

class _BarScanScreenState extends State<BarScanScreen> with WidgetsBindingObserver {
  DoorService get _s => widget.service;
  late final MobileScannerController? _camera = widget.previewOverride != null
      ? null
      : MobileScannerController(formats: const [BarcodeFormat.qrCode], detectionSpeed: DetectionSpeed.noDuplicates);
  Timer? _timer;
  bool _busy = false;
  String? _lastRaw;
  DateTime _lastAt = DateTime.fromMillisecondsSinceEpoch(0);
  ({int total, int read}) _counts = (total: 0, read: 0);

  @override
  void initState() {
    super.initState();
    _refresh();
    // Sube lo leído y baja lo que leyeron otros teléfonos mientras la pantalla esté abierta (si hay internet).
    _timer = Timer.periodic(const Duration(seconds: 20), (_) => _sync());
  }

  @override
  void dispose() {
    _timer?.cancel();
    _camera?.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    await _s.refreshBarCounters(widget.night.sessionId);
    final counts = await _s.barCounts(widget.night.sessionId);
    if (mounted) setState(() => _counts = counts);
  }

  Future<void> _sync() async {
    try {
      await _s.barSync(widget.night.sessionId);
    } on ApiException {
      // Sin internet o sesión vencida: se reintenta luego.
    }
    await _refresh();
  }

  Future<void> _handle(String raw) async {
    if (_busy) return;
    final now = DateTime.now();
    if (raw == _lastRaw && now.difference(_lastAt) < const Duration(seconds: 3)) return;
    _lastRaw = raw;
    _lastAt = now;
    _busy = true;
    try {
      final outcome = await _s.barInspect(widget.night.sessionId, raw);
      if (!mounted) return;
      final confirmed = await showVoucherSheet(context, outcome: outcome, night: widget.night);
      if (confirmed != null && outcome.verdict == VoucherVerdict.available) {
        final done = await _s.barRead(widget.night.sessionId, raw, note: confirmed.note);
        if (!mounted) return;
        if (done == null) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Otro teléfono ya lo había leído. Actualiza la lista.')));
        } else {
          await showVoucherDone(context, voucher: done);
          unawaited(_sync());
        }
      }
      await _refresh();
    } finally {
      _busy = false;
      _lastRaw = null;
    }
  }

  Future<void> _manual() async {
    final code = await showManualEntry(context);
    if (code != null && code.trim().isNotEmpty) await _handle(code);
  }

  @override
  Widget build(BuildContext context) {
    final pending = _s.barPending;
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          if (widget.previewOverride != null)
            widget.previewOverride!
          else
            MobileScanner(
              controller: _camera,
              onDetect: (capture) {
                final raw = capture.barcodes.map((b) => b.rawValue).whereType<String>().firstOrNull;
                if (raw != null) unawaited(_handle(raw));
              },
              errorBuilder: (context, error) => Center(child: Padding(padding: const EdgeInsets.all(30), child: Text('No se pudo usar la cámara. Revisa el permiso.\n(${error.errorCode.name})', textAlign: TextAlign.center, style: Type.muted))),
            ),
          IgnorePointer(
            child: Column(
              children: [
                Container(height: 170, decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Colors.black.withValues(alpha: 0.82), Colors.transparent]))),
                const Spacer(),
                Container(height: 200, decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.bottomCenter, end: Alignment.topCenter, colors: [Colors.black.withValues(alpha: 0.9), Colors.transparent]))),
              ],
            ),
          ),
          ScanFrame(color: _busy ? Brand.highlight : Colors.white, locked: _busy),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  RoundIconButton(icon: Icons.arrow_back_rounded, tooltip: 'Volver', onTap: () => Navigator.of(context).maybePop()),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(widget.night.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: Type.title.copyWith(fontSize: 17)),
                        const SizedBox(height: 6),
                        Wrap(
                          spacing: 6,
                          children: [
                            const Pill('QR de consumo', icon: Icons.local_bar_outlined, color: Brand.highlight, small: true),
                            if (pending > 0) Pill('$pending por subir', icon: Icons.cloud_upload_outlined, color: Brand.amber, small: true),
                            if (_s.barConflicts > 0) Pill('${_s.barConflicts} ya leídos por otro', icon: Icons.warning_amber_rounded, color: Brand.red, small: true),
                          ],
                        ),
                      ],
                    ),
                  ),
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
                ],
              ),
            ),
          ),
          Align(
            alignment: const Alignment(0, 0.52),
            child: IgnorePointer(child: Text('Apunta al QR de consumo', style: Type.body.copyWith(color: Colors.white70, fontWeight: FontWeight.w600))),
          ),
          Align(
            alignment: Alignment.bottomCenter,
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
                child: Container(
                  padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
                  decoration: BoxDecoration(color: Brand.surface.withValues(alpha: 0.94), borderRadius: BorderRadius.circular(26), border: Border.all(color: Brand.stroke)),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text('${_counts.read} / ${_counts.total}', style: Type.number.copyWith(fontSize: 28)),
                            Text('QR de consumo leídos', style: Type.muted.copyWith(fontSize: 12.5)),
                          ],
                        ),
                      ),
                      PressScale(
                        onTap: () => showBarRecent(context, () => _s.barRecent(widget.night.sessionId)),
                        child: Container(
                          width: 52,
                          height: 52,
                          decoration: BoxDecoration(color: Brand.surface3, borderRadius: BorderRadius.circular(16), border: Border.all(color: Brand.stroke)),
                          child: const Icon(Icons.history_rounded, color: Brand.text),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Tooltip(
                        message: 'Escribir el código',
                        child: PressScale(
                          onTap: _manual,
                          child: Container(width: 52, height: 52, decoration: BoxDecoration(color: Brand.accent, borderRadius: BorderRadius.circular(16)), child: const Icon(Icons.keyboard_alt_outlined, color: Brand.accentInk)),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ───────────────────────── Hojas ─────────────────────────

/// Lo que confirmó el de barra: la nota opcional.
class VoucherConfirm {
  const VoucherConfirm({this.note});
  final String? note;
}

/// Muestra la ficha de lo leído. Devuelve la confirmación si el de barra tocó «MARCAR COMO LEÍDO»; null si no.
Future<VoucherConfirm?> showVoucherSheet(BuildContext context, {required VoucherOutcome outcome, required BarNight night}) {
  return showModalBottomSheet<VoucherConfirm>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Brand.surface2,
    barrierColor: Colors.black.withValues(alpha: 0.6),
    builder: (context) => _VoucherSheet(outcome: outcome),
  );
}

class _VoucherSheet extends StatefulWidget {
  const _VoucherSheet({required this.outcome});
  final VoucherOutcome outcome;

  @override
  State<_VoucherSheet> createState() => _VoucherSheetState();
}

class _VoucherSheetState extends State<_VoucherSheet> {
  final _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  String _code(String c) => c.length == 10 ? '${c.substring(0, 5)}-${c.substring(5)}' : c;

  @override
  Widget build(BuildContext context) {
    final o = widget.outcome;
    final v = o.voucher;
    final ok = o.verdict == VoucherVerdict.available;
    final color = ok ? Brand.green : (o.verdict == VoucherVerdict.alreadyRead ? Brand.red : Brand.amber);
    final icon = ok ? Icons.local_bar_rounded : (o.verdict == VoucherVerdict.alreadyRead ? Icons.block_rounded : Icons.priority_high_rounded);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(22, 10, 22, 18 + MediaQuery.viewInsetsOf(context).bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(child: Container(width: 44, height: 5, decoration: BoxDecoration(color: Brand.surface3, borderRadius: BorderRadius.circular(3)))),
            const SizedBox(height: 18),
            Row(
              children: [
                Container(width: 38, height: 38, decoration: BoxDecoration(color: color.withValues(alpha: 0.18), shape: BoxShape.circle), child: Icon(icon, color: color, size: 22)),
                const SizedBox(width: 10),
                Expanded(child: Text(o.title, style: Type.label.copyWith(color: color, fontSize: 14))),
              ],
            ),
            if (v != null) ...[
              const SizedBox(height: 14),
              Text(v.label, style: const TextStyle(fontFamily: Fonts.display, fontSize: 26, fontWeight: FontWeight.w700, height: 1.15, color: Brand.text)),
              const SizedBox(height: 4),
              Text('${v.people > 1 ? '${v.people} personas · ' : ''}a nombre de ${v.buyer}', style: Type.muted),
              const SizedBox(height: 14),
              Text(formatVoucherAmount(v.amount, v.currency), style: Type.number.copyWith(fontSize: 40, color: ok ? Brand.green : Brand.muted)),
              Text('de consumo · ${_code(v.code)}', style: Type.muted),
            ],
            if (o.detail != null) ...[
              const SizedBox(height: 12),
              Text(o.detail!, style: Type.body.copyWith(color: ok ? Brand.muted : color, fontWeight: FontWeight.w600)),
            ],
            if (ok) ...[
              const SizedBox(height: 16),
              TextField(
                controller: _note,
                maxLength: 120,
                decoration: const InputDecoration(labelText: 'Detalle (opcional)', hintText: 'ej. 1 botella + 6 vasos', counterText: ''),
              ),
              const SizedBox(height: 4),
              Text('Al marcarlo, este QR ya no se puede usar otra vez. Anota la mesa y el monto.', style: Type.muted.copyWith(fontSize: 12.5)),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    flex: 2,
                    child: PressScale(
                      onTap: () => Navigator.of(context).pop(),
                      child: Container(height: 62, alignment: Alignment.center, decoration: BoxDecoration(borderRadius: BorderRadius.circular(18), border: Border.all(color: Brand.stroke), color: Brand.surface3), child: Text('CANCELAR', style: Type.label)),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    flex: 3,
                    child: PrimaryButton(label: 'MARCAR COMO LEÍDO', icon: Icons.check_rounded, color: Brand.green, textColor: Colors.white, onPressed: () => Navigator.of(context).pop(VoucherConfirm(note: _note.text))),
                  ),
                ],
              ),
            ] else ...[
              const SizedBox(height: 16),
              SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cerrar'))),
            ],
          ],
        ),
      ),
    );
  }
}

/// Confirmación de que quedó leído: lo que el de barra tiene que anotar.
Future<void> showVoucherDone(BuildContext context, {required Voucher voucher}) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: Brand.surface2,
    barrierColor: Colors.black.withValues(alpha: 0.6),
    builder: (context) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(22, 18, 22, 18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [const Icon(Icons.check_circle_rounded, color: Brand.green, size: 28), const SizedBox(width: 10), Text('LEÍDO Y MARCADO', style: Type.label.copyWith(color: Brand.green, fontSize: 14))]),
            const SizedBox(height: 14),
            Text('Anótalo', style: Type.muted),
            Text(voucher.label, style: const TextStyle(fontFamily: Fonts.display, fontSize: 24, fontWeight: FontWeight.w700, color: Brand.text)),
            Text(formatVoucherAmount(voucher.amount, voucher.currency), style: Type.number.copyWith(fontSize: 38, color: Brand.green)),
            if (voucher.note != null) Text(voucher.note!, style: Type.body),
            const SizedBox(height: 16),
            SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Listo'))),
          ],
        ),
      ),
    ),
  );
}

/// Últimos QR de consumo leídos en la noche.
Future<void> showBarRecent(BuildContext context, Future<List<Voucher>> Function() load) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Brand.surface2,
    builder: (context) => FutureBuilder<List<Voucher>>(
      future: load(),
      builder: (context, snapshot) {
        final items = snapshot.data ?? const <Voucher>[];
        return SafeArea(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.7),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(22, 18, 22, 18),
              shrinkWrap: true,
              children: [
                Text('Últimos leídos', style: Type.title),
                const SizedBox(height: 10),
                if (items.isEmpty) Text('Todavía no se leyó ninguno.', style: Type.muted),
                for (final v in items)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text('${v.label} · ${formatVoucherAmount(v.amount, v.currency)}'),
                    subtitle: Text('${_hhmm(v.redeemedAt!)}${v.redeemedBy == null ? '' : ' · ${v.redeemedBy}'}${v.note == null ? '' : ' · ${v.note}'}'),
                  ),
              ],
            ),
          ),
        );
      },
    ),
  );
}
