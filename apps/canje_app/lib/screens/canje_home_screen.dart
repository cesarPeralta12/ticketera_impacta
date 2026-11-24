import 'package:flutter/material.dart';

import '../api.dart';
import '../app_services.dart';
import '../door_service.dart';
import '../models.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';
import 'account_sheet.dart';
import 'read_card_screen.dart';
import 'redeem_screen.dart';

/// Inicio del canje: elige la función, descarga las entradas y abre «Canjear» o «Leer tarjeta».
class CanjeHomeScreen extends StatefulWidget {
  const CanjeHomeScreen({super.key, required this.service});

  final DoorService service;

  @override
  State<CanjeHomeScreen> createState() => _CanjeHomeScreenState();
}

class _CanjeHomeScreenState extends State<CanjeHomeScreen> {
  DoorService get _s => widget.service;

  bool _loading = true;
  bool _downloading = false;
  String? _error;
  Assignment? _selected;
  SessionMeta? _meta;

  @override
  void initState() {
    super.initState();
    _s.onSessionExpired = () {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Tu sesión terminó. Inicia sesión de nuevo.')));
    };
    _load();
  }

  @override
  void dispose() {
    _s.onSessionExpired = null;
    super.dispose();
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
      if (!e.unauthorized) _error = e.offline ? 'Sin conexión. Revisa tu internet.' : e.message;
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _select(Assignment? a) async {
    _selected = a;
    _meta = a == null ? null : await _s.meta(a.sessionId);
    if (mounted) setState(() {});
    if (a != null && _meta == null) await _download();
  }

  Future<void> _download() async {
    final a = _selected;
    if (a == null) return;
    setState(() {
      _downloading = true;
      _error = null;
    });
    try {
      // El canje no depende de una puerta: se baja la lista completa de la función (con la primera puerta que haya).
      _meta = await _s.download(a, a.gates.firstOrNull);
      if (mounted) AppServices.of(context).feedback.done();
    } on ApiException catch (e) {
      _error = e.offline ? 'Sin conexión. Conéctate a internet para descargar las entradas.' : e.message;
    }
    if (mounted) setState(() => _downloading = false);
  }

  String _date(DateTime d) {
    final t = d.toLocal();
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return '${t.day} ${months[t.month - 1]} · ${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
  }

  Future<void> _pick() async {
    final list = _s.assignments;
    final chosen = await showModalBottomSheet<Assignment>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          children: [
            const Padding(padding: EdgeInsets.only(bottom: 12), child: Text('Elige el evento', style: Type.title)),
            for (final a in list)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: PressScale(
                  onTap: () => Navigator.pop(context, a),
                  child: SoftCard(
                    borderColor: a.sessionId == _selected?.sessionId ? Brand.accent : null,
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(a.title, style: Type.heading, maxLines: 2, overflow: TextOverflow.ellipsis),
                        const SizedBox(height: 3),
                        Text('${_date(a.startsAt)} · ${a.venue}', style: Type.muted),
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

  void _open(Widget screen) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));

  @override
  Widget build(BuildContext context) {
    final a = _selected;
    final meta = _meta;
    final name = (_s.staffName ?? 'operador').trim();
    final first = name.split(' ').first;
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
                  const BrandMark(height: 26, suffix: 'CANJE'),
                  const Spacer(),
                  PressScale(
                    onTap: () => showAccountSheet(context, service: _s),
                    scale: 0.92,
                    child: Container(
                      width: 46,
                      height: 46,
                      alignment: Alignment.center,
                      decoration: const BoxDecoration(shape: BoxShape.circle, color: Brand.accent),
                      child: Text(first.isEmpty ? 'C' : first.characters.first.toUpperCase(), style: const TextStyle(fontFamily: Fonts.display, fontSize: 19, fontWeight: FontWeight.w700, color: Brand.accentInk)),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 22),
              Text('Hola, $first', style: Type.title.copyWith(fontSize: 24)),
              const SizedBox(height: 2),
              const Text('Cambia una entrada por una tarjeta o manilla NFC.', style: Type.muted),
              const SizedBox(height: 20),
              if (_error != null) ...[
                Container(
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
                const SizedBox(height: 14),
              ],
              if (_loading)
                const Padding(padding: EdgeInsets.symmetric(vertical: 60), child: Center(child: CircularProgressIndicator(color: Brand.accent)))
              else if (a == null)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 40),
                  child: Text('No tienes eventos asignados. Pídele al administrador que te asigne una función y desliza hacia abajo para actualizar.', textAlign: TextAlign.center, style: Type.muted),
                )
              else ...[
                SoftCard(
                  padding: const EdgeInsets.fromLTRB(20, 18, 20, 18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text('EVENTO', style: Type.label.copyWith(color: Brand.highlight)),
                          const Spacer(),
                          if (_s.assignments.length > 1)
                            PressScale(onTap: _pick, child: const Pill('Cambiar', icon: Icons.unfold_more_rounded, color: Brand.text, small: true)),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Text(a.title, style: Type.title.copyWith(fontSize: 22), maxLines: 3, overflow: TextOverflow.ellipsis),
                      const SizedBox(height: 8),
                      Text('${_date(a.startsAt)} · ${a.venue}', style: Type.muted),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                SoftCard(
                  padding: const EdgeInsets.all(18),
                  child: Row(
                    children: [
                      Icon(meta == null ? Icons.cloud_download_outlined : Icons.cloud_done_outlined, color: meta == null ? Brand.accent : Brand.green),
                      const SizedBox(width: 12),
                      Expanded(child: Text(meta == null ? 'Entradas sin descargar' : 'Entradas descargadas', style: Type.body.copyWith(fontWeight: FontWeight.w700))),
                      GestureDetector(
                        onTap: _downloading ? null : _download,
                        child: _downloading
                            ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Brand.accent))
                            : Text(meta == null ? 'Descargar' : 'Actualizar', style: Type.body.copyWith(color: Brand.pink, fontWeight: FontWeight.w700)),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 22),
                if (meta == null)
                  Text('Descarga las entradas para empezar a canjear.', textAlign: TextAlign.center, style: Type.muted.copyWith(fontSize: 15))
                else ...[
                  PrimaryButton(label: 'Canjear entrada', icon: Icons.nfc_rounded, onPressed: () => _open(RedeemScreen(service: _s, meta: meta, assignment: a))),
                  const SizedBox(height: 12),
                  GhostButton(label: 'Leer una tarjeta', icon: Icons.contactless_outlined, onPressed: () => _open(ReadCardScreen(service: _s, meta: meta))),
                ],
              ],
            ],
          ),
        ),
      ),
    );
  }
}
