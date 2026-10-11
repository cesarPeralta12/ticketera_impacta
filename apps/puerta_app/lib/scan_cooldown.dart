/// Evita que la cámara vuelva a leer sola una entrada que acaba de procesarse.
///
/// La cámara sigue viendo el mismo QR mientras el portero lo acepta, y un QR dinámico además cambia cada
/// 30 segundos (su contenido es otro, pero la entrada es la misma). Sin esta pausa, la entrada recién aceptada se
/// volvía a leer y aparecía como "YA UTILIZADA" sin que nadie la hubiera vuelto a pasar. Se cuenta por código
/// de entrada, no por el texto leído.
library;

class ScanCooldown {
  final Map<String, DateTime> _until = {};

  /// ¿Esta entrada está en pausa? (se limpia sola al vencer)
  bool blocked(String code, DateTime now) {
    final until = _until[code];
    if (until == null) return false;
    if (now.isBefore(until)) return true;
    _until.remove(code);
    return false;
  }

  /// Pone en pausa la entrada durante [duration] (se queda con la pausa más larga si ya tenía una).
  void block(String code, Duration duration, DateTime now) {
    final until = now.add(duration);
    final current = _until[code];
    if (current == null || until.isAfter(current)) _until[code] = until;
  }

  /// Quita la pausa (por ejemplo, el portero escribió el código a mano a propósito).
  void release(String code) => _until.remove(code);
}

/// Pausas según lo que pasó con la entrada.
class CooldownFor {
  /// Aceptada: el comprador sigue frente a la cámara un buen rato.
  static const accepted = Duration(seconds: 90);

  /// Rechazada (puerta equivocada, ya usada…): lo que dura el aviso en pantalla, y un poco más.
  static const rejected = Duration(seconds: 6);

  /// El portero canceló o se acabó el tiempo de decidir: sin esto el diálogo reaparecía al instante.
  static const cancelled = Duration(seconds: 6);
}
