import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../app_services.dart';
import '../door_service.dart';
import '../models.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';
import 'account_sheet.dart';
import 'bracelet_screen.dart';
import 'scan_screen.dart';

typedef Counts = ({int total, int used, int inside});

/// Después del login: elige la función y la puerta, descarga los datos y elige cómo leer
/// (solo aparecen los métodos que admiten las entradas de esa función).
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.service});

  final DoorService service;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  DoorService get _s => widget.service;

  bool _loading = true;
  bool _downloading = false;
  String? _error;
  Assignment? _selected;
  String? _gateId;
  SessionMeta? _meta;
  Counts _counts = (total: 0, used: 0, inside: 0);
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _s.onSessionExpired = () {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Tu sesión terminó. Inicia sesión de nuevo.')));
    };
    _load();
    // Sube lo pendiente y baja cambios mientras la pantalla esté abierta (si hay internet).
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _backgroundSync());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _s.onSessionExpired = null;
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _backgroundSync();
  }

  Future<void> _load() async {
    setState(() {
      _loading = _selected == null;
      _error = null;
    });
    try {
      await _s.loadAssignments();
      final list = _s.assignments;
      final keep = list.where((a) => a.sessionId == _selected?.sessionId).firstOrNull;
      await _select(keep ?? list.firstOrNull);
    } on ApiException catch (e) {
      if (!e.unauthorized) _error = e.message;
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _select(Assignment? a) async {
    _selected = a;
    _meta = a == null ? null : await _s.meta(a.sessionId);
    // Si ya descargó esta función, vuelve a su puerta; si no, propone la primera/única.
    _gateId = _meta?.gateId ?? a?.gates.firstOrNull?.id;
    if (a != null && _meta != null) _counts = await _s.gateCounts(a.sessionId);
    if (a != null) await _s.refreshCounters(a.sessionId);
    if (mounted) setState(() {});
    // Cuenta de una sola puerta: si todavía no hay datos de esta puerta, se descargan solos.
    final gate = a?.gates.length == 1 ? a!.gates.first : null;
    if (gate != null && (_meta == null || _meta!.gateId != gate.id)) unawaited(_download());
  }

  Future<void> _backgroundSync() async {
    final a = _selected;
    if (a == null || _meta == null || _downloading) return;
    try {
      await _s.sync(a.sessionId);
      _meta = await _s.meta(a.sessionId);
      _counts = await _s.gateCounts(a.sessionId);
      if (mounted) setState(() {});
    } on ApiException {
      // Se reintenta en el próximo ciclo.
    }
  }

  Future<void> _download() async {
    final a = _selected;
    if (a == null) return;
    setState(() {
      _downloading = true;
      _error = null;
    });
    try {
      final gate = a.gates.where((g) => g.id == _gateId).firstOrNull;
      // Antes de reemplazar la lista se suben las lecturas pendientes, para no perder ninguna.
      if (_meta != null) await _s.sync(a.sessionId);
      _meta = await _s.download(a, gate);
      _counts = await _s.gateCounts(a.sessionId);
      if (mounted) AppServices.of(context).feedback.done();
    } on ApiException catch (e) {
      _error = e.offline ? 'Sin conexión. Conéctate a internet para descargar los datos.' : e.message;
    }
    if (mounted) setState(() => _downloading = false);
  }

  String _clock(String iso) {
    final t = DateTime.parse(iso).toLocal();
    return '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
  }

  String _date(DateTime d) {
    final t = d.toLocal();
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const days = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
    return '${days[t.weekday - 1]} ${t.day} ${months[t.month - 1]} · ${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
  }

  Future<void> _openAccount() async {
    await showAccountSheet(context, service: _s, pending: _selected == null ? 0 : _s.pendingCount);
  }

  Future<void> _pickSession() async {
    final list = _s.assignments;
    final chosen = await showModalBottomSheet<Assignment>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          children: [
            const Padding(padding: EdgeInsets.only(bottom: 12), child: Text('ELIGE EL EVENTO', style: Type.title)),
            for (final a in list)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: PressScale(
                  onTap: () => Navigator.pop(context, a),
                  child: SoftCard(
                    borderColor: a.sessionId == _selected?.sessionId ? Brand.yellow : null,
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(a.title, style: Type.heading, maxLines: 2, overflow: TextOverflow.ellipsis),
                              const SizedBox(height: 3),
                              Text('${_date(a.startsAt)} · ${a.venue}', style: Type.muted),
                            ],
                          ),
                        ),
                        if (a.sessionId == _selected?.sessionId) const Icon(Icons.check_circle, color: Brand.yellow),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
    if (chosen != null) await _select(chosen);
  }

  void _openScan(Assignment a, SessionMeta meta, AccessMethod m) {
    Navigator.of(context)
        .push(PageRouteBuilder<void>(
          transitionDuration: const Duration(milliseconds: 380),
          reverseTransitionDuration: const Duration(milliseconds: 260),
          pageBuilder: (_, _, _) => ScanScreen(service: _s, meta: meta, method: m, assignment: a),
          transitionsBuilder: (_, animation, _, child) => FadeTransition(
            opacity: CurvedAnimation(parent: animation, curve: Curves.easeOut),
            child: ScaleTransition(scale: Tween(begin: 0.96, end: 1.0).animate(CurvedAnimation(parent: animation, curve: Curves.easeOutCubic)), child: child),
          ),
        ))
        .then((_) => _backgroundSync());
  }

  @override
  Widget build(BuildContext context) {
    final a = _selected;
    final meta = _meta;
    // Los datos descargados son de otra puerta que la elegida: hay que volver a descargar.
    final gateChanged = meta != null && (meta.gateId ?? '') != (_gateId ?? '') && !_downloading;
    final ready = meta != null && !gateChanged;
    final name = (_s.staffName ?? 'portero').trim();
    final first = name.split(' ').first;

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          color: Brand.yellow,
          backgroundColor: Brand.surface3,
          onRefresh: _load,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(20, 10, 20, 36),
            children: [
              Row(
                children: [
                  const BrandMark(size: 28, suffix: 'PUERTA'),
                  const Spacer(),
                  PressScale(
                    onTap: _openAccount,
                    scale: 0.92,
                    child: Stack(
                      clipBehavior: Clip.none,
                      children: [
                        Container(
                          width: 46,
                          height: 46,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            gradient: const LinearGradient(colors: [Color(0xFFFFD34D), Brand.yellow]),
                            boxShadow: [BoxShadow(color: Brand.yellow.withValues(alpha: 0.3), blurRadius: 14)],
                          ),
                          child: Text(first.isEmpty ? 'P' : first.characters.first.toUpperCase(), style: const TextStyle(fontFamily: Fonts.display, fontSize: 22, color: Brand.yellowInk)),
                        ),
                        // Lecturas guardadas que todavía no se subieron.
                        if (_s.pendingCount > 0)
                          Positioned(
                            right: -4,
                            top: -4,
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(color: Brand.amber, borderRadius: BorderRadius.circular(99), border: Border.all(color: Brand.ink, width: 2)),
                              child: Text('${_s.pendingCount}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: Brand.ink)),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 22),
              StaggerIn(
                child: Text('Hola, $first', style: Type.heading.copyWith(fontSize: 26)),
              ),
              const SizedBox(height: 2),
              const StaggerIn(index: 1, child: Text('Esto es lo que tienes para hoy.', style: Type.muted)),
              const SizedBox(height: 20),
              if (_error != null) ...[
                StaggerIn(
                  child: Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: Brand.red.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(16), border: Border.all(color: Brand.red.withValues(alpha: 0.4))),
                    child: Row(
                      children: [
                        const Icon(Icons.wifi_off_rounded, color: Brand.red, size: 20),
                        const SizedBox(width: 10),
                        Expanded(child: Text(_error!, style: Type.body.copyWith(color: const Color(0xFFFFC2C8), fontSize: 15))),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 14),
              ],
              if (_loading)
                const _LoadingState()
              else if (a == null)
                const _EmptyState()
              else ...[
                StaggerIn(
                  index: 2,
                  child: _EventHero(assignment: a, dateLabel: _date(a.startsAt), canChange: _s.assignments.length > 1, onChange: _pickSession),
                ),
                if (a.gates.isNotEmpty) ...[
                  const SizedBox(height: 22),
                  const StaggerIn(index: 3, child: SectionLabel('Tienes estas puertas disponibles')),
                  if (a.gates.length > 1) const Padding(padding: EdgeInsets.only(top: 6), child: Text('Toca la que vas a atender en este teléfono.', style: Type.muted)),
                  const SizedBox(height: 10),
                  StaggerIn(
                    index: 3,
                    child: _GatePicker(
                      // Si ya descargó, las puertas traen su dirección y su zona; antes, solo el nombre.
                      gates: [for (final g in a.gates) meta?.gates.where((m) => m.id == g.id).firstOrNull ?? g],
                      selectedId: _gateId,
                      onChanged: (id) => setState(() => _gateId = id),
                    ),
                  ),
                ],
                const SizedBox(height: 22),
                StaggerIn(
                  index: 4,
                  child: _DataCard(
                    meta: gateChanged ? null : meta,
                    counts: _counts,
                    downloading: _downloading,
                    pending: _s.pendingCount,
                    conflicts: _s.conflictCount,
                    syncedAt: meta == null ? null : _clock(meta.syncedAt),
                    onDownload: _download,
                    refresh: meta != null && !gateChanged,
                  ),
                ),
                const SizedBox(height: 22),
                if (!ready)
                  StaggerIn(
                    index: 5,
                    child: Text('Descarga los datos para empezar a leer entradas.', textAlign: TextAlign.center, style: Type.muted.copyWith(fontSize: 15)),
                  )
                else if (a.methods.isEmpty)
                  Text('Las entradas de esta función no tienen un método de lectura configurado.', style: Type.body.copyWith(color: Brand.red))
                else ...[
                  const StaggerIn(index: 5, child: SectionLabel('Empezar a leer')),
                  const SizedBox(height: 10),
                  for (final (i, m) in a.methods.indexed)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: StaggerIn(index: 6 + i, child: _MethodTile(method: m, onTap: () => _openScan(a, meta, m))),
                    ),
                ],
                if (ready && _s.canWriteBracelets) ...[
                  const SizedBox(height: 4),
                  StaggerIn(
                    index: 9,
                    child: GhostButton(
                      label: 'Grabar pulseras NFC',
                      icon: Icons.nfc,
                      onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => BraceletScreen(service: _s, meta: meta, assignment: a))),
                    ),
                  ),
                ],
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _LoadingState extends StatelessWidget {
  const _LoadingState();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 60),
      child: Column(
        children: [
          const SizedBox(width: 36, height: 36, child: CircularProgressIndicator(strokeWidth: 3.5, color: Brand.yellow)),
          const SizedBox(height: 16),
          Text('Buscando tus eventos…', style: Type.muted.copyWith(fontSize: 15)),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return StaggerIn(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 40),
        child: Column(
          children: [
            Container(
              width: 112,
              height: 112,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Brand.surface2,
                border: Border.all(color: Brand.stroke),
              ),
              child: const Icon(Icons.event_busy_rounded, size: 52, color: Brand.muted),
            ),
            const SizedBox(height: 22),
            const Text('NO TIENES EVENTOS ASIGNADOS', textAlign: TextAlign.center, style: Type.title),
            const SizedBox(height: 10),
            Text(
              'Pídele al administrador que te asigne una función en el panel y desliza hacia abajo para actualizar.',
              textAlign: TextAlign.center,
              style: Type.muted.copyWith(fontSize: 15),
            ),
          ],
        ),
      ),
    );
  }
}

class _EventHero extends StatelessWidget {
  const _EventHero({required this.assignment, required this.dateLabel, required this.canChange, required this.onChange});

  final Assignment assignment;
  final String dateLabel;
  final bool canChange;
  final VoidCallback onChange;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: Brand.yellow.withValues(alpha: 0.28)),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Brand.yellow.withValues(alpha: 0.16), const Color(0xFF12161C)],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const PulseDot(color: Brand.green, size: 8),
              const SizedBox(width: 4),
              Text('EVENTO EN CURSO', style: Type.label.copyWith(color: Brand.yellow)),
              const Spacer(),
              if (canChange)
                PressScale(
                  onTap: onChange,
                  child: const Pill('Cambiar', icon: Icons.unfold_more_rounded, color: Brand.text, small: true),
                ),
            ],
          ),
          const SizedBox(height: 10),
          Text(assignment.title.toUpperCase(), style: Type.hero.copyWith(fontSize: 34), maxLines: 3, overflow: TextOverflow.ellipsis),
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              Pill(dateLabel, icon: Icons.schedule_rounded, color: Brand.text),
              Pill(assignment.venue, icon: Icons.place_outlined, color: Brand.text),
            ],
          ),
        ],
      ),
    );
  }
}

class _GatePicker extends StatelessWidget {
  const _GatePicker({required this.gates, required this.selectedId, required this.onChanged});

  final List<Gate> gates;
  final String? selectedId;
  final ValueChanged<String> onChanged;

  static Color _tone(Gate g) => g.directionKnown ? _color(g.direction) : Brand.muted;

  static Color _color(GateDirection d) => switch (d) {
        GateDirection.inward => Brand.green,
        GateDirection.outward => Brand.amber,
        GateDirection.both => Brand.blue,
      };

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (final g in gates)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: PressScale(
              onTap: gates.length > 1 ? () => onChanged(g.id) : null,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 220),
                curve: Curves.easeOutCubic,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: g.id == selectedId ? _tone(g).withValues(alpha: 0.10) : Brand.surface,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: g.id == selectedId ? _tone(g).withValues(alpha: 0.7) : Brand.stroke, width: g.id == selectedId ? 1.6 : 1),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 46,
                      height: 46,
                      decoration: BoxDecoration(color: _tone(g).withValues(alpha: 0.16), borderRadius: BorderRadius.circular(14)),
                      child: Icon(g.directionKnown ? g.direction.icon : Icons.meeting_room_outlined, color: _tone(g)),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(g.name, style: Type.heading.copyWith(fontSize: 18)),
                          const SizedBox(height: 2),
                          Text(
                            !g.directionKnown ? 'Puerta' : (g.zoneId != null ? '${g.direction.label} · da a una zona' : g.direction.label),
                            style: Type.muted.copyWith(fontSize: 13.5),
                          ),
                        ],
                      ),
                    ),
                    if (gates.length > 1)
                      AnimatedSwitcher(
                        duration: const Duration(milliseconds: 200),
                        transitionBuilder: (c, a) => ScaleTransition(scale: a, child: c),
                        child: g.id == selectedId
                            ? Icon(Icons.check_circle_rounded, key: const ValueKey('on'), color: _tone(g))
                            : const Icon(Icons.radio_button_unchecked, key: ValueKey('off'), color: Brand.faint),
                      ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _DataCard extends StatelessWidget {
  const _DataCard({
    required this.meta,
    required this.counts,
    required this.downloading,
    required this.pending,
    required this.conflicts,
    required this.syncedAt,
    required this.onDownload,
    required this.refresh,
  });

  final SessionMeta? meta;
  final Counts counts;
  final bool downloading;
  final int pending;
  final int conflicts;
  final String? syncedAt;
  final VoidCallback onDownload;
  final bool refresh;

  @override
  Widget build(BuildContext context) {
    final total = counts.total;
    final ratio = total == 0 ? 0.0 : counts.used / total;
    return SoftCard(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (meta == null)
            Row(
              children: [
                Container(
                  width: 46,
                  height: 46,
                  decoration: BoxDecoration(color: Brand.surface3, borderRadius: BorderRadius.circular(14)),
                  child: const Icon(Icons.cloud_download_outlined, color: Brand.yellow),
                ),
                const SizedBox(width: 14),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Datos sin descargar', style: Type.heading),
                      SizedBox(height: 2),
                      Text('Se guardan en el teléfono para leer sin internet.', style: Type.muted),
                    ],
                  ),
                ),
              ],
            )
          else
            Row(
              children: [
                RingGauge(
                  value: ratio,
                  size: 112,
                  stroke: 11,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      AnimatedNumber(value: counts.used, style: Type.number.copyWith(fontSize: 30)),
                      Text('de $total', style: Type.muted.copyWith(fontSize: 12.5)),
                    ],
                  ),
                ),
                const SizedBox(width: 20),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _Stat(icon: Icons.login_rounded, color: Brand.green, label: 'Adentro ahora', value: counts.inside),
                      const SizedBox(height: 12),
                      _Stat(icon: Icons.confirmation_number_outlined, color: Brand.yellow, label: 'Entradas de tu puerta', value: total),
                      if (syncedAt != null) ...[
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            PulseDot(color: pending > 0 ? Brand.amber : Brand.green, size: 7, pulsing: pending > 0 || downloading),
                            const SizedBox(width: 2),
                            Text('Actualizado $syncedAt', style: Type.muted.copyWith(fontSize: 12.5)),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          if (pending > 0 || conflicts > 0) ...[
            const SizedBox(height: 14),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (pending > 0) Pill('$pending lectura(s) por subir', icon: Icons.cloud_upload_outlined, color: Brand.amber),
                if (conflicts > 0) Pill('$conflicts ya habían ingresado por otro lector', icon: Icons.warning_amber_rounded, color: Brand.red),
              ],
            ),
          ],
          const SizedBox(height: 16),
          _SyncButton(downloading: downloading, refresh: refresh, onTap: onDownload),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.icon, required this.color, required this.label, required this.value});

  final IconData icon;
  final Color color;
  final String label;
  final int value;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(color: color.withValues(alpha: 0.16), borderRadius: BorderRadius.circular(10)),
          child: Icon(icon, size: 17, color: color),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AnimatedNumber(value: value, style: Type.number.copyWith(fontSize: 22, height: 1)),
              Text(label, style: Type.muted.copyWith(fontSize: 12.5), maxLines: 1, overflow: TextOverflow.ellipsis),
            ],
          ),
        ),
      ],
    );
  }
}

class _SyncButton extends StatefulWidget {
  const _SyncButton({required this.downloading, required this.refresh, required this.onTap});

  final bool downloading;
  final bool refresh;
  final VoidCallback onTap;

  @override
  State<_SyncButton> createState() => _SyncButtonState();
}

class _SyncButtonState extends State<_SyncButton> with SingleTickerProviderStateMixin {
  late final AnimationController _spin = AnimationController(vsync: this, duration: const Duration(milliseconds: 1000));

  @override
  void didUpdateWidget(_SyncButton old) {
    super.didUpdateWidget(old);
    if (widget.downloading && !_spin.isAnimating) _spin.repeat();
    if (!widget.downloading && _spin.isAnimating) _spin.stop();
  }

  @override
  void initState() {
    super.initState();
    if (widget.downloading) _spin.repeat();
  }

  @override
  void dispose() {
    _spin.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final label = widget.downloading ? 'Descargando…' : (widget.refresh ? 'Descargar de nuevo' : 'Descargar datos');
    final icon = RotationTransition(turns: _spin, child: Icon(widget.refresh || widget.downloading ? Icons.sync_rounded : Icons.download_rounded, size: 22));
    final child = Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        IconTheme(data: IconThemeData(color: widget.refresh ? Brand.text : Brand.yellowInk), child: icon),
        const SizedBox(width: 10),
        Text(label, style: TextStyle(fontFamily: Fonts.body, fontWeight: FontWeight.w800, fontSize: 16.5, color: widget.refresh ? Brand.text : Brand.yellowInk)),
      ],
    );
    return PressScale(
      onTap: widget.downloading ? null : widget.onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 240),
        height: 54,
        decoration: BoxDecoration(
          color: widget.refresh ? Brand.surface2 : Brand.yellow,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: widget.refresh ? Brand.stroke : Colors.transparent),
        ),
        child: child,
      ),
    );
  }
}

class _MethodTile extends StatelessWidget {
  const _MethodTile({required this.method, required this.onTap});

  final AccessMethod method;
  final VoidCallback onTap;

  Color get _color => switch (method) {
        AccessMethod.qr => Brand.yellow,
        AccessMethod.barcode => Brand.blue,
        AccessMethod.nfc => Brand.violet,
      };

  @override
  Widget build(BuildContext context) {
    return PressScale(
      onTap: onTap,
      scale: 0.97,
      child: Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: _color.withValues(alpha: 0.4)),
          gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [_color.withValues(alpha: 0.18), _color.withValues(alpha: 0.04)]),
        ),
        child: Row(
          children: [
            Container(
              width: 60,
              height: 60,
              decoration: BoxDecoration(color: _color, borderRadius: BorderRadius.circular(18), boxShadow: [BoxShadow(color: _color.withValues(alpha: 0.35), blurRadius: 18, offset: const Offset(0, 6))]),
              child: Icon(method.icon, size: 32, color: Brand.ink),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(method.label.toUpperCase(), style: Type.title.copyWith(fontSize: 24)),
                  const SizedBox(height: 2),
                  Text(method.hint, style: Type.muted.copyWith(fontSize: 14)),
                ],
              ),
            ),
            Icon(Icons.arrow_forward_rounded, color: _color),
          ],
        ),
      ),
    );
  }
}
