import 'dart:async';

import 'package:flutter/material.dart';
import 'package:nfc_manager/nfc_manager.dart';

import '../app_services.dart';
import '../door_service.dart';
import '../models.dart';
import '../nfc_writer.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';
import 'scan_widgets.dart';

/// Grabador de pulseras NFC (solo administradores): se elige la entrada de la lista descargada y se acerca la
/// pulsera. Se graba el código, se vuelve a leer para comprobarlo y queda marcada como grabada.
class BraceletScreen extends StatefulWidget {
  const BraceletScreen({super.key, required this.service, required this.meta, required this.assignment});

  final DoorService service;
  final SessionMeta meta;
  final Assignment assignment;

  @override
  State<BraceletScreen> createState() => _BraceletScreenState();
}

enum _Phase { choose, waiting, writing, done, failed }

class _BraceletScreenState extends State<BraceletScreen> {
  final _query = TextEditingController();
  Timer? _debounce;
  List<TicketRow> _results = const [];
  Set<String> _written = {};
  _Phase _phase = _Phase.choose;
  TicketRow? _target;
  BraceletResult? _result;
  bool _lock = false;
  String? _nfcProblem;
  bool _searching = true;

  String get _sessionId => widget.meta.sessionId;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    if (_phase == _Phase.waiting || _phase == _Phase.writing) NfcManager.instance.stopSession().catchError((_) {});
    super.dispose();
  }

  Future<void> _bootstrap() async {
    final availability = await NfcManager.instance.checkAvailability();
    if (availability != NfcAvailability.enabled && mounted) {
      setState(() => _nfcProblem = availability == NfcAvailability.disabled ? 'El NFC está apagado. Actívalo en los ajustes del teléfono.' : 'Este teléfono no tiene NFC.');
    }
    _written = await widget.service.braceletsWritten(_sessionId);
    await _search();
  }

  Future<void> _search() async {
    final rows = await widget.service.searchBraceletCandidates(_sessionId, _query.text);
    if (!mounted) return;
    setState(() {
      _results = rows;
      _searching = false;
    });
  }

  void _onQuery(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 250), _search);
  }

  Future<void> _start(TicketRow ticket) async {
    if (_nfcProblem != null) return;
    final feedback = AppServices.of(context).feedback;
    setState(() {
      _target = ticket;
      _phase = _Phase.waiting;
      _result = null;
    });
    try {
      await NfcManager.instance.startSession(
        pollingOptions: {NfcPollingOption.iso14443, NfcPollingOption.iso15693},
        onDiscovered: (tag) async {
          if (!mounted) return;
          feedback.detected();
          setState(() => _phase = _Phase.writing);
          final result = await writeBracelet(tag, ticket.code, lock: _lock);
          await NfcManager.instance.stopSession().catchError((_) {});
          if (!mounted) return;
          if (result.ok) {
            feedback.done();
            await widget.service.markBraceletWritten(_sessionId, ticket.code, locked: _lock);
            _written = {..._written, ticket.code};
          } else {
            feedback.fail();
          }
          setState(() {
            _result = result;
            _phase = result.ok ? _Phase.done : _Phase.failed;
          });
        },
      );
    } catch (_) {
      if (mounted) {
        setState(() {
          _result = BraceletResult.failed;
          _phase = _Phase.failed;
        });
      }
    }
  }

  Future<void> _cancel() async {
    await NfcManager.instance.stopSession().catchError((_) {});
    if (mounted) setState(() => _phase = _Phase.choose);
  }

  String _code(String c) => c.length == 10 ? '${c.substring(0, 5)}-${c.substring(5)}' : c;

  @override
  Widget build(BuildContext context) {
    final busy = _phase != _Phase.choose;
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Row(
                children: [
                  RoundIconButton(icon: Icons.arrow_back_rounded, tooltip: 'Volver', onTap: () => Navigator.of(context).maybePop()),
                  const SizedBox(width: 14),
                  const Expanded(child: Text('GRABAR PULSERAS', style: Type.title)),
                ],
              ),
            ),
            if (_nfcProblem != null)
              Container(
                width: double.infinity,
                margin: const EdgeInsets.fromLTRB(16, 14, 16, 0),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(color: Brand.red.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(16), border: Border.all(color: Brand.red.withValues(alpha: 0.4))),
                child: Row(
                  children: [
                    const Icon(Icons.nfc_rounded, color: Brand.red),
                    const SizedBox(width: 10),
                    Expanded(child: Text(_nfcProblem!, style: Type.body.copyWith(color: const Color(0xFFFFC2C8), fontSize: 15))),
                  ],
                ),
              ),
            Expanded(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 320),
                child: busy
                    ? _StatusView(key: ValueKey(_phase), phase: _phase, target: _target, result: _result, lock: _lock, code: _code, onCancel: _cancel, onAnother: () => setState(() => _phase = _Phase.choose), onRetry: () => _start(_target!))
                    : _chooseView(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _chooseView() {
    return Column(
      key: const ValueKey('choose'),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(widget.assignment.title, style: Type.heading, maxLines: 1, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 3),
              Text('Elige la entrada y acerca la pulsera. Solo salen entradas válidas de tipos con NFC.', style: Type.muted.copyWith(fontSize: 13.5)),
              const SizedBox(height: 14),
              AppField(controller: _query, label: 'Nombre, carnet o código', icon: Icons.search_rounded, onChanged: _onQuery, onSubmitted: (_) => _search()),
              const SizedBox(height: 6),
              SoftCard(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                radius: 18,
                child: SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: _lock,
                  onChanged: (v) => setState(() => _lock = v),
                  title: Text('Bloquear la pulsera al grabar', style: Type.body.copyWith(fontWeight: FontWeight.w700)),
                  subtitle: Text('Ya no se podrá volver a escribir. Solo con pulseras definitivas.', style: Type.muted.copyWith(fontSize: 12.5)),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 6),
        Expanded(
          child: _searching
              ? const Center(child: CircularProgressIndicator(color: Brand.yellow))
              : _results.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.all(34),
                      child: Center(
                        child: Text(
                          _query.text.isEmpty
                              ? 'No hay entradas con NFC en esta función. Activa NFC en el tipo de entrada, en el panel, y vuelve a descargar los datos.'
                              : 'Ninguna entrada coincide con la búsqueda.',
                          textAlign: TextAlign.center,
                          style: Type.muted.copyWith(fontSize: 15),
                        ),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                      itemCount: _results.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 8),
                      itemBuilder: (context, i) {
                        final t = _results[i];
                        final done = _written.contains(t.code);
                        return StaggerIn(
                          index: i.clamp(0, 5),
                          offset: 10,
                          child: PressScale(
                            onTap: _nfcProblem == null ? () => _start(t) : null,
                            child: Container(
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(color: Brand.surface, borderRadius: BorderRadius.circular(18), border: Border.all(color: done ? Brand.green.withValues(alpha: 0.4) : Brand.stroke)),
                              child: Row(
                                children: [
                                  Container(
                                    width: 44,
                                    height: 44,
                                    decoration: BoxDecoration(color: (done ? Brand.green : Brand.violet).withValues(alpha: 0.16), borderRadius: BorderRadius.circular(14)),
                                    child: Icon(done ? Icons.check_circle_rounded : Icons.nfc_rounded, color: done ? Brand.green : Brand.violet),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(t.holder ?? 'Sin nombre', style: Type.body.copyWith(fontWeight: FontWeight.w800), maxLines: 1, overflow: TextOverflow.ellipsis),
                                        Text(
                                          [if (t.type != null) t.type!, if (t.seat != null) t.seat!, if (t.document != null && t.document!.isNotEmpty) 'CI ${t.document}', _code(t.code)].join(' · '),
                                          style: Type.muted.copyWith(fontSize: 12.5),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ],
                                    ),
                                  ),
                                  if (done) const Pill('Grabada', color: Brand.green, small: true),
                                ],
                              ),
                            ),
                          ),
                        );
                      },
                    ),
        ),
      ],
    );
  }
}

class _StatusView extends StatelessWidget {
  const _StatusView({
    super.key,
    required this.phase,
    required this.target,
    required this.result,
    required this.lock,
    required this.code,
    required this.onCancel,
    required this.onAnother,
    required this.onRetry,
  });

  final _Phase phase;
  final TicketRow? target;
  final BraceletResult? result;
  final bool lock;
  final String Function(String) code;
  final VoidCallback onCancel;
  final VoidCallback onAnother;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final waiting = phase == _Phase.waiting || phase == _Phase.writing;
    final ok = phase == _Phase.done;
    final color = ok ? Brand.green : (waiting ? Brand.violet : Brand.red);
    final title = switch (phase) {
      _Phase.waiting => 'ACERCA LA PULSERA',
      _Phase.writing => 'GRABANDO… NO LA MUEVAS',
      _Phase.done => 'PULSERA LISTA',
      _ => 'NO SE PUDO GRABAR',
    };
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(26),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (waiting)
              SizedBox(height: 260, child: NfcWaiting(color: color, message: null))
            else
              TweenAnimationBuilder<double>(
                tween: Tween(begin: 0, end: 1),
                duration: const Duration(milliseconds: 650),
                curve: Curves.elasticOut,
                builder: (context, v, child) => Transform.scale(scale: v.clamp(0.0, 1.2), child: child),
                child: Container(
                  width: 130,
                  height: 130,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: color.withValues(alpha: 0.16), border: Border.all(color: color, width: 3)),
                  child: Icon(ok ? Icons.check_rounded : Icons.error_outline_rounded, size: 76, color: color),
                ),
              ),
            const SizedBox(height: 18),
            Text(title, textAlign: TextAlign.center, style: Type.title.copyWith(fontSize: 30)),
            const SizedBox(height: 14),
            if (target != null) ...[
              Text(target!.holder ?? 'Sin nombre', textAlign: TextAlign.center, style: Type.heading.copyWith(fontSize: 24)),
              const SizedBox(height: 4),
              Text('${target!.type ?? ''} · ${code(target!.code)}', textAlign: TextAlign.center, style: Type.muted),
            ],
            if (phase == _Phase.waiting && lock)
              Padding(
                padding: const EdgeInsets.only(top: 14),
                child: const Pill('Se bloqueará al grabar', icon: Icons.lock_outline_rounded, color: Brand.amber),
              ),
            if (phase == _Phase.failed && result != null)
              Padding(
                padding: const EdgeInsets.only(top: 14),
                child: Text(result!.message, textAlign: TextAlign.center, style: Type.body.copyWith(color: const Color(0xFFFFC2C8))),
              ),
            const SizedBox(height: 26),
            if (phase == _Phase.waiting) GhostButton(label: 'Cancelar', onPressed: onCancel),
            if (phase == _Phase.done) PrimaryButton(label: 'GRABAR OTRA', icon: Icons.nfc_rounded, onPressed: onAnother),
            if (phase == _Phase.failed) ...[
              PrimaryButton(label: 'REINTENTAR', icon: Icons.refresh_rounded, onPressed: onRetry),
              const SizedBox(height: 12),
              GhostButton(label: 'Volver a la lista', onPressed: onAnother),
            ],
          ],
        ),
      ),
    );
  }
}
