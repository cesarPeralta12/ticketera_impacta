import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../door_service.dart';
import '../models.dart';
import 'scan_screen.dart';

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
  ({int total, int used}) _counts = (total: 0, used: 0);
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
      _loading = true;
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
    return '${t.day} ${months[t.month - 1]} · ${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
  }

  Future<void> _logout() async {
    final pending = _selected == null ? 0 : _s.pendingCount;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cerrar sesión'),
        content: Text(
          pending > 0
              ? 'Hay $pending lectura(s) sin subir. Si cierras sesión se borrarán de este teléfono. ¿Cerrar igual?'
              : 'Se borrarán las entradas descargadas de este teléfono.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(context, true), style: FilledButton.styleFrom(minimumSize: const Size(100, 44)), child: const Text('Cerrar sesión')),
        ],
      ),
    );
    if (ok == true) await _s.logout();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final a = _selected;
    final meta = _meta;
    // Los datos descargados son de otra puerta que la elegida: hay que volver a descargar.
    final gateChanged = meta != null && (meta.gateId ?? '') != (_gateId ?? '') && !_downloading;
    final ready = meta != null && !gateChanged;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Impacta Puerta'),
        actions: [
          IconButton(tooltip: 'Actualizar funciones', onPressed: _loading ? null : _load, icon: const Icon(Icons.refresh)),
          IconButton(tooltip: 'Cerrar sesión', onPressed: _logout, icon: const Icon(Icons.logout)),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text('Hola, ${_s.staffName ?? 'portero'}', style: Theme.of(context).textTheme.titleMedium?.copyWith(color: scheme.onSurfaceVariant)),
                const SizedBox(height: 16),
                if (_error != null) ...[
                  Card(color: scheme.errorContainer, child: Padding(padding: const EdgeInsets.all(14), child: Text(_error!, style: TextStyle(color: scheme.onErrorContainer)))),
                  const SizedBox(height: 12),
                ],
                if (a == null)
                  const _EmptyState()
                else ...[
                  _SessionCard(
                    assignments: _s.assignments,
                    selected: a,
                    onChanged: (v) => _select(v),
                    dateLabel: _date(a.startsAt),
                  ),
                  if (a.gates.length > 1) ...[
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      initialValue: _gateId,
                      decoration: const InputDecoration(labelText: 'Puerta'),
                      items: [for (final g in a.gates) DropdownMenuItem(value: g.id, child: Text(g.name))],
                      onChanged: (v) => setState(() => _gateId = v),
                    ),
                  ] else if (a.gates.length == 1) ...[
                    const SizedBox(height: 10),
                    Text('Puerta: ${a.gates.first.name}', style: TextStyle(color: scheme.onSurfaceVariant)),
                  ],
                  const SizedBox(height: 16),
                  _DataCard(
                    meta: gateChanged ? null : meta,
                    counts: _counts,
                    downloading: _downloading,
                    pending: _s.pendingCount,
                    conflicts: _s.conflictCount,
                    syncedAt: meta == null ? null : _clock(meta.syncedAt),
                    onDownload: _download,
                    refresh: meta != null && !gateChanged,
                  ),
                  const SizedBox(height: 20),
                  if (!ready)
                    Text(
                      'Descarga los datos para empezar a leer entradas.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: scheme.onSurfaceVariant),
                    )
                  else if (a.methods.isEmpty)
                    Text('Las entradas de esta función no tienen un método de lectura configurado.', style: TextStyle(color: scheme.error))
                  else
                    for (final m in a.methods) ...[
                      _MethodButton(
                        method: m,
                        onTap: () => Navigator.of(context)
                            .push(MaterialPageRoute<void>(builder: (_) => ScanScreen(service: _s, meta: meta, method: m, assignment: a)))
                            .then((_) => _backgroundSync()),
                      ),
                      const SizedBox(height: 12),
                    ],
                ],
              ],
            ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48),
      child: Column(
        children: [
          Icon(Icons.event_busy, size: 56, color: scheme.onSurfaceVariant),
          const SizedBox(height: 12),
          Text('No tienes eventos asignados', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 6),
          Text(
            'Pídele al administrador que te asigne una función en el panel y toca actualizar.',
            textAlign: TextAlign.center,
            style: TextStyle(color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _SessionCard extends StatelessWidget {
  const _SessionCard({required this.assignments, required this.selected, required this.onChanged, required this.dateLabel});

  final List<Assignment> assignments;
  final Assignment selected;
  final ValueChanged<Assignment?> onChanged;
  final String dateLabel;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('EVENTO', style: Theme.of(context).textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant, letterSpacing: 1)),
            const SizedBox(height: 4),
            if (assignments.length > 1)
              DropdownButton<Assignment>(
                isExpanded: true,
                value: selected,
                underline: const SizedBox.shrink(),
                items: [
                  for (final x in assignments) DropdownMenuItem(value: x, child: Text(x.title, overflow: TextOverflow.ellipsis)),
                ],
                onChanged: onChanged,
              )
            else
              Text(selected.title, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 4),
            Text('$dateLabel · ${selected.venue}', style: TextStyle(color: scheme.onSurfaceVariant)),
          ],
        ),
      ),
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
  final ({int total, int used}) counts;
  final bool downloading;
  final int pending;
  final int conflicts;
  final String? syncedAt;
  final VoidCallback onDownload;
  final bool refresh;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (meta == null)
              Text('Datos sin descargar', style: Theme.of(context).textTheme.titleMedium)
            else ...[
              Row(
                children: [
                  Icon(Icons.check_circle, color: scheme.primary, size: 20),
                  const SizedBox(width: 8),
                  Text('${counts.total} entradas en esta puerta', style: Theme.of(context).textTheme.titleMedium),
                ],
              ),
              const SizedBox(height: 4),
              Text('Ingresaron ${counts.used} · actualizado $syncedAt', style: TextStyle(color: scheme.onSurfaceVariant)),
              if (pending > 0) Text('$pending lectura(s) por subir', style: TextStyle(color: scheme.tertiary)),
              if (conflicts > 0)
                Text('$conflicts entrada(s) ya habían ingresado por otro lector', style: TextStyle(color: scheme.error)),
            ],
            const SizedBox(height: 12),
            downloading
                ? const LinearProgressIndicator()
                : (refresh
                    ? OutlinedButton.icon(onPressed: onDownload, icon: const Icon(Icons.sync), label: const Text('Descargar de nuevo'))
                    : FilledButton.icon(onPressed: onDownload, icon: const Icon(Icons.download), label: const Text('Descargar datos'))),
          ],
        ),
      ),
    );
  }
}

class _MethodButton extends StatelessWidget {
  const _MethodButton({required this.method, required this.onTap});

  final AccessMethod method;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.primaryContainer,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 22),
          child: Row(
            children: [
              Icon(method.icon, size: 38, color: scheme.onPrimaryContainer),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(method.label, style: Theme.of(context).textTheme.titleLarge?.copyWith(color: scheme.onPrimaryContainer)),
                    Text(method.hint, style: TextStyle(color: scheme.onPrimaryContainer.withValues(alpha: 0.8))),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: scheme.onPrimaryContainer),
            ],
          ),
        ),
      ),
    );
  }
}
