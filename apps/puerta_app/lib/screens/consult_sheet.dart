import 'package:flutter/material.dart';

import '../models.dart';
import '../presence_view.dart';
import '../ui/tokens.dart';

/// Resultado de una consulta (no registra nada): dónde está la persona y qué pasaría si se leyera aquí.
Future<void> showConsultSheet(BuildContext context, {required ScanOutcome outcome, required PresenceView? view, String? gateName, String? zoneName}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Brand.surface2,
    barrierColor: Colors.black.withValues(alpha: 0.6),
    builder: (context) => _ConsultSheet(outcome: outcome, view: view, gateName: gateName, zoneName: zoneName),
  );
}

class _ConsultSheet extends StatelessWidget {
  const _ConsultSheet({required this.outcome, required this.view, this.gateName, this.zoneName});

  final ScanOutcome outcome;
  final PresenceView? view;
  final String? gateName;
  final String? zoneName;

  @override
  Widget build(BuildContext context) {
    final t = outcome.ticket;
    final v = view;
    // Sin entrada (código inválido o que no existe) solo hay un motivo para mostrar.
    if (t == null || v == null) {
      return _frame(context, color: Brand.red, icon: Icons.close_rounded, title: outcome.title, children: [if (outcome.detail != null) Text(outcome.detail!, style: Type.body)]);
    }
    final (color, icon) = switch (v.state) {
      PresenceState.inside => (Brand.green, Icons.login_rounded),
      PresenceState.left => (Brand.blue, Icons.logout_rounded),
      PresenceState.neverEntered => (Brand.amber, Icons.hourglass_empty_rounded),
    };
    final rows = <(IconData, String, String)>[
      (Icons.confirmation_number_outlined, 'Tipo', t.type ?? '—'),
      if (t.document != null && t.document!.isNotEmpty) (Icons.badge_outlined, 'Carnet', t.document!),
      if (v.opens != null) (Icons.layers_outlined, 'Abre', v.opens!),
      if (v.thisZone != null) (Icons.stars_rounded, 'En ${zoneName ?? 'esta zona'}', v.thisZone! ? 'Sí, está adentro' : 'No está ahí ahora'),
      if (v.entriesLine != null) (Icons.repeat_rounded, 'Ingresos', v.entriesLine!),
      if (v.ifScannedHere != null) (Icons.qr_code_scanner_rounded, 'Aquí ${gateName == null ? '' : '($gateName) '}pasaría', v.ifScannedHere!),
    ];
    return _frame(
      context,
      color: color,
      icon: icon,
      title: v.headline,
      subtitle: t.holder ?? 'Sin nombre',
      children: [
        for (final (i, label, value) in rows)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 5),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(i, size: 19, color: Brand.muted),
                const SizedBox(width: 12),
                SizedBox(width: 112, child: Text(label, style: Type.muted)),
                Expanded(child: Text(value, style: Type.body.copyWith(fontWeight: FontWeight.w700))),
              ],
            ),
          ),
      ],
    );
  }

  Widget _frame(BuildContext context, {required Color color, required IconData icon, required String title, String? subtitle, required List<Widget> children}) {
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
                Container(width: 38, height: 38, decoration: BoxDecoration(color: color.withValues(alpha: 0.18), shape: BoxShape.circle), child: Icon(icon, color: color, size: 22)),
                const SizedBox(width: 10),
                Expanded(child: Text(title, style: Type.label.copyWith(color: color, fontSize: 14), maxLines: 2)),
              ],
            ),
            if (subtitle != null) ...[
              const SizedBox(height: 12),
              Text(subtitle, style: const TextStyle(fontFamily: Fonts.display, fontSize: 25, fontWeight: FontWeight.w700, height: 1.15, color: Brand.text), maxLines: 2, overflow: TextOverflow.ellipsis),
            ],
            const SizedBox(height: 14),
            ...children,
            const SizedBox(height: 10),
            Text('Solo consulta: no se registró nada.', style: Type.muted.copyWith(fontSize: 12.5)),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cerrar')),
            ),
          ],
        ),
      ),
    );
  }
}
