import 'package:flutter/material.dart';

import '../api.dart';
import '../app_services.dart';
import '../door_service.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';

String roleLabel(String? role) => switch (role) {
      'OWNER' => 'Dueño',
      'ADMIN' => 'Administrador',
      'OPERATOR' => 'Portero',
      _ => 'Cuenta',
    };

/// Hoja de la cuenta: sonido, vibración, ingreso rápido, pantalla encendida y cerrar sesión.
Future<void> showAccountSheet(BuildContext context, {required DoorService service, int pending = 0}) {
  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (context) => _AccountSheet(service: service, pending: pending),
  );
}

class _AccountSheet extends StatelessWidget {
  const _AccountSheet({required this.service, required this.pending});

  final DoorService service;
  final int pending;

  Future<void> _logout(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        icon: const Icon(Icons.logout_rounded, color: Brand.red, size: 30),
        title: const Text('Cerrar sesión'),
        content: Text(
          pending > 0
              ? 'Hay $pending lectura(s) sin subir. Si cierras sesión se borrarán de este teléfono. ¿Cerrar igual?'
              : 'Se borrarán las entradas descargadas de este teléfono.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            style: FilledButton.styleFrom(minimumSize: const Size(130, 48), backgroundColor: Brand.red, foregroundColor: Colors.white),
            child: const Text('Cerrar sesión'),
          ),
        ],
      ),
    );
    if (ok == true && context.mounted) {
      Navigator.pop(context);
      await service.logout();
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppServices.of(context);
    final settings = app.settings;
    final name = (service.staffName ?? 'Portero').trim();
    return SafeArea(
      child: ListenableBuilder(
        listenable: settings,
        builder: (context, _) => SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(22, 0, 22, 22),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 58,
                    height: 58,
                    alignment: Alignment.center,
                    decoration: const BoxDecoration(shape: BoxShape.circle, gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Brand.pink, Brand.accent])),
                    child: Text(name.characters.first.toUpperCase(), style: const TextStyle(fontFamily: Fonts.display, fontSize: 24, fontWeight: FontWeight.w700, color: Brand.accentInk)),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(name, style: Type.title.copyWith(fontSize: 20), maxLines: 1, overflow: TextOverflow.ellipsis),
                        const SizedBox(height: 4),
                        Wrap(spacing: 8, children: [Pill(roleLabel(service.role), icon: Icons.verified_user_outlined, color: Brand.pink, small: true)]),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 22),
              const SectionLabel('Al leer entradas'),
              const SizedBox(height: 8),
              _Toggle(
                icon: Icons.volume_up_rounded,
                title: 'Sonidos',
                subtitle: 'Un sonido distinto para autorizado, aviso y rechazo.',
                value: settings.sound,
                onChanged: (v) {
                  settings.setSound(v);
                  if (v) app.feedback.done();
                },
              ),
              _Toggle(
                icon: Icons.vibration_rounded,
                title: 'Vibración',
                subtitle: 'Vibra distinto según el resultado.',
                value: settings.haptics,
                onChanged: (v) {
                  settings.setHaptics(v);
                  app.feedback.tap();
                },
              ),
              _Toggle(
                icon: Icons.bolt_rounded,
                title: 'Ingreso rápido',
                subtitle: 'Una entrada válida se acepta sola, sin pedir confirmación. Úsalo con filas largas.',
                value: settings.autoAccept,
                onChanged: settings.setAutoAccept,
              ),
              _Toggle(
                icon: Icons.light_mode_outlined,
                title: 'Pantalla siempre encendida',
                subtitle: 'No se apaga mientras lees.',
                value: settings.keepAwake,
                onChanged: settings.setKeepAwake,
              ),
              const SizedBox(height: 14),
              SoftCard(
                padding: const EdgeInsets.all(14),
                radius: 18,
                child: Row(
                  children: [
                    const Icon(Icons.dns_outlined, size: 20, color: Brand.muted),
                    const SizedBox(width: 12),
                    Expanded(child: Text(service.serverUrl, style: Type.muted, maxLines: 1, overflow: TextOverflow.ellipsis)),
                    Text('v$appVersion', style: Type.muted.copyWith(color: Brand.faint)),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              GhostButton(label: 'Cerrar sesión', icon: Icons.logout_rounded, color: Brand.red, onPressed: () => _logout(context)),
            ],
          ),
        ),
      ),
    );
  }
}

class _Toggle extends StatelessWidget {
  const _Toggle({required this.icon, required this.title, required this.subtitle, required this.value, required this.onChanged});

  final IconData icon;
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return PressScale(
      onTap: () => onChanged(!value),
      haptic: false,
      scale: 0.985,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 9),
        child: Row(
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 220),
              width: 44,
              height: 44,
              decoration: BoxDecoration(color: value ? Brand.accent.withValues(alpha: 0.16) : Brand.surface3, borderRadius: BorderRadius.circular(14)),
              child: Icon(icon, color: value ? Brand.pink : Brand.muted, size: 22),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: Type.body.copyWith(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 1),
                  Text(subtitle, style: Type.muted.copyWith(fontSize: 13)),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Switch(value: value, onChanged: onChanged),
          ],
        ),
      ),
    );
  }
}
