import 'package:flutter_test/flutter_test.dart';
import 'package:impacta_puerta/nfc_reader.dart';
import 'package:impacta_puerta/nfc_writer.dart';
import 'package:impacta_puerta/validator.dart';

void main() {
  const code = 'K7Q3MXPA2B';

  group('texto de la pulsera', () {
    test('es el código sin guion y en mayúsculas', () {
      expect(braceletText('K7Q3M-XPA2B'), code);
      expect(braceletText('k7q3mxpa2b'), code);
    });

    test('rechaza lo que no es un código de entrada', () {
      expect(braceletText('hola'), isNull);
      expect(braceletText('K7Q3MXPA20'), isNull); // el 0 no existe en el alfabeto
      expect(braceletText('TK1.K7Q3MXPA2B.firma'), isNull);
      expect(() => braceletMessage('hola'), throwsArgumentError);
    });
  });

  group('registro NDEF', () {
    test('es un registro de texto en español con el código', () {
      final record = textRecord(code);
      expect(String.fromCharCodes(record.type), 'T');
      expect(record.payload[0], 2); // largo del idioma
      expect(String.fromCharCodes(record.payload.sublist(1, 3)), 'es');
      expect(String.fromCharCodes(record.payload.sublist(3)), code);
    });

    test('lo que se graba es exactamente lo que la lectura entiende', () {
      final message = braceletMessage('K7Q3M-XPA2B');
      expect(message.records, hasLength(1));
      final text = ndefRecordText(message.records.single);
      expect(text, code);
      expect(extractCodeFromNfcText(text!), code);
      expect(extractTicketCode(text), code);
    });

    test('cabe de sobra en una NTAG213 (144 bytes)', () {
      expect(messageBytes(braceletMessage(code)), lessThan(30));
    });
  });

  group('comprobación de lo grabado', () {
    test('acepta el mensaje con el código y rechaza otro o vacío', () {
      expect(messageHasCode(braceletMessage(code), code), isTrue);
      expect(messageHasCode(braceletMessage(code), 'K7Q3M-XPA2B'), isTrue);
      expect(messageHasCode(braceletMessage('ZZ9988AABB'), code), isFalse);
      expect(messageHasCode(null, code), isFalse);
    });
  });

  group('mensajes al portero', () {
    test('cada resultado tiene un texto claro y solo "written" es éxito', () {
      for (final r in BraceletResult.values) {
        expect(r.message, isNotEmpty);
        expect(r.ok, r == BraceletResult.written);
      }
    });
  });
}
