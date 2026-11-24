import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:impacta_canje/card_fingerprint.dart';
import 'package:impacta_canje/models.dart';
import 'package:impacta_canje/nfc_uid.dart';

/// Los mismos casos que prueban el servidor y la app de puerta: los tres tienen que normalizar igual el número de serie.
final _cases = (jsonDecode(File('../../packages/core/src/nfc-uid.cases.json').readAsStringSync()) as List).cast<Map<String, dynamic>>();

void main() {
  group('número de serie', () {
    for (final c in _cases) {
      test('${c['note']}: «${c['raw']}» → ${c['uid'] ?? 'nada'}', () {
        expect(normalizeNfcUid(c['raw'] as String), c['uid'] as String?);
      });
    }

    test('se muestra con dos puntos, como las apps de NFC', () {
      expect(formatUid('047F8C520F7A80'), '04:7F:8C:52:0F:7A:80');
      expect(formatUid('A1B2C3D4'), 'A1:B2:C3:D4');
    });
  });

  group('huella de la tarjeta', () {
    test('lo que se sube al servidor: el número de serie y lo que se sabe de la etiqueta', () {
      const card = CardFingerprint(uid: '047F8C520F7A80', type: 'ISO 14443-3A', model: 'Mifare Ultralight', tech: ['NfcA', 'MifareUltralight', 'Ndef'], atqa: '0044', sak: '00');
      expect(card.toJson(), {
        'uid': '047F8C520F7A80',
        'type': 'ISO 14443-3A',
        'model': 'Mifare Ultralight',
        'tech': ['NfcA', 'MifareUltralight', 'Ndef'],
        'atqa': '0044',
        'sak': '00',
      });
      expect(card.uidLabel, '04:7F:8C:52:0F:7A:80');
    });

    test('sin datos de la etiqueta sube solo el número de serie', () {
      expect(const CardFingerprint(uid: 'A1B2C3D4').toJson(), {'uid': 'A1B2C3D4'});
    });

    test('el tipo sale de las tecnologías que ofrece la etiqueta', () {
      expect(typeFromTech(['NfcA', 'MifareUltralight', 'Ndef']), 'ISO 14443-3A');
      expect(typeFromTech(['NfcV']), 'ISO 15693');
      expect(typeFromTech(['IsoDep']), isNull);
      expect(shortTech('android.nfc.tech.MifareUltralight'), 'MifareUltralight');
    });
  });

  test('copyWith conserva la tarjeta de la entrada y la actualiza cuando se vincula una nueva', () {
    const t = TicketRow(code: 'AAAAAAAAAA', status: TicketStatus.valid, sectionId: null, mine: true, nfcUid: 'A1B2C3D4');
    expect(t.copyWith(inside: true).nfcUid, 'A1B2C3D4');
    expect(t.copyWith(nfcUid: '047F8C520F7A80').nfcUid, '047F8C520F7A80');
  });
}
