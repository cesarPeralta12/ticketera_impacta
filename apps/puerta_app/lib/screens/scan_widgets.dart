import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';
import 'result_overlay.dart';

// ───────────────────────── Visor de la cámara ─────────────────────────

/// Marco de lectura: cuatro esquinas que laten y una línea de luz que recorre el cuadro. Al detectar un código
/// las esquinas se cierran sobre él y toman el color del resultado.
class ScanFrame extends StatefulWidget {
  const ScanFrame({super.key, this.color = Colors.white, this.locked = false, this.size = 270});

  final Color color;
  final bool locked;
  final double size;

  @override
  State<ScanFrame> createState() => _ScanFrameState();
}

class _ScanFrameState extends State<ScanFrame> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 2200))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Center(
        child: TweenAnimationBuilder<double>(
          tween: Tween(begin: 1, end: widget.locked ? 0.9 : 1),
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOutBack,
          builder: (context, scale, _) => Transform.scale(
            scale: scale,
            child: SizedBox(
              width: widget.size,
              height: widget.size,
              child: AnimatedBuilder(
                animation: _c,
                builder: (context, _) => CustomPaint(painter: _FramePainter(widget.color, _c.value, widget.locked)),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _FramePainter extends CustomPainter {
  _FramePainter(this.color, this.t, this.locked);

  final Color color;
  final double t;
  final bool locked;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final pulse = locked ? 1.0 : 0.82 + 0.18 * math.sin(t * math.pi * 2);
    final len = size.width * 0.17;
    final corner = Paint()
      ..color = color.withValues(alpha: pulse)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 5
      ..strokeCap = StrokeCap.round;
    const r = 26.0;
    final path = Path()
      // arriba-izquierda
      ..moveTo(rect.left, rect.top + len)
      ..lineTo(rect.left, rect.top + r)
      ..quadraticBezierTo(rect.left, rect.top, rect.left + r, rect.top)
      ..lineTo(rect.left + len, rect.top)
      // arriba-derecha
      ..moveTo(rect.right - len, rect.top)
      ..lineTo(rect.right - r, rect.top)
      ..quadraticBezierTo(rect.right, rect.top, rect.right, rect.top + r)
      ..lineTo(rect.right, rect.top + len)
      // abajo-derecha
      ..moveTo(rect.right, rect.bottom - len)
      ..lineTo(rect.right, rect.bottom - r)
      ..quadraticBezierTo(rect.right, rect.bottom, rect.right - r, rect.bottom)
      ..lineTo(rect.right - len, rect.bottom)
      // abajo-izquierda
      ..moveTo(rect.left + len, rect.bottom)
      ..lineTo(rect.left + r, rect.bottom)
      ..quadraticBezierTo(rect.left, rect.bottom, rect.left, rect.bottom - r)
      ..lineTo(rect.left, rect.bottom - len);
    canvas.drawPath(path, corner);

    if (!locked) {
      // Línea de luz que sube y baja.
      final p = t < 0.5 ? t * 2 : (1 - t) * 2;
      final y = rect.top + 14 + (size.height - 28) * Curves.easeInOut.transform(p);
      final line = Paint()
        ..shader = LinearGradient(colors: [color.withValues(alpha: 0), color.withValues(alpha: 0.95), color.withValues(alpha: 0)]).createShader(Rect.fromLTWH(rect.left, y - 1, size.width, 2));
      canvas.drawRect(Rect.fromLTWH(rect.left + 10, y - 1.5, size.width - 20, 3), line);
      final glow = Paint()
        ..shader = LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [color.withValues(alpha: 0), color.withValues(alpha: 0.16)]).createShader(Rect.fromLTWH(rect.left, y - 60, size.width, 60));
      canvas.drawRect(Rect.fromLTWH(rect.left + 10, y - 60, size.width - 20, 60), glow);
    }
  }

  @override
  bool shouldRepaint(_FramePainter old) => old.t != t || old.color != color || old.locked != locked;
}

// ───────────────────────── Espera de NFC ─────────────────────────

/// Ondas que salen del icono mientras se espera una pulsera o tarjeta.
class NfcWaiting extends StatefulWidget {
  const NfcWaiting({super.key, this.message, this.color = Brand.violet});

  final String? message;
  final Color color;

  @override
  State<NfcWaiting> createState() => _NfcWaitingState();
}

class _NfcWaitingState extends State<NfcWaiting> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 2600))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final failed = widget.message != null;
    final color = failed ? Brand.red : widget.color;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 280,
            height: 280,
            child: AnimatedBuilder(
              animation: _c,
              builder: (context, _) => CustomPaint(
                painter: failed ? null : _RipplePainter(color, _c.value),
                child: Center(
                  child: Container(
                    width: 110,
                    height: 110,
                    decoration: BoxDecoration(shape: BoxShape.circle, color: color.withValues(alpha: 0.18), border: Border.all(color: color.withValues(alpha: 0.6), width: 2)),
                    child: Icon(failed ? Icons.nfc_rounded : Icons.nfc_rounded, size: 54, color: color),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 14),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 34),
            child: Text(
              widget.message ?? 'Acerca la pulsera o tarjeta a la parte de atrás del teléfono',
              textAlign: TextAlign.center,
              style: Type.heading.copyWith(fontSize: 20, color: failed ? const Color(0xFFFFC2C8) : Brand.text),
            ),
          ),
        ],
      ),
    );
  }
}

class _RipplePainter extends CustomPainter {
  _RipplePainter(this.color, this.t);

  final Color color;
  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    for (var i = 0; i < 3; i++) {
      final p = (t + i / 3) % 1;
      final radius = 56 + p * (size.width / 2 - 56);
      canvas.drawCircle(c, radius, Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3
        ..color = color.withValues(alpha: (1 - p) * 0.55));
    }
  }

  @override
  bool shouldRepaint(_RipplePainter old) => old.t != t;
}

// ───────────────────────── Confirmación de ingreso ─────────────────────────

/// Cuánto tiempo tiene el portero para aceptar antes de que la lectura se cancele sola.
const confirmSeconds = 12;

/// Hoja con los datos de la entrada. Devuelve true solo si el portero la acepta a tiempo.
Future<bool> showConfirmSheet(BuildContext context, {required ScanOutcome outcome, String? sectionName, String? gateName}) async {
  final accepted = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    isDismissible: true,
    backgroundColor: Brand.surface2,
    barrierColor: Colors.black.withValues(alpha: 0.6),
    builder: (context) => _ConfirmSheet(outcome: outcome, sectionName: sectionName, gateName: gateName),
  );
  return accepted == true;
}

class _ConfirmSheet extends StatefulWidget {
  const _ConfirmSheet({required this.outcome, this.sectionName, this.gateName});

  final ScanOutcome outcome;
  final String? sectionName;
  final String? gateName;

  @override
  State<_ConfirmSheet> createState() => _ConfirmSheetState();
}

class _ConfirmSheetState extends State<_ConfirmSheet> with SingleTickerProviderStateMixin {
  late final AnimationController _timer = AnimationController(vsync: this, duration: const Duration(seconds: confirmSeconds))
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
    final o = widget.outcome;
    final t = o.ticket!;
    final movement = o.movement ?? Movement.entry;
    final style = OutcomeStyle.of(o);
    final action = switch (movement) {
      Movement.reentry => 'ACEPTAR REINGRESO',
      Movement.zoneChange => 'DEJAR PASAR',
      Movement.exit => 'REGISTRAR SALIDA',
      Movement.entry => 'ACEPTAR INGRESO',
    };
    final rows = <(IconData, String, String)>[
      (Icons.confirmation_number_outlined, 'Tipo', t.type ?? '—'),
      if (widget.sectionName != null) (Icons.grid_view_rounded, 'Sector', widget.sectionName!),
      if (t.seat != null) (Icons.event_seat_outlined, 'Asiento', t.seat!),
      if (t.document != null && t.document!.isNotEmpty) (Icons.badge_outlined, 'Carnet', t.document!),
      (Icons.tag_rounded, 'Código', _code(t.code)),
      if (widget.gateName != null) (Icons.meeting_room_outlined, 'Puerta', widget.gateName!),
      if (t.maxEntries != 1) (Icons.repeat_rounded, 'Ingresos', t.maxEntries == 0 ? 'Sin límite (lleva ${t.entryCount})' : '${t.entryCount} de ${t.maxEntries} usados'),
    ];
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(22, 10, 22, 18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(child: Container(width: 44, height: 5, decoration: BoxDecoration(color: Brand.surface3, borderRadius: BorderRadius.circular(3)))),
            const SizedBox(height: 18),
            Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(color: style.color.withValues(alpha: 0.18), shape: BoxShape.circle),
                  child: Icon(Icons.verified_rounded, color: style.color, size: 22),
                ),
                const SizedBox(width: 10),
                Text(movement == Movement.reentry ? 'REINGRESO' : (movement == Movement.zoneChange ? 'PASO A ZONA' : 'ENTRADA VÁLIDA'), style: Type.label.copyWith(color: style.color, fontSize: 13)),
              ],
            ),
            const SizedBox(height: 12),
            Text((t.holder ?? 'Sin nombre'), style: const TextStyle(fontFamily: Fonts.display, fontSize: 27, fontWeight: FontWeight.w700, height: 1.15, letterSpacing: -0.4, color: Brand.text), maxLines: 2, overflow: TextOverflow.ellipsis),
            const SizedBox(height: 16),
            for (final (icon, label, value) in rows)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Row(
                  children: [
                    Icon(icon, size: 19, color: Brand.muted),
                    const SizedBox(width: 12),
                    SizedBox(width: 112, child: Text(label, style: Type.muted)),
                    Expanded(child: Text(value, style: Type.body.copyWith(fontWeight: FontWeight.w700))),
                  ],
                ),
              ),
            const SizedBox(height: 16),
            AnimatedBuilder(
              animation: _timer,
              builder: (context, _) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(value: 1 - _timer.value, minHeight: 5, backgroundColor: Brand.surface3, color: _timer.value > 0.75 ? Brand.amber : Brand.muted),
                  ),
                  const SizedBox(height: 6),
                  Text('Se cancela sola en ${(confirmSeconds * (1 - _timer.value)).ceil()} s si no aceptas', style: Type.muted.copyWith(fontSize: 12.5)),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  flex: 2,
                  child: PressScale(
                    onTap: () => Navigator.of(context).pop(false),
                    child: Container(
                      height: 62,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(borderRadius: BorderRadius.circular(18), border: Border.all(color: Brand.stroke), color: Brand.surface3),
                      child: Text('CANCELAR', style: Type.label.copyWith(fontSize: 14, color: Brand.text)),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 3,
                  child: PressScale(
                    onTap: () {
                      HapticFeedback.mediumImpact();
                      Navigator.of(context).pop(true);
                    },
                    haptic: false,
                    scale: 0.96,
                    child: Container(
                      height: 62,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(18),
                        color: style.color,
                        boxShadow: [BoxShadow(color: style.color.withValues(alpha: 0.4), blurRadius: 22, offset: const Offset(0, 8))],
                      ),
                      child: Text(action, style: const TextStyle(fontFamily: Fonts.body, fontSize: 17, fontWeight: FontWeight.w800, color: Brand.ink, letterSpacing: 0.6)),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ───────────────────────── ¿Es una salida? ─────────────────────────

enum ExitChoice { exit, used, cancelled }

/// La entrada ya ingresó y se leyó otra vez: el portero decide si la persona está saliendo o si es una entrada ya
/// usada. Cerrar la hoja (o dejar pasar el tiempo) cancela la lectura sin registrar nada.
Future<ExitChoice> showExitSheet(BuildContext context, {required ScanOutcome outcome}) async {
  final choice = await showModalBottomSheet<ExitChoice>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Brand.surface2,
    barrierColor: Colors.black.withValues(alpha: 0.6),
    builder: (context) => _ExitSheet(outcome: outcome),
  );
  return choice ?? ExitChoice.cancelled;
}

class _ExitSheet extends StatefulWidget {
  const _ExitSheet({required this.outcome});

  final ScanOutcome outcome;

  @override
  State<_ExitSheet> createState() => _ExitSheetState();
}

class _ExitSheetState extends State<_ExitSheet> with SingleTickerProviderStateMixin {
  late final AnimationController _timer = AnimationController(vsync: this, duration: const Duration(seconds: confirmSeconds))
    ..addStatusListener((status) {
      if (status == AnimationStatus.completed && mounted) Navigator.of(context).pop(ExitChoice.cancelled);
    })
    ..forward();

  @override
  void dispose() {
    _timer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.outcome.ticket!;
    const color = Brand.blue;
    final at = t.usedAt;
    final since = at == null ? null : '${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}';
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(22, 10, 22, 18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(child: Container(width: 44, height: 5, decoration: BoxDecoration(color: Brand.surface3, borderRadius: BorderRadius.circular(3)))),
            const SizedBox(height: 18),
            Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(color: color.withValues(alpha: 0.18), shape: BoxShape.circle),
                  child: const Icon(Icons.logout_rounded, color: color, size: 22),
                ),
                const SizedBox(width: 10),
                Text('ESTA ENTRADA YA INGRESÓ', style: Type.label.copyWith(color: color, fontSize: 13)),
              ],
            ),
            const SizedBox(height: 12),
            Text(t.holder ?? 'Sin nombre', style: const TextStyle(fontFamily: Fonts.display, fontSize: 27, fontWeight: FontWeight.w700, height: 1.15, letterSpacing: -0.4, color: Brand.text), maxLines: 2, overflow: TextOverflow.ellipsis),
            const SizedBox(height: 8),
            Text(
              [if (t.type != null) t.type!, if (since != null) 'Ingresó a las $since'].join(' · '),
              style: Type.muted.copyWith(fontSize: 15),
            ),
            const SizedBox(height: 18),
            Text('¿Es una salida?', style: Type.heading.copyWith(fontSize: 26)),
            const SizedBox(height: 4),
            const Text('Si la persona está saliendo, se registra su salida y podrá volver a entrar con el mismo QR.', style: Type.muted),
            const SizedBox(height: 16),
            AnimatedBuilder(
              animation: _timer,
              builder: (context, _) => ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(value: 1 - _timer.value, minHeight: 5, backgroundColor: Brand.surface3, color: _timer.value > 0.75 ? Brand.amber : Brand.muted),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  flex: 2,
                  child: PressScale(
                    onTap: () => Navigator.of(context).pop(ExitChoice.used),
                    child: Container(
                      height: 62,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(borderRadius: BorderRadius.circular(18), border: Border.all(color: Brand.stroke), color: Brand.surface3),
                      child: Text('NO, YA USADA', textAlign: TextAlign.center, style: Type.label.copyWith(fontSize: 14, color: Brand.text)),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 3,
                  child: PressScale(
                    onTap: () {
                      HapticFeedback.mediumImpact();
                      Navigator.of(context).pop(ExitChoice.exit);
                    },
                    haptic: false,
                    scale: 0.96,
                    child: Container(
                      height: 62,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(18),
                        color: color,
                        boxShadow: [BoxShadow(color: color.withValues(alpha: 0.4), blurRadius: 22, offset: const Offset(0, 8))],
                      ),
                      child: const Text('SÍ, ES SALIDA', style: TextStyle(fontFamily: Fonts.body, fontSize: 17, fontWeight: FontWeight.w800, color: Brand.ink, letterSpacing: 0.6)),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ───────────────────────── Escribir el código ─────────────────────────

/// Pide el código a mano (y el número de 6 dígitos si es de QR dinámico). Devuelve el texto o null.
Future<String?> showManualEntry(BuildContext context) {
  final code = TextEditingController();
  final otp = TextEditingController();
  String joined() => '${code.text.trim()} ${otp.text.trim()}'.trim();
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    builder: (context) => Padding(
      padding: EdgeInsets.fromLTRB(22, 6, 22, 22 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Escribir el código', style: Type.title),
          const SizedBox(height: 4),
          const Text('Por si el lector no puede leer la entrada.', style: Type.muted),
          const SizedBox(height: 18),
          AppField(controller: code, label: 'Código de la entrada', icon: Icons.tag_rounded, autofocus: true, capitalization: TextCapitalization.characters),
          const SizedBox(height: 12),
          AppField(
            controller: otp,
            label: 'Número de 6 dígitos (solo QR dinámico)',
            icon: Icons.pin_outlined,
            keyboardType: TextInputType.number,
            onSubmitted: (_) => Navigator.pop(context, joined()),
          ),
          const SizedBox(height: 18),
          PrimaryButton(label: 'VALIDAR', icon: Icons.check_rounded, onPressed: () => Navigator.pop(context, joined())),
        ],
      ),
    ),
  );
}

// ───────────────────────── Últimas lecturas ─────────────────────────

Future<void> showRecentScans(BuildContext context, Future<List<RecentScan>> Function() load) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.62,
      maxChildSize: 0.92,
      minChildSize: 0.35,
      builder: (context, controller) => FutureBuilder<List<RecentScan>>(
        future: load(),
        builder: (context, snapshot) {
          final list = snapshot.data ?? const <RecentScan>[];
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Padding(padding: EdgeInsets.fromLTRB(22, 0, 22, 12), child: Text('Últimas lecturas', style: Type.title)),
              Expanded(
                child: !snapshot.hasData
                    ? const Center(child: CircularProgressIndicator(color: Brand.accent))
                    : list.isEmpty
                        ? Center(child: Text('Todavía no leíste ninguna entrada.', style: Type.muted.copyWith(fontSize: 15)))
                        : ListView.separated(
                            controller: controller,
                            padding: const EdgeInsets.fromLTRB(18, 0, 18, 24),
                            itemCount: list.length,
                            separatorBuilder: (_, _) => const SizedBox(height: 8),
                            itemBuilder: (context, i) => StaggerIn(index: i.clamp(0, 6), offset: 10, child: _RecentTile(scan: list[i])),
                          ),
              ),
            ],
          );
        },
      ),
    ),
  );
}

class _RecentTile extends StatelessWidget {
  const _RecentTile({required this.scan});

  final RecentScan scan;

  @override
  Widget build(BuildContext context) {
    final style = OutcomeStyle.of(ScanOutcome(verdict: scan.verdict, movement: scan.movement));
    final time = '${scan.at.hour.toString().padLeft(2, '0')}:${scan.at.minute.toString().padLeft(2, '0')}';
    final title = scan.verdict.ok ? (scan.movement ?? Movement.entry).label : scan.verdict.title;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: Brand.surface, borderRadius: BorderRadius.circular(16), border: Border.all(color: Brand.stroke)),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(color: style.color.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(13)),
            child: Icon(style.icon, color: style.color, size: 24),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(scan.holder ?? (scan.code != null ? 'Código ${scan.code}' : 'Código no válido'), style: Type.body.copyWith(fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
                Text([title, if (scan.type != null) scan.type!].join(' · '), style: Type.muted.copyWith(fontSize: 13), maxLines: 1, overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
          Text(time, style: Type.muted.copyWith(fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}
