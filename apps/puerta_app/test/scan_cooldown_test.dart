import 'package:flutter_test/flutter_test.dart';
import 'package:impacta_puerta/dynamic_qr.dart';
import 'package:impacta_puerta/scan_cooldown.dart';
import 'package:impacta_puerta/validator.dart';

void main() {
  final t0 = DateTime(2026, 10, 9, 21, 40);

  test('una entrada en pausa no se vuelve a leer sola hasta que vence', () {
    final c = ScanCooldown();
    expect(c.blocked('K7Q3MXPA2B', t0), isFalse);
    c.block('K7Q3MXPA2B', CooldownFor.cancelled, t0);
    expect(c.blocked('K7Q3MXPA2B', t0.add(const Duration(seconds: 5))), isTrue);
    expect(c.blocked('K7Q3MXPA2B', t0.add(const Duration(seconds: 6))), isFalse);
    // Otra entrada no se ve afectada.
    c.block('K7Q3MXPA2B', CooldownFor.accepted, t0);
    expect(c.blocked('ZZ9988AABB', t0), isFalse);
  });

  test('aceptada: la pausa larga no se acorta con una más corta', () {
    final c = ScanCooldown();
    c.block('K7Q3MXPA2B', CooldownFor.accepted, t0);
    c.block('K7Q3MXPA2B', CooldownFor.rejected, t0.add(const Duration(seconds: 10)));
    expect(c.blocked('K7Q3MXPA2B', t0.add(const Duration(seconds: 80))), isTrue);
    expect(c.blocked('K7Q3MXPA2B', t0.add(const Duration(seconds: 91))), isFalse);
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
    // 35 s después la cámara lee el QR nuevo: sigue en pausa, no aparece "Ya utilizada".
    expect(c.blocked(extractTicketCode(later)!, t0.add(const Duration(seconds: 35))), isTrue);
  });

  test('escribir el código a mano levanta la pausa', () {
    final c = ScanCooldown();
    c.block('K7Q3MXPA2B', CooldownFor.accepted, t0);
    c.release('K7Q3MXPA2B');
    expect(c.blocked('K7Q3MXPA2B', t0), isFalse);
  });
}
