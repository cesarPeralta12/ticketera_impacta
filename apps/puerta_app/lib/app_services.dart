/// Los ajustes y el sonido de la app, disponibles para cualquier pantalla sin pasarlos de mano en mano.
library;

import 'package:flutter/widgets.dart';

import 'feedback.dart';
import 'settings.dart';

class AppServices extends InheritedWidget {
  const AppServices({super.key, required this.settings, required this.feedback, required super.child});

  final AppSettings settings;
  final DoorFeedback feedback;

  static AppServices of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AppServices>();
    assert(scope != null, 'Falta AppServices sobre esta pantalla.');
    return scope!;
  }

  @override
  bool updateShouldNotify(AppServices old) => settings != old.settings || feedback != old.feedback;
}
