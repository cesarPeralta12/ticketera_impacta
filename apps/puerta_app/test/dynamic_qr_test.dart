import 'package:flutter_test/flutter_test.dart';
import 'package:impacta_puerta/dynamic_qr.dart';

/// VECTORES COMPARTIDOS con el servidor (packages/core/src/dynamic-qr.test.ts). Si cambian allá, cambian aquí:
/// el teléfono y el servidor tienen que calcular exactamente lo mismo.
const vectors = [
  (code: 'K7Q3MXPA2B', key: '8KhyKt-6YzLCPb3tRjidJA', step: 57000000, stepText: 'xxphc', proof: 'PdfGc_G5sWo', otp: '203145'),
  (code: 'K7Q3MXPA2B', key: '8KhyKt-6YzLCPb3tRjidJA', step: 57000001, stepText: 'xxphd', proof: 'eHIooOWZyu4', otp: '658147'),
  (code: 'ZZ9988AABB', key: 'kpQgT_DmtZ8AscLVrmdQUw', step: 57000000, stepText: 'xxphc', proof: 'Kd_9_qG64Go', otp: '135476'),
];

void main() {
  const code = 'K7Q3MXPA2B';
  final key = keyFromBase64('8KhyKt-6YzLCPb3tRjidJA');
  const stepMs = stepSeconds * 1000;
  const at = 57000000 * stepMs; // inicio exacto del paso

  group('vectores compartidos con el servidor', () {
    for (final v in vectors) {
      test('${v.code} paso ${v.step}', () {
        final k = keyFromBase64(v.key);
        expect(k.length, 16);
        expect(v.step.toRadixString(36), v.stepText);
        expect(dynamicProof(k, v.code, v.step), v.proof);
        expect(dynamicOtp(k, v.code, v.step), v.otp);
      });
    }
    test('el contenido del QR coincide con el del servidor', () {
      expect(signDynamicPayload(key, code, at), 'TK2.K7Q3MXPA2B.xxphc.PdfGc_G5sWo');
      expect(signDynamicPayload(key, code, at + 29999), 'TK2.K7Q3MXPA2B.xxphc.PdfGc_G5sWo');
      expect(signDynamicPayload(key, code, at + stepMs), 'TK2.K7Q3MXPA2B.xxphd.eHIooOWZyu4');
    });
  });

  group('verificación', () {
    DynamicPayload at0(int stepOffset) => parseDynamicPayload(signDynamicPayload(key, code, at + stepOffset * stepMs))!;

    test('acepta el paso actual y los vecinos, y marca vencido lo demás', () {
      const now = at + 5000;
      expect(verifyDynamicPayload(key, at0(0), now), DynamicVerdict.ok);
      expect(verifyDynamicPayload(key, at0(-1), now), DynamicVerdict.ok);
      expect(verifyDynamicPayload(key, at0(1), now), DynamicVerdict.ok);
      expect(verifyDynamicPayload(key, at0(-2), now), DynamicVerdict.expired);
      expect(verifyDynamicPayload(key, at0(-1000), now), DynamicVerdict.expired);
      expect(verifyDynamicPayload(key, at0(2), now), DynamicVerdict.expired);
    });

    test('una prueba falsificada, de otro código o con el paso cambiado es inválida', () {
      final good = at0(0);
      expect(verifyDynamicPayload(key, DynamicPayload(code: code, step: good.step, proof: 'AAAAAAAAAAA'), at), DynamicVerdict.invalid);
      // Rejuvenecer una captura: cambiar solo el paso.
      final old = at0(-10);
      expect(verifyDynamicPayload(key, DynamicPayload(code: code, step: good.step, proof: old.proof), at), DynamicVerdict.invalid);
      // Llave equivocada.
      final other = keyFromBase64('kpQgT_DmtZ8AscLVrmdQUw');
      expect(verifyDynamicPayload(other, good, at), DynamicVerdict.invalid);
    });

    test('el OTP escrito a mano vale en la ventana y no fuera de ella', () {
      expect(verifyDynamicOtp(key, code, '203145', at + 10000), isTrue);
      expect(verifyDynamicOtp(key, code, '658147', at + 10000), isTrue); // paso siguiente
      expect(verifyDynamicOtp(key, code, '203145', at + 3 * stepMs), isFalse);
      expect(verifyDynamicOtp(key, code, '000000', at), isFalse);
    });
  });

  group('formatos', () {
    test('parseDynamicPayload', () {
      final p = parseDynamicPayload('TK2.K7Q3MXPA2B.xxphc.PdfGc_G5sWo')!;
      expect((p.code, p.step, p.proof), ('K7Q3MXPA2B', 57000000, 'PdfGc_G5sWo'));
      expect(parseDynamicPayload('TK1.K7Q3MXPA2B.abc'), isNull);
      expect(parseDynamicPayload('TK2.K7Q3MXPA2B.xxphc'), isNull);
      expect(parseDynamicPayload('TK2.K7Q3MXPA2B.xxphc.PdfGc_G5sWo.x'), isNull);
      expect(parseDynamicPayload('TK2.K7Q3MXPA20.xxphc.PdfGc_G5sWo'), isNull);
      expect(parseDynamicPayload('TK2.K7Q3MXPA2B.xxphc.corta'), isNull);
    });

    test('parseManualWithOtp', () {
      expect(parseManualWithOtp('K7Q3M-XPA2B 203145'), (code: 'K7Q3MXPA2B', otp: '203145'));
      expect(parseManualWithOtp('  k7q3mxpa2b   203145 '), (code: 'K7Q3MXPA2B', otp: '203145'));
      expect(parseManualWithOtp('K7Q3MXPA2B'), isNull);
      expect(parseManualWithOtp('K7Q3MXPA2B 12345'), isNull);
    });
  });
}
