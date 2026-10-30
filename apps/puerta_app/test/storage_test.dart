import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:impacta_puerta/models.dart';
import 'package:impacta_puerta/storage.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

const _meta = SessionMeta(
  sessionId: 's1',
  title: 'Noche',
  gateId: 'g1',
  gates: [Gate(id: 'g1', name: 'Principal'), Gate(id: 'g2', name: 'Salida', direction: GateDirection.outward)],
  sections: {},
  syncedAt: '2026-10-18T12:00:00.000Z',
  ticketCount: 3,
);

TicketRow _t(String code, {TicketStatus status = TicketStatus.valid, bool? inside, int? entries, int maxEntries = 1, List<String> zoneIds = const [], String holder = 'Ana'}) =>
    TicketRow(code: code, status: status, sectionId: null, mine: true, holder: holder, type: 'General', methods: const ['QR'], inside: inside, entries: entries, maxEntries: maxEntries, zoneIds: zoneIds);

DownloadResult _download(List<TicketRow> tickets) => DownloadResult(meta: _meta, tickets: tickets, full: true);

void main() {
  late Directory dir;
  late DoorDb db;

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('puerta_test');
    await databaseFactory.setDatabasesPath(dir.path);
    db = await DoorDb.open(Uint8List.fromList(List.generate(32, (i) => i)));
  });

  tearDown(() async {
    await databaseFactory.deleteDatabase('${dir.path}/puerta.db');
    await dir.delete(recursive: true);
  });

  test('guarda y devuelve la presencia, el máximo de ingresos y las zonas', () async {
    await db.saveFull(_download([_t('AAAAAAAAAA', status: TicketStatus.used, inside: true, entries: 1, maxEntries: 3, zoneIds: const ['z1', 'z2'])]));
    final t = (await db.find('s1', 'AAAAAAAAAA'))!;
    expect(t.inside, isTrue);
    expect(t.entries, 1);
    expect(t.maxEntries, 3);
    expect(t.zoneIds, ['z1', 'z2']);
    expect((await db.meta('s1'))!.gates.last.direction, GateDirection.outward);
  });

  test('un servidor sin presencia: "usada" es "adentro"', () async {
    await db.saveFull(_download([_t('AAAAAAAAAA', status: TicketStatus.used)]));
    final t = (await db.find('s1', 'AAAAAAAAAA'))!;
    expect(t.inside, isNull);
    expect(t.isInside, isTrue);
  });

  test('ingreso, salida, reingreso y cambio de zona dejan el estado correcto', () async {
    await db.saveFull(_download([_t('AAAAAAAAAA', maxEntries: 2)]));
    final at = DateTime(2026, 10, 18, 22, 10);

    await db.applyMovement('s1', 'AAAAAAAAAA', Movement.entry, at, zoneId: 'general');
    var t = (await db.find('s1', 'AAAAAAAAAA'))!;
    expect((t.status, t.isInside, t.entryCount, t.zoneId), (TicketStatus.used, true, 1, 'general'));
    expect(t.usedAt, isNotNull);

    await db.applyMovement('s1', 'AAAAAAAAAA', Movement.zoneChange, at, zoneId: 'vip');
    t = (await db.find('s1', 'AAAAAAAAAA'))!;
    expect((t.isInside, t.entryCount, t.zoneId), (true, 1, 'vip'));

    await db.applyMovement('s1', 'AAAAAAAAAA', Movement.exit, at);
    t = (await db.find('s1', 'AAAAAAAAAA'))!;
    expect((t.isInside, t.entryCount, t.zoneId), (false, 1, null));
    expect(t.canReenter, isTrue);

    await db.applyMovement('s1', 'AAAAAAAAAA', Movement.reentry, at);
    t = (await db.find('s1', 'AAAAAAAAAA'))!;
    expect((t.isInside, t.entryCount), (true, 2));
    await db.applyMovement('s1', 'AAAAAAAAAA', Movement.exit, at);
    expect((await db.find('s1', 'AAAAAAAAAA'))!.canReenter, isFalse, reason: 'ya usó sus 2 ingresos');
  });

  test('una descarga nueva no borra lo leído aquí y todavía sin subir (se rehace en orden)', () async {
    await db.saveFull(_download([_t('AAAAAAAAAA', maxEntries: 0), _t('BBBBBBBBBB')]));
    final at = DateTime(2026, 10, 18, 22, 10);
    for (final (i, m) in [Movement.entry, Movement.exit, Movement.reentry].indexed) {
      await db.applyMovement('s1', 'AAAAAAAAAA', m, at.add(Duration(minutes: i)));
      await db.addScan(
        PendingScan(id: 'scan$i', sessionId: 's1', gateId: 'g1', raw: 'AAAAAAAAAA', method: 'QR', scannedAt: at.add(Duration(minutes: i)), verdict: ScanVerdict.accepted, movement: m),
        code: 'AAAAAAAAAA',
      );
    }
    // El servidor todavía no sabe nada: manda las dos entradas como válidas.
    await db.saveFull(_download([_t('AAAAAAAAAA', maxEntries: 0), _t('BBBBBBBBBB')]));
    final a = (await db.find('s1', 'AAAAAAAAAA'))!;
    expect((a.status, a.isInside, a.entryCount), (TicketStatus.used, true, 2), reason: 'entró, salió y volvió a entrar');
    final b = (await db.find('s1', 'BBBBBBBBBB'))!;
    expect((b.status, b.isInside), (TicketStatus.valid, false));
  });

  test('los conteos: total, ingresaron alguna vez y adentro ahora', () async {
    await db.saveFull(_download([
      _t('AAAAAAAAAA', status: TicketStatus.used, inside: true, entries: 1), // adentro
      _t('BBBBBBBBBB', inside: false, entries: 1, maxEntries: 2), // salió y puede volver
      _t('CCCCCCCCCC'), // no vino
      _t('DDDDDDDDDD', status: TicketStatus.cancelled), // anulada: no cuenta
    ]));
    final c = await db.gateCounts('s1');
    expect((c.total, c.used, c.inside), (3, 2, 1));
  });

  test('últimas lecturas: más nuevas primero, con el nombre de la entrada', () async {
    await db.saveFull(_download([_t('AAAAAAAAAA', holder: 'Ana Gómez')]));
    await db.addScan(PendingScan(id: 'a', sessionId: 's1', gateId: 'g1', raw: 'x', method: 'QR', scannedAt: DateTime(2026, 10, 18, 22, 1), verdict: ScanVerdict.accepted, movement: Movement.entry), code: 'AAAAAAAAAA');
    await db.addScan(PendingScan(id: 'b', sessionId: 's1', gateId: 'g1', raw: 'y', method: 'QR', scannedAt: DateTime(2026, 10, 18, 22, 5), verdict: ScanVerdict.notFound), code: null);
    final recent = await db.recentScans('s1');
    expect(recent.map((r) => r.verdict), [ScanVerdict.notFound, ScanVerdict.accepted]);
    expect(recent.last.holder, 'Ana Gómez');
    expect(recent.last.movement, Movement.entry);
  });
}
