import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:impacta_puerta/models.dart';
import 'package:impacta_puerta/nfc_uid.dart';
import 'package:impacta_puerta/storage.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Los mismos casos que prueba el servidor (packages/core/src/nfc-uid.test.ts): si la app y el servidor normalizan igual
/// el número de serie, una tarjeta vinculada en el canje se reconoce en la puerta.
final _cases = (jsonDecode(File('../../packages/core/src/nfc-uid.cases.json').readAsStringSync()) as List).cast<Map<String, dynamic>>();

const _meta = SessionMeta(
  sessionId: 's1',
  title: 'Noche',
  gateId: 'g1',
  gates: [Gate(id: 'g1', name: 'Principal')],
  sections: {},
  syncedAt: '2026-10-18T12:00:00.000Z',
  ticketCount: 2,
);

TicketRow _t(String code, {String? nfcUid}) => TicketRow(code: code, status: TicketStatus.valid, sectionId: null, mine: true, holder: 'Ana', type: 'General', methods: const ['NFC'], nfcUid: nfcUid);

void main() {
  group('número de serie de una tarjeta NFC', () {
    for (final c in _cases) {
      test('${c['note']}: «${c['raw']}» → ${c['uid'] ?? 'nada'}', () {
        expect(normalizeNfcUid(c['raw'] as String), c['uid'] as String?);
      });
    }

    test('los bytes se escriben en mayúsculas y con ceros a la izquierda', () {
      expect(hexOf([0x04, 0x7f, 0x8c, 0x52, 0x0f, 0x7a, 0x80]), '047F8C520F7A80');
      expect(normalizeNfcUid(hexOf([0x04, 0x7f, 0x8c, 0x52, 0x0f, 0x7a, 0x80])), '047F8C520F7A80');
      expect(hexOf(Uint8List.fromList([0, 1, 255])), '0001FF');
    });
  });

  group('la puerta encuentra la entrada por la tarjeta', () {
    late Directory dir;
    late DoorDb db;

    setUpAll(() {
      sqfliteFfiInit();
      databaseFactory = databaseFactoryFfi;
    });

    setUp(() async {
      dir = await Directory.systemTemp.createTemp('puerta_nfc_test');
      await databaseFactory.setDatabasesPath(dir.path);
      db = await DoorDb.open(Uint8List.fromList(List.generate(32, (i) => i)));
    });

    tearDown(() async {
      await databaseFactory.deleteDatabase('${dir.path}/puerta.db');
      await dir.delete(recursive: true);
    });

    test('por su número de serie, y no se confunde con otra función', () async {
      await db.saveFull(DownloadResult(meta: _meta, tickets: [_t('AAAAAAAAAA', nfcUid: '047F8C520F7A80'), _t('BBBBBBBBBB')], full: true));
      expect((await db.findByNfcUid('s1', '047F8C520F7A80'))?.code, 'AAAAAAAAAA');
      expect(await db.findByNfcUid('s1', 'A1B2C3D4'), isNull);
      expect(await db.findByNfcUid('otra', '047F8C520F7A80'), isNull);
    });

    test('una tarjeta recién vinculada se anota en el teléfono y pasa de una entrada a otra sin duplicarse', () async {
      await db.saveFull(DownloadResult(meta: _meta, tickets: [_t('AAAAAAAAAA', nfcUid: '047F8C520F7A80'), _t('BBBBBBBBBB')], full: true));
      await db.setNfcUid('s1', 'BBBBBBBBBB', '047F8C520F7A80');
      expect((await db.findByNfcUid('s1', '047F8C520F7A80'))?.code, 'BBBBBBBBBB');
      expect((await db.find('s1', 'AAAAAAAAAA'))?.nfcUid, isNull);
    });

    test('la descarga de cambios trae la tarjeta nueva', () async {
      await db.saveFull(DownloadResult(meta: _meta, tickets: [_t('AAAAAAAAAA')], full: true));
      await db.applyDelta(DownloadResult(meta: _meta, tickets: [_t('AAAAAAAAAA', nfcUid: 'A1B2C3D4')], full: false));
      expect((await db.findByNfcUid('s1', 'A1B2C3D4'))?.code, 'AAAAAAAAAA');
    });

    test('el campo viaja en el JSON de la descarga', () {
      final t = TicketRow.fromJson({'code': 'AAAAAAAAAA', 'status': 'V', 'sectionId': null, 'nfcUid': 'A1B2C3D4'});
      expect(t.nfcUid, 'A1B2C3D4');
      expect(TicketRow.fromJson({'code': 'AAAAAAAAAA', 'status': 'V'}).nfcUid, isNull);
    });
  });
}
