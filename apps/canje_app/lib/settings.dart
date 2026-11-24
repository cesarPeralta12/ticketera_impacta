/// Ajustes de la app en este teléfono (sonido, vibración, ingreso rápido). Se guardan en el propio teléfono.
library;

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class AppSettings extends ChangeNotifier {
  AppSettings._(this._prefs)
      : sound = _prefs?.getBool('sound') ?? true,
        haptics = _prefs?.getBool('haptics') ?? true,
        autoAccept = _prefs?.getBool('autoAccept') ?? false,
        keepAwake = _prefs?.getBool('keepAwake') ?? true;

  /// Para pruebas y para cuando el almacenamiento no está disponible.
  AppSettings.memory({this.sound = true, this.haptics = true, this.autoAccept = false, this.keepAwake = true}) : _prefs = null;

  final SharedPreferences? _prefs;

  /// Sonidos al leer (autorizado, aviso, rechazo).
  bool sound;

  /// Vibración al leer.
  bool haptics;

  /// Ingreso rápido: una entrada válida se acepta sola, sin pedir confirmación (por defecto el portero confirma).
  bool autoAccept;

  /// Mantener la pantalla encendida mientras se leen entradas.
  bool keepAwake;

  static Future<AppSettings> load() async {
    try {
      return AppSettings._(await SharedPreferences.getInstance());
    } catch (_) {
      return AppSettings.memory();
    }
  }

  void _save(String key, bool value) {
    _prefs?.setBool(key, value);
    notifyListeners();
  }

  void setSound(bool v) {
    sound = v;
    _save('sound', v);
  }

  void setHaptics(bool v) {
    haptics = v;
    _save('haptics', v);
  }

  void setAutoAccept(bool v) {
    autoAccept = v;
    _save('autoAccept', v);
  }

  void setKeepAwake(bool v) {
    keepAwake = v;
    _save('keepAwake', v);
  }
}
