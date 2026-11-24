import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:impacta_puerta/models.dart';
import 'package:impacta_puerta/presence_view.dart';
import 'package:impacta_puerta/storage.dart';
import 'package:impacta_puerta/validator.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

const _meta = SessionMeta(
  sessionId: 's1',
  title: 'Noche',
  gateId: 'g1',
  gates: [Gate(id: 'g1', name: 'Puerta 1')],
  sections: {},
  syncedAt: '2026-10-18T12:00:00.000Z',
  ticketCount: 1,
);

final _now = DateTime.utc(2026, 11, 23, 22, 20);

TicketRow _ticket({DateTime? lastAt, String? by, String? gate, String? move, DateTime? usedAt, bool inside = true}) => TicketRow(
      code: 'AAAAAAAAAA',
      status: TicketStatus.used,
      sectionId: null,
      mine: true,
      holder: 'Ana',
      methods: const ['QR'],
      inside: inside,
      entries: 1,
      usedAt: usedAt,
      lastAt: lastAt,
      lastBy: by,
      lastGate: gate,
      lastMove: move,
    );

class _Tickets implements TicketLookup {
  _Tickets(this.row);
  final TicketRow row;

  @override
  Future<TicketRow?> find(String sessionId, String code) async => row;

  @override
  Future<TicketRow?> findByExternalKey(String sessionId, List<String> keys) async => null;

  @override
  Future<Uint8List?> keyFor(String sessionId, String code) async => null;
}

void main() {
  group('hace cuánto', () {
    test('segundos, minutos, horas y días', () {
      expect(agoLabel(const Duration(seconds: 10)), 'hace unos segundos');
      expect(agoLabel(const Duration(seconds: -5)), 'hace unos segundos');
      expect(agoLabel(const Duration(seconds: 50)), 'hace 1 min');
      expect(agoLabel(const Duration(minutes: 5)), 'hace 5 min');
      expect(agoLabel(const Duration(minutes: 60)), 'hace 1 h');
      expect(agoLabel(const Duration(hours: 2, minutes: 10)), 'hace 2 h 10 min');
      expect(agoLabel(const Duration(hours: 30)), 'hace 1 día');
      expect(agoLabel(const Duration(days: 3)), 'hace 3 días');
    });
  });

  group('quién y cuándo', () {
    test('cuánto hace, la puerta y el operador', () {
      final t = _ticket(lastAt: _now.subtract(const Duration(minutes: 5)), by: 'Ana', gate: 'Puerta 2', move: 'ENTRY');
      expect(lastReadNote(t, _now), 'Hace 5 min · Puerta 2 · por Ana');
    });

    test('una salida o un cambio de zona lo dicen al principio', () {
      final t = _ticket(lastAt: _now.subtract(const Duration(minutes: 2)), by: 'Luis', gate: 'Puerta 3', move: 'EXIT', inside: false);
      expect(lastReadNote(t, _now), 'Salida · hace 2 min · Puerta 3 · por Luis');
    });

    test('sin operador ni puerta queda solo cuánto hace; sin nada, nulo', () {
      expect(lastReadNote(_ticket(lastAt: _now.subtract(const Duration(minutes: 7))), _now), 'Hace 7 min');
      expect(lastReadNote(_ticket(usedAt: _now.subtract(const Duration(hours: 1))), _now), 'Hace 1 h');
      expect(lastReadNote(_ticket(), _now), isNull);
    });
  });

  group('«Ya utilizada»', () {
    test('dice cuánto hace, la puerta y el operador en una segunda línea', () async {
      final at = _now.subtract(const Duration(minutes: 5));
      final t = _ticket(lastAt: at, usedAt: at, by: 'Ana', gate: 'Puerta 2', move: 'ENTRY');
      final out = await validateScan(tickets: _Tickets(t), meta: _meta, raw: 'AAAAAAAAAA', method: AccessMethod.qr, now: _now);
      expect(out.verdict, ScanVerdict.alreadyUsed);
      final lines = out.detail!.split('\n');
      expect(lines.first, startsWith('Ingresó a las '));
      expect(lines.first, endsWith('y no salió.'));
      expect(lines.last, 'Hace 5 min · Puerta 2 · por Ana');
    });

    test('sin esos datos (servidor anterior) queda el mensaje de siempre', () async {
      final at = _now.subtract(const Duration(minutes: 5));
      final out = await validateScan(tickets: _Tickets(_ticket(usedAt: at)), meta: _meta, raw: 'AAAAAAAAAA', method: AccessMethod.qr, now: _now);
      expect(out.detail, isNot(contains('por ')));
      expect(out.detail!.split('\n').first, startsWith('Ingresó a las '));
    });
  });

  group('«Solo consulta»', () {
    test('muestra la última lectura en su propia fila y no repite la segunda línea de «Ya utilizada»', () async {
      final at = _now.subtract(const Duration(minutes: 5));
      final t = _ticket(lastAt: at, usedAt: at, by: 'Ana', gate: 'Puerta 2', move: 'ENTRY');
      final outcome = await validateScan(tickets: _Tickets(t), meta: _meta, raw: 'AAAAAAAAAA', method: AccessMethod.qr, now: _now);
      final view = describePresence(t, _meta, outcome, now: _now);
      expect(view.lastLine, 'Hace 5 min · Puerta 2 · por Ana');
      expect(view.ifScannedHere, isNot(contains('\n')));
    });

    test('una entrada que no ingresó no tiene última lectura', () async {
      const t = TicketRow(code: 'AAAAAAAAAA', status: TicketStatus.valid, sectionId: null, mine: true, methods: ['QR']);
      final outcome = await validateScan(tickets: _Tickets(t), meta: _meta, raw: 'AAAAAAAAAA', method: AccessMethod.qr, now: _now);
      expect(describePresence(t, _meta, outcome, now: _now).lastLine, isNull);
    });
  });

  group('datos del servidor y del teléfono', () {
    test('la descarga trae la última lectura', () {
      final t = TicketRow.fromJson({
        'code': 'AAAAAAAAAA',
        'status': 'U',
        'lastRead': {'at': '2026-11-23T22:15:00.000Z', 'by': 'Ana', 'gate': 'Puerta 2', 'movement': 'ENTRY'},
      });
      expect(t.lastAt, DateTime.utc(2026, 11, 23, 22, 15));
      expect(t.lastBy, 'Ana');
      expect(t.lastGate, 'Puerta 2');
      expect(t.lastMove, 'ENTRY');
      expect(TicketRow.fromJson({'code': 'AAAAAAAAAA', 'status': 'V'}).lastAt, isNull);
    });

    late Directory dir;
    late DoorDb db;

    setUpAll(() {
      sqfliteFfiInit();
      databaseFactory = databaseFactoryFfi;
    });

    setUp(() async {
      dir = await Directory.systemTemp.createTemp('puerta_last_test');
      await databaseFactory.setDatabasesPath(dir.path);
      db = await DoorDb.open(Uint8List.fromList(List.generate(32, (i) => i)));
    });

    tearDown(() async {
      await databaseFactory.deleteDatabase('${dir.path}/puerta.db');
      await dir.delete(recursive: true);
    });

    test('al leer una entrada en este teléfono queda quién, cuándo y por qué puerta', () async {
      const fresh = TicketRow(code: 'AAAAAAAAAA', status: TicketStatus.valid, sectionId: null, mine: true, methods: ['QR']);
      await db.saveFull(DownloadResult(meta: _meta, tickets: [fresh], full: true));
      await db.applyMovement('s1', 'AAAAAAAAAA', Movement.entry, _now, by: 'Ana', gate: 'Puerta 1');
      final t = (await db.find('s1', 'AAAAAAAAAA'))!;
      expect(t.lastBy, 'Ana');
      expect(t.lastGate, 'Puerta 1');
      expect(t.lastMove, 'ENTRY');
      expect(t.lastAt!.toUtc(), _now);
      await db.applyMovement('s1', 'AAAAAAAAAA', Movement.exit, _now.add(const Duration(minutes: 30)), by: 'Luis', gate: 'Puerta 3');
      expect((await db.find('s1', 'AAAAAAAAAA'))!.lastMove, 'EXIT');
    });

    test('lo que baja del servidor se guarda y se lee', () async {
      final used = _ticket(lastAt: _now, by: 'Ana', gate: 'Puerta 2', move: 'ENTRY');
      await db.saveFull(DownloadResult(meta: _meta, tickets: [used], full: true));
      final t = (await db.find('s1', 'AAAAAAAAAA'))!;
      expect((t.lastBy, t.lastGate, t.lastMove), ('Ana', 'Puerta 2', 'ENTRY'));
    });
  });
}
