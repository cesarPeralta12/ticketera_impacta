/// Evita que la cámara vuelva a leer sola una entrada que acaba de procesarse.
///
/// La cámara sigue viendo el mismo QR mientras el portero lo acepta, y un QR dinámico además cambia cada
/// 30 segundos (su contenido es otro, pero la entrada es la misma). Sin esta pausa, la entrada recién aceptada se
/// volvía a leer y aparecía como "YA UTILIZADA" sin que nadie la hubiera vuelto a pasar. Se cuenta por código
/// de entrada, no por el texto leído.
///
/// La pausa vale mientras la cámara siga VIENDO ese QR. Si deja de verlo (la persona lo retiró) y vuelve a aparecer,
/// es una lectura nueva y se atiende en el momento: antes la pausa corría por tiempo (90 s después de un ingreso, 12 s
/// después de una salida) y quien salía no podía volver a entrar, ni se podía leer dos veces la misma entrada, aunque
/// se quitara de la cámara.
library;

class ScanCooldown {
  final Map<String, DateTime> _until = {};
  final Map<String, DateTime> _seen = {};

  /// Cuánto sin ver el QR cuenta como «lo retiraron». La cámara lo detecta cada 0,4 s mientras está delante.
  static const gone = Duration(milliseconds: 1500);

  /// La cámara ve este código ahora (aunque no se esté atendiendo la lectura): mantiene viva la pausa.
  void saw(String code, DateTime now) {
    if (_until.containsKey(code)) _seen[code] = now;
  }

  /// ¿Esta entrada está en pausa? (se limpia sola al vencer o cuando la cámara deja de verla). Llamar en cada detección.
  bool blocked(String code, DateTime now) {
    final until = _until[code];
    if (until == null) return false;
    final last = _seen[code] ?? now;
    _seen[code] = now;
    if (!now.isBefore(until) || now.difference(last) > gone) {
      release(code);
      return false;
    }
    return true;
  }

  /// Pone en pausa la entrada durante [duration] (se queda con la pausa más larga si ya tenía una).
  void block(String code, Duration duration, DateTime now) {
    final until = now.add(duration);
    final current = _until[code];
    if (current == null || until.isAfter(current)) _until[code] = until;
    _seen[code] = now;
  }

  /// Quita la pausa (por ejemplo, el portero escribió el código a mano a propósito).
  void release(String code) {
    _until.remove(code);
    _seen.remove(code);
  }
}

/// Pausas según lo que pasó con la entrada.
class CooldownFor {
  /// Aceptada: el comprador sigue frente a la cámara un buen rato.
  static const accepted = Duration(seconds: 90);

  /// Salida registrada: la persona puede volver enseguida (por la misma puerta, si el recinto no tiene puerta de
  /// salida); la pausa solo evita que la cámara cuente dos veces el mismo QR mientras lo sigue viendo.
  static const exited = Duration(seconds: 12);

  /// Rechazada (puerta equivocada, ya usada…): lo que dura el aviso en pantalla, y un poco más.
  static const rejected = Duration(seconds: 6);

  /// El portero canceló o se acabó el tiempo de decidir: sin esto el diálogo reaparecía al instante.
  static const cancelled = Duration(seconds: 6);
}
