import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../models.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';

/// Color y símbolo de cada resultado: lo que el portero tiene que ver de un vistazo, aunque no lea.
class OutcomeStyle {
  const OutcomeStyle(this.color, this.deep, this.icon);

  final Color color;
  final Color deep;
  final IconData icon;

  static OutcomeStyle of(ScanOutcome o) {
    if (o.verdict.ok) {
      return switch (o.movement ?? Movement.entry) {
        Movement.entry => const OutcomeStyle(Brand.green, Brand.greenDeep, Icons.check_rounded),
        Movement.reentry => const OutcomeStyle(Brand.green, Brand.greenDeep, Icons.replay_rounded),
        Movement.exit => const OutcomeStyle(Brand.blue, Brand.blueDeep, Icons.logout_rounded),
        Movement.zoneChange => const OutcomeStyle(Brand.violet, Brand.violetDeep, Icons.star_rounded),
      };
    }
    if (o.verdict.isWarning) return const OutcomeStyle(Brand.amber, Brand.amberDeep, Icons.priority_high_rounded);
    return const OutcomeStyle(Brand.red, Brand.redDeep, Icons.close_rounded);
  }
}

/// Resultado de una lectura a pantalla completa: color, símbolo animado, nombre y detalles.
class ResultOverlay extends StatefulWidget {
  const ResultOverlay({super.key, required this.outcome, required this.onDismiss, required this.duration, this.zoneLabel});

  final ScanOutcome outcome;
  final VoidCallback onDismiss;
  final Duration duration;

  /// "Zona" a mostrar si la hay (por ejemplo el nombre de la puerta VIP).
  final String? zoneLabel;

  @override
  State<ResultOverlay> createState() => _ResultOverlayState();
}

class _ResultOverlayState extends State<ResultOverlay> with TickerProviderStateMixin {
  late final AnimationController _in = AnimationController(vsync: this, duration: const Duration(milliseconds: 700))..forward();
  late final AnimationController _life = AnimationController(vsync: this, duration: widget.duration)..forward();

  @override
  void dispose() {
    _in.dispose();
    _life.dispose();
    super.dispose();
  }

  Animation<double> _stage(double from, double to, [Curve curve = Curves.easeOutCubic]) =>
      CurvedAnimation(parent: _in, curve: Interval(from, to, curve: curve));

  @override
  Widget build(BuildContext context) {
    final o = widget.outcome;
    final style = OutcomeStyle.of(o);
    final t = o.ticket;
    final bg = _stage(0, 0.4);
    final icon = _stage(0.05, 0.75, Curves.elasticOut);
    final title = _stage(0.25, 0.6);
    final detail = _stage(0.4, 0.8);
    final rejected = !o.verdict.ok && !o.verdict.isWarning;

    final chips = <Widget>[
      if (t?.type != null) Pill(t!.type!, icon: Icons.confirmation_number_outlined, color: Colors.white),
      if (t?.seat != null) Pill(t!.seat!, icon: Icons.event_seat_outlined, color: Colors.white),
      if (widget.zoneLabel != null) Pill(widget.zoneLabel!, icon: Icons.stars_rounded, color: Colors.white),
      if (o.verdict.ok && t != null && t.maxEntries != 1 && o.movement != Movement.exit)
        Pill(t.maxEntries == 0 ? 'Reingresos sin límite' : 'Ingreso ${t.entryCount + 1} de ${t.maxEntries}', icon: Icons.repeat_rounded, color: Colors.white),
    ];

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: widget.onDismiss,
      child: FadeTransition(
        opacity: bg,
        child: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [style.color, style.deep]),
          ),
          child: SafeArea(
            child: Column(
              children: [
                // Barra de tiempo: cuánto falta para que se cierre sola.
                AnimatedBuilder(
                  animation: _life,
                  builder: (context, _) => LinearProgressIndicator(value: 1 - _life.value, minHeight: 4, backgroundColor: Colors.white24, color: Colors.white),
                ),
                const Spacer(flex: 2),
                ScaleTransition(
                  scale: icon,
                  child: _BigSymbol(icon: style.icon, color: style.color, shake: rejected),
                ),
                const SizedBox(height: 26),
                FadeTransition(
                  opacity: title,
                  child: SlideTransition(
                    position: Tween(begin: const Offset(0, 0.25), end: Offset.zero).animate(title),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 24),
                      child: Text(
                        o.title,
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontFamily: Fonts.display, fontSize: 31, fontWeight: FontWeight.w800, height: 1.1, color: Colors.white, letterSpacing: -0.3),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                FadeTransition(
                  opacity: detail,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 26),
                    child: Column(
                      children: [
                        if (t?.holder != null)
                          Text(
                            t!.holder!,
                            textAlign: TextAlign.center,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontFamily: Fonts.body, fontSize: 22, fontWeight: FontWeight.w700, color: Colors.white, height: 1.2),
                          ),
                        if (o.detail != null) ...[
                          const SizedBox(height: 10),
                          Text(
                            o.detail!,
                            textAlign: TextAlign.center,
                            style: TextStyle(fontFamily: Fonts.body, fontSize: 15, fontWeight: FontWeight.w500, color: Colors.white.withValues(alpha: 0.92), height: 1.35),
                          ),
                        ],
                        if (chips.isNotEmpty) ...[
                          const SizedBox(height: 18),
                          Wrap(alignment: WrapAlignment.center, spacing: 8, runSpacing: 8, children: chips),
                        ],
                      ],
                    ),
                  ),
                ),
                const Spacer(flex: 3),
                FadeTransition(opacity: detail, child: Text('Toca para continuar', style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontWeight: FontWeight.w600))),
                const SizedBox(height: 22),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Círculo blanco con el símbolo del resultado y un halo que late.
class _BigSymbol extends StatefulWidget {
  const _BigSymbol({required this.icon, required this.color, required this.shake});

  final IconData icon;
  final Color color;
  final bool shake;

  @override
  State<_BigSymbol> createState() => _BigSymbolState();
}

class _BigSymbolState extends State<_BigSymbol> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1500))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) {
        final halo = Curves.easeOut.transform(_c.value);
        final dx = widget.shake ? math.sin(_c.value * math.pi * 8) * (1 - _c.value).clamp(0.0, 1.0) * 6 : 0.0;
        return Transform.translate(
          offset: Offset(dx, 0),
          child: SizedBox(
            width: 220,
            height: 220,
            child: Stack(
              alignment: Alignment.center,
              children: [
                Container(
                  width: 150 + halo * 70,
                  height: 150 + halo * 70,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white.withValues(alpha: (1 - halo) * 0.22)),
                ),
                Container(
                  width: 150,
                  height: 150,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: Colors.white,
                    boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.25), blurRadius: 40, offset: const Offset(0, 16))],
                  ),
                  child: Icon(widget.icon, size: 92, color: widget.color),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
