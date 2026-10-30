/// Piezas visuales reutilizables: fondo animado, tarjetas, botones con rebote, anillo de aforo, contadores, etc.
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'tokens.dart';

/// Fondo de toda la app: casi negro con dos resplandores (amarillo y verde) que se mueven despacio.
class Backdrop extends StatefulWidget {
  const Backdrop({super.key, required this.child, this.intensity = 1});

  final Widget child;
  final double intensity;

  @override
  State<Backdrop> createState() => _BackdropState();
}

class _BackdropState extends State<Backdrop> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(seconds: 22))..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        const ColoredBox(color: Brand.ink),
        RepaintBoundary(
          child: AnimatedBuilder(
            animation: _c,
            builder: (context, _) {
              final t = Curves.easeInOut.transform(_c.value);
              return CustomPaint(painter: _GlowPainter(t, widget.intensity));
            },
          ),
        ),
        widget.child,
      ],
    );
  }
}

class _GlowPainter extends CustomPainter {
  _GlowPainter(this.t, this.intensity);

  final double t;
  final double intensity;

  @override
  void paint(Canvas canvas, Size size) {
    void glow(Offset center, double radius, Color color, double alpha) {
      final paint = Paint()
        ..shader = RadialGradient(colors: [color.withValues(alpha: alpha * intensity), color.withValues(alpha: 0)]).createShader(Rect.fromCircle(center: center, radius: radius));
      canvas.drawCircle(center, radius, paint);
    }

    glow(Offset(size.width * (0.85 - 0.2 * t), size.height * (0.05 + 0.08 * t)), size.width * 0.9, Brand.yellow, 0.16);
    glow(Offset(size.width * (0.05 + 0.25 * t), size.height * (0.95 - 0.12 * t)), size.width * 0.95, Brand.green, 0.13);
  }

  @override
  bool shouldRepaint(_GlowPainter old) => old.t != t || old.intensity != intensity;
}

/// Se achica un poco al tocarlo y rebota al soltar: todo lo tocable se siente "vivo".
class PressScale extends StatefulWidget {
  const PressScale({super.key, required this.child, this.onTap, this.onLongPress, this.scale = 0.96, this.haptic = true, this.radius = 18});

  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final double scale;
  final bool haptic;
  final double radius;

  @override
  State<PressScale> createState() => _PressScaleState();
}

class _PressScaleState extends State<PressScale> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null || widget.onLongPress != null;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: enabled ? (_) => setState(() => _down = true) : null,
      onTapCancel: enabled ? () => setState(() => _down = false) : null,
      onTapUp: enabled ? (_) => setState(() => _down = false) : null,
      onTap: widget.onTap == null
          ? null
          : () {
              if (widget.haptic) HapticFeedback.selectionClick();
              widget.onTap!();
            },
      onLongPress: widget.onLongPress,
      child: AnimatedScale(
        scale: _down ? widget.scale : 1,
        duration: const Duration(milliseconds: 110),
        curve: Curves.easeOut,
        child: widget.child,
      ),
    );
  }
}

/// Entra con un fundido y un pequeño deslizamiento, escalonado por [index].
class StaggerIn extends StatelessWidget {
  const StaggerIn({super.key, required this.child, this.index = 0, this.offset = 18});

  final Widget child;
  final int index;
  final double offset;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: 420 + index * 70),
      curve: Curves.easeOutCubic,
      builder: (context, v, child) => Opacity(
        opacity: v.clamp(0, 1),
        child: Transform.translate(offset: Offset(0, (1 - v) * offset), child: child),
      ),
      child: child,
    );
  }
}

/// Número que "cuenta" hasta su valor nuevo.
class AnimatedNumber extends StatelessWidget {
  const AnimatedNumber({super.key, required this.value, this.style = Type.number, this.duration = const Duration(milliseconds: 600)});

  final int value;
  final TextStyle style;
  final Duration duration;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: value.toDouble()),
      duration: duration,
      curve: Curves.easeOutCubic,
      builder: (context, v, _) => Text('${v.round()}', style: style),
    );
  }
}

/// Anillo de progreso (aforo). Se llena con animación y cambia a ámbar y rojo cuando se acerca al tope.
class RingGauge extends StatelessWidget {
  const RingGauge({super.key, required this.value, this.size = 120, this.stroke = 10, this.color, this.child, this.trackColor = Brand.surface3});

  /// De 0 a 1.
  final double value;
  final double size;
  final double stroke;
  final Color? color;
  final Widget? child;
  final Color trackColor;

  @override
  Widget build(BuildContext context) {
    final v = value.isNaN ? 0.0 : value.clamp(0.0, 1.0);
    final c = color ?? (v >= 0.95 ? Brand.red : (v >= 0.8 ? Brand.amber : Brand.green));
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: v),
      duration: const Duration(milliseconds: 900),
      curve: Curves.easeOutCubic,
      builder: (context, animated, _) => SizedBox(
        width: size,
        height: size,
        child: CustomPaint(
          painter: _RingPainter(animated, stroke, c, trackColor),
          child: Center(child: child),
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter(this.value, this.stroke, this.color, this.track);

  final double value;
  final double stroke;
  final Color color;
  final Color track;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final arc = rect.deflate(stroke / 2);
    final base = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round
      ..color = track;
    canvas.drawArc(arc, 0, math.pi * 2, false, base);
    if (value <= 0) return;
    final glow = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke + 6
      ..strokeCap = StrokeCap.round
      ..color = color.withValues(alpha: 0.18)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6);
    final fg = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round
      ..shader = SweepGradient(
        startAngle: -math.pi / 2,
        endAngle: math.pi * 1.5,
        colors: [color.withValues(alpha: 0.65), color],
        transform: const GradientRotation(0),
      ).createShader(rect);
    canvas.drawArc(arc, -math.pi / 2, math.pi * 2 * value, false, glow);
    canvas.drawArc(arc, -math.pi / 2, math.pi * 2 * value, false, fg);
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.value != value || old.color != color || old.stroke != stroke;
}

/// Etiqueta redondeada con icono opcional.
class Pill extends StatelessWidget {
  const Pill(this.label, {super.key, this.icon, this.color = Brand.muted, this.filled = false, this.small = false});

  final String label;
  final IconData? icon;
  final Color color;
  final bool filled;
  final bool small;

  @override
  Widget build(BuildContext context) {
    final fg = filled ? Brand.ink : color;
    return Container(
      padding: EdgeInsets.symmetric(horizontal: small ? 9 : 12, vertical: small ? 4 : 6),
      decoration: BoxDecoration(
        color: filled ? color : color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(99),
        border: filled ? null : Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: small ? 13 : 15, color: fg), const SizedBox(width: 5)],
          Flexible(
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontFamily: Fonts.body, fontSize: small ? 12 : 13.5, fontWeight: FontWeight.w700, color: fg, letterSpacing: 0.2),
            ),
          ),
        ],
      ),
    );
  }
}

/// Tarjeta con el fondo de la app: borde fino y un degradado casi invisible.
class SoftCard extends StatelessWidget {
  const SoftCard({super.key, required this.child, this.padding = const EdgeInsets.all(18), this.color, this.borderColor, this.radius = 24, this.gradient});

  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color? color;
  final Color? borderColor;
  final double radius;
  final Gradient? gradient;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: gradient == null ? (color ?? Brand.surface) : null,
        gradient: gradient ??
            (color == null
                ? const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF151A21), Color(0xFF0F1318)])
                : null),
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: borderColor ?? Brand.stroke),
      ),
      child: child,
    );
  }
}

class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key, this.trailing});

  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Row(
        children: [
          Expanded(child: Text(text.toUpperCase(), style: Type.label)),
          if (trailing != null) trailing!,
        ],
      );
}

/// "IMPACTA." con el punto amarillo de la marca.
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 30, this.suffix});

  final double size;
  final String? suffix;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      children: [
        Text('IMPACTA', style: TextStyle(fontFamily: Fonts.display, fontSize: size, color: Brand.text, letterSpacing: 1)),
        Text('.', style: TextStyle(fontFamily: Fonts.display, fontSize: size, color: Brand.yellow)),
        if (suffix != null) ...[
          SizedBox(width: size * 0.3),
          Text(suffix!, style: TextStyle(fontFamily: Fonts.body, fontSize: size * 0.42, fontWeight: FontWeight.w700, color: Brand.muted, letterSpacing: 3)),
        ],
      ],
    );
  }
}

/// Botón principal amarillo, grande, con rebote y estado de carga.
class PrimaryButton extends StatelessWidget {
  const PrimaryButton({super.key, required this.label, required this.onPressed, this.icon, this.loading = false, this.color, this.textColor});

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool loading;
  final Color? color;
  final Color? textColor;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !loading;
    final bg = color ?? Brand.yellow;
    final fg = textColor ?? Brand.yellowInk;
    return PressScale(
      onTap: enabled ? onPressed : null,
      scale: 0.97,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        height: 58,
        decoration: BoxDecoration(
          color: enabled ? bg : bg.withValues(alpha: 0.35),
          borderRadius: BorderRadius.circular(18),
          boxShadow: enabled ? [BoxShadow(color: bg.withValues(alpha: 0.32), blurRadius: 22, offset: const Offset(0, 8))] : null,
        ),
        alignment: Alignment.center,
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 180),
          child: loading
              ? SizedBox(key: const ValueKey('l'), width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 3, color: fg))
              : Row(
                  key: const ValueKey('t'),
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (icon != null) ...[Icon(icon, color: fg, size: 22), const SizedBox(width: 10)],
                    Text(label, style: TextStyle(fontFamily: Fonts.body, fontSize: 17.5, fontWeight: FontWeight.w800, color: fg, letterSpacing: 0.5)),
                  ],
                ),
        ),
      ),
    );
  }
}

/// Botón secundario (borde fino).
class GhostButton extends StatelessWidget {
  const GhostButton({super.key, required this.label, required this.onPressed, this.icon, this.color = Brand.text});

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return PressScale(
      onTap: onPressed,
      child: Container(
        height: 54,
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(18), border: Border.all(color: Brand.stroke), color: Brand.surface2.withValues(alpha: 0.6)),
        alignment: Alignment.center,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[Icon(icon, color: color, size: 20), const SizedBox(width: 9)],
            Text(label, style: TextStyle(fontFamily: Fonts.body, fontSize: 16, fontWeight: FontWeight.w700, color: color)),
          ],
        ),
      ),
    );
  }
}

/// Botón redondo para la barra superior (vidrio oscuro).
class RoundIconButton extends StatelessWidget {
  const RoundIconButton({super.key, required this.icon, required this.onTap, this.tooltip, this.active = false, this.badge});

  final IconData icon;
  final VoidCallback? onTap;
  final String? tooltip;
  final bool active;
  final String? badge;

  @override
  Widget build(BuildContext context) {
    final button = PressScale(
      onTap: onTap,
      scale: 0.9,
      child: Container(
        width: 46,
        height: 46,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: active ? Brand.yellow.withValues(alpha: 0.16) : Colors.black.withValues(alpha: 0.38),
          border: Border.all(color: active ? Brand.yellow.withValues(alpha: 0.55) : Brand.stroke),
        ),
        child: Stack(
          alignment: Alignment.center,
          children: [
            Icon(icon, size: 22, color: active ? Brand.yellow : Brand.text),
            if (badge != null)
              Positioned(
                right: 3,
                top: 3,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                  decoration: BoxDecoration(color: Brand.amber, borderRadius: BorderRadius.circular(99)),
                  child: Text(badge!, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: Brand.ink)),
                ),
              ),
          ],
        ),
      ),
    );
    return tooltip == null ? button : Tooltip(message: tooltip!, child: button);
  }
}

/// Sacude el contenido de lado a lado (errores).
class Shake extends StatefulWidget {
  const Shake({super.key, required this.child, this.trigger = 0});

  final Widget child;

  /// Cada vez que cambia, se sacude.
  final int trigger;

  @override
  State<Shake> createState() => _ShakeState();
}

class _ShakeState extends State<Shake> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 480));

  @override
  void didUpdateWidget(Shake old) {
    super.didUpdateWidget(old);
    if (old.trigger != widget.trigger) _c.forward(from: 0);
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, child) {
        final dx = math.sin(_c.value * math.pi * 6) * (1 - _c.value) * 12;
        return Transform.translate(offset: Offset(dx, 0), child: child);
      },
      child: widget.child,
    );
  }
}

/// Cuadro de texto con el estilo de la app.
class AppField extends StatelessWidget {
  const AppField({
    super.key,
    required this.controller,
    required this.label,
    this.icon,
    this.obscure = false,
    this.keyboardType,
    this.textInputAction,
    this.onSubmitted,
    this.onChanged,
    this.autofocus = false,
    this.autofillHints,
    this.suffix,
    this.capitalization = TextCapitalization.none,
  });

  final TextEditingController controller;
  final String label;
  final IconData? icon;
  final bool obscure;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onSubmitted;
  final ValueChanged<String>? onChanged;
  final bool autofocus;
  final Iterable<String>? autofillHints;
  final Widget? suffix;
  final TextCapitalization capitalization;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      obscureText: obscure,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      onSubmitted: onSubmitted,
      onChanged: onChanged,
      autofocus: autofocus,
      autofillHints: autofillHints,
      textCapitalization: capitalization,
      style: Type.body.copyWith(fontSize: 17),
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: icon == null ? null : Icon(icon, size: 21, color: Brand.muted),
        suffixIcon: suffix,
      ),
    );
  }
}

/// Punto de estado que late (conectado, sincronizando).
class PulseDot extends StatefulWidget {
  const PulseDot({super.key, required this.color, this.size = 9, this.pulsing = true});

  final Color color;
  final double size;
  final bool pulsing;

  @override
  State<PulseDot> createState() => _PulseDotState();
}

class _PulseDotState extends State<PulseDot> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: widget.size * 2.4,
      height: widget.size * 2.4,
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) => CustomPaint(painter: _PulsePainter(widget.color, widget.pulsing ? _c.value : 0, widget.size)),
      ),
    );
  }
}

class _PulsePainter extends CustomPainter {
  _PulsePainter(this.color, this.t, this.size);

  final Color color;
  final double t;
  final double size;

  @override
  void paint(Canvas canvas, Size s) {
    final c = s.center(Offset.zero);
    if (t > 0) {
      canvas.drawCircle(c, size / 2 + t * size * 0.9, Paint()..color = color.withValues(alpha: (1 - t) * 0.4));
    }
    canvas.drawCircle(c, size / 2, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_PulsePainter old) => old.t != t || old.color != color;
}
