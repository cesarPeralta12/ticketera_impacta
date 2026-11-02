import 'package:flutter_test/flutter_test.dart';
import 'package:impacta_puerta/dynamic_qr.dart';
import 'package:impacta_puerta/scan_cooldown.dart';
import 'package:impacta_puerta/validator.dart';

void main() {
  final t0 = DateTime(2026, 10, 9, 21, 40);

  /// La cámara ve el QR cada medio segundo durante [seconds] (llamando a blocked en cada detección, como la pantalla).
  bool stillBlockedWhileInView(ScanCooldown c, String code, DateTime from, int seconds) {
    var ok = true;
    for (var ms = 500; ms <= seconds * 1000; ms += 500) {
      ok = c.blocked(code, from.add(Duration(milliseconds: ms))) && ok;
    }
    return ok;
  }

  test('una entrada en pausa no se vuelve a leer sola mientras la cámara la sigue viendo, hasta que vence', () {
    final c = ScanCooldown();
    expect(c.blocked('K7Q3MXPA2B', t0), isFalse);
    c.block('K7Q3MXPA2B', CooldownFor.cancelled, t0);
    expect(stillBlockedWhileInView(c, 'K7Q3MXPA2B', t0, 5), isTrue);
    expect(c.blocked('K7Q3MXPA2B', t0.add(const Duration(milliseconds: 6000))), isFalse);
    // Otra entrada no se ve afectada.
    c.block('K7Q3MXPA2B', CooldownFor.accepted, t0);
    expect(c.blocked('ZZ9988AABB', t0), isFalse);
  });

  test('retirar el QR y volver a pasarlo se lee en el momento (no hay que esperar los 90 s)', () {
    final c = ScanCooldown();
    c.block('K7Q3MXPA2B', CooldownFor.accepted, t0);
    expect(stillBlockedWhileInView(c, 'K7Q3MXPA2B', t0, 3), isTrue);
    // Lo retiran 3 s (la cámara no lo ve) y lo vuelven a pasar: lectura nueva.
    expect(c.blocked('K7Q3MXPA2B', t0.add(const Duration(seconds: 6))), isFalse);
    // Ya sin pausa: sigue sin pausa hasta que se procese de nuevo.
    expect(c.blocked('K7Q3MXPA2B', t0.add(const Duration(milliseconds: 6500))), isFalse);
  });

  test('quien sale puede volver a entrar: la salida no deja la pausa de 12 s si retiró el QR', () {
    final c = ScanCooldown();
    c.block('K7Q3MXPA2B', CooldownFor.exited, t0);
    expect(c.blocked('K7Q3MXPA2B', t0.add(const Duration(seconds: 2))), isFalse);
  });

  test('mientras se atiende la lectura, ver el QR mantiene viva la pausa', () {
    final c = ScanCooldown();
    c.block('K7Q3MXPA2B', CooldownFor.accepted, t0);
    // La hoja de confirmación estuvo 8 s abierta y la cámara siguió viendo el QR (se anotó con saw).
    for (var ms = 500; ms <= 8000; ms += 500) {
      c.saw('K7Q3MXPA2B', t0.add(Duration(milliseconds: ms)));
    }
    expect(c.blocked('K7Q3MXPA2B', t0.add(const Duration(milliseconds: 8500))), isTrue);
  });

  test('aceptada: la pausa larga no se acorta con una más corta', () {
    final c = ScanCooldown();
    c.block('K7Q3MXPA2B', CooldownFor.accepted, t0);
    expect(stillBlockedWhileInView(c, 'K7Q3MXPA2B', t0, 10), isTrue);
    c.block('K7Q3MXPA2B', CooldownFor.rejected, t0.add(const Duration(seconds: 10)));
    expect(stillBlockedWhileInView(c, 'K7Q3MXPA2B', t0.add(const Duration(seconds: 10)), 70), isTrue);
    expect(c.blocked('K7Q3MXPA2B', t0.add(const Duration(milliseconds: 91000))), isFalse);
  });

  test('el caso real: el QR dinámico cambia de texto cada 30 s pero es la misma entrada', () {
    final key = keyFromBase64('8KhyKt-6YzLCPb3tRjidJA');
    const code = 'K7Q3MXPA2B';
    final first = signDynamicPayload(key, code, t0.millisecondsSinceEpoch);
    final later = signDynamicPayload(key, code, t0.add(const Duration(seconds: 35)).millisecondsSinceEpoch);
    expect(first, isNot(later)); // el texto leído es otro…
    expect(extractTicketCode(first), extractTicketCode(later)); // …pero la entrada es la misma

    final c = ScanCooldown();
    c.block(extractTicketCode(first)!, CooldownFor.accepted, t0);
    // La cámara sigue viendo el QR 35 s y lee el nuevo texto: sigue en pausa, no aparece "Ya utilizada".
    expect(stillBlockedWhileInView(c, extractTicketCode(first)!, t0, 35), isTrue);
    expect(c.blocked(extractTicketCode(later)!, t0.add(const Duration(milliseconds: 35500))), isTrue);
  });

  test('escribir el código a mano levanta la pausa', () {
    final c = ScanCooldown();
    c.block('K7Q3MXPA2B', CooldownFor.accepted, t0);
    c.release('K7Q3MXPA2B');
    expect(c.blocked('K7Q3MXPA2B', t0), isFalse);
  });
}
