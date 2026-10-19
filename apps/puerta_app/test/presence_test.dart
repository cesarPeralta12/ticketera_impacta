import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:impacta_puerta/models.dart';
import 'package:impacta_puerta/validator.dart';

class _FakeTickets implements TicketLookup {
  _FakeTickets(List<TicketRow> rows) : _rows = {for (final r in rows) r.code: r};
  final Map<String, TicketRow> _rows;

  @override
  Future<TicketRow?> find(String sessionId, String code) async => _rows[code];

  @override
  Future<Uint8List?> keyFor(String sessionId, String code) async => null;
}

const _gates = [
  Gate(id: 'in', name: 'Puerta principal', direction: GateDirection.inward),
  Gate(id: 'out', name: 'Salida', direction: GateDirection.outward),
  Gate(id: 'both', name: 'Lateral', direction: GateDirection.both),
  Gate(id: 'vip', name: 'Acceso VIP', direction: GateDirection.inward, zoneId: 'z-vip'),
];

SessionMeta _meta(String gateId) => SessionMeta(
      sessionId: 's1',
      title: 'Noche',
      gateId: gateId,
      gates: _gates,
      sections: const {},
      syncedAt: '2026-10-18T12:00:00.000Z',
      ticketCount: 1,
    );

TicketRow _ticket({
  TicketStatus status = TicketStatus.valid,
  bool? inside,
  int? entries,
  int maxEntries = 1,
  List<String> zoneIds = const [],
  String? zoneId,
}) =>
    TicketRow(
      code: 'K7Q3MXPA2B',
      status: status,
      sectionId: null,
      mine: true,
      holder: 'Ana',
      type: 'General',
      methods: const ['QR'],
      inside: inside,
      entries: entries,
      maxEntries: maxEntries,
      zoneIds: zoneIds,
      zoneId: zoneId,
    );

Future<ScanOutcome> _scan(TicketRow t, String gate) =>
    validateScan(tickets: _FakeTickets([t]), meta: _meta(gate), raw: 'K7Q3MXPA2B', method: AccessMethod.qr);

void main() {
  group('puerta de salida', () {
    test('registra la salida de quien está adentro', () async {
      final r = await _scan(_ticket(status: TicketStatus.used, inside: true, entries: 1), 'out');
      expect(r.verdict, ScanVerdict.accepted);
      expect(r.movement, Movement.exit);
      expect(r.title, 'SALIDA REGISTRADA');
    });

    test('quien no estaba adentro no puede salir', () async {
      final never = await _scan(_ticket(), 'out');
      expect(never.verdict, ScanVerdict.notInside);
      expect(never.detail, contains('todavía no ingresó'));
      final already = await _scan(_ticket(status: TicketStatus.used, inside: false, entries: 1, maxEntries: 2), 'out');
      expect(already.verdict, ScanVerdict.notInside);
      expect(already.detail, contains('Ya había salido'));
    });

    test('una anulada se dice anulada, no "no estaba adentro"', () async {
      final r = await _scan(_ticket(status: TicketStatus.cancelled), 'out');
      expect(r.verdict, ScanVerdict.cancelled);
    });
  });

  group('puerta de entrada y salida', () {
    test('adentro: sale; afuera: entra', () async {
      expect((await _scan(_ticket(status: TicketStatus.used, inside: true, entries: 1), 'both')).movement, Movement.exit);
      final entry = await _scan(_ticket(), 'both');
      expect(entry.verdict, ScanVerdict.accepted);
      expect(entry.movement, Movement.entry);
    });
  });

  group('reingreso', () {
    test('con dos ingresos: sale, vuelve una vez y a la tercera ya no', () async {
      final back = await _scan(_ticket(status: TicketStatus.used, inside: false, entries: 1, maxEntries: 2), 'in');
      expect(back.verdict, ScanVerdict.accepted);
      expect(back.movement, Movement.reentry);
      expect(back.title, 'REINGRESO AUTORIZADO');

      final spent = await _scan(_ticket(status: TicketStatus.used, inside: false, entries: 2, maxEntries: 2), 'in');
      expect(spent.verdict, ScanVerdict.alreadyUsed);
      expect(spent.detail, contains('2 ingreso'));
    });

    test('sin límite siempre vuelve; con un solo ingreso, nunca', () async {
      final unlimited = await _scan(_ticket(status: TicketStatus.used, inside: false, entries: 9, maxEntries: 0), 'in');
      expect(unlimited.movement, Movement.reentry);
      final single = await _scan(_ticket(status: TicketStatus.used, inside: false, entries: 1), 'in');
      expect(single.verdict, ScanVerdict.alreadyUsed);
      expect(single.detail, contains('un solo ingreso'));
    });

    test('el servidor baja como válida la que salió y puede volver: se ve como reingreso', () async {
      final r = await _scan(_ticket(inside: false, entries: 1, maxEntries: 3), 'in');
      expect(r.verdict, ScanVerdict.accepted);
      expect(r.movement, Movement.reentry);
    });

    test('quien sigue adentro no entra dos veces', () async {
      final r = await _scan(_ticket(status: TicketStatus.used, inside: true, entries: 1, maxEntries: 0), 'in');
      expect(r.verdict, ScanVerdict.alreadyUsed);
    });
  });

  group('zonas', () {
    test('la entrada general no abre la puerta del VIP y se le dice por dónde entra', () async {
      final r = await _scan(_ticket(zoneIds: const ['z-general']), 'vip');
      expect(r.verdict, ScanVerdict.wrongGate);
    });

    test('la que abre el VIP entra por la puerta del VIP', () async {
      final r = await _scan(_ticket(zoneIds: const ['z-general', 'z-vip']), 'vip');
      expect(r.verdict, ScanVerdict.accepted);
      expect(r.movement, Movement.entry);
    });

    test('ya adentro en la general, pasa al VIP: cambio de zona, no un nuevo ingreso', () async {
      final r = await _scan(_ticket(status: TicketStatus.used, inside: true, entries: 1, zoneIds: const ['z-general', 'z-vip'], zoneId: 'z-general'), 'vip');
      expect(r.verdict, ScanVerdict.accepted);
      expect(r.movement, Movement.zoneChange);
    });

    test('si ya está en el VIP, leerla otra vez en el VIP es "ya utilizada"', () async {
      final r = await _scan(_ticket(status: TicketStatus.used, inside: true, entries: 1, zoneIds: const ['z-general', 'z-vip'], zoneId: 'z-vip'), 'vip');
      expect(r.verdict, ScanVerdict.alreadyUsed);
    });

    test('un tipo de entrada sin zonas definidas entra por cualquier puerta de entrada', () async {
      final r = await _scan(_ticket(), 'vip');
      expect(r.verdict, ScanVerdict.accepted);
    });
  });

  group('servidor anterior (sin presencia)', () {
    test('"usada" sigue significando "adentro" y "ya utilizada"', () async {
      final r = await _scan(_ticket(status: TicketStatus.used), 'in');
      expect(r.verdict, ScanVerdict.alreadyUsed);
    });

    test('una puerta sin dirección es de entrada', () {
      final gate = Gate.fromJson({'id': 'x', 'name': 'Norte', 'sectionIds': <String>[]});
      expect(gate.direction, GateDirection.inward);
      expect(gate.zoneId, isNull);
    });

    test('los títulos de los resultados nuevos', () {
      expect(ScanVerdict.notActivated.title, 'IMPRESA SIN VENDER');
      expect(ScanVerdict.outOfHours.title, 'FUERA DE HORARIO');
      expect(ScanVerdict.notInside.title, 'NO ESTABA ADENTRO');
      expect(ScanVerdict.fromApi('NOT_ACTIVATED'), ScanVerdict.notActivated);
      expect(Movement.fromApi('ZONE_CHANGE'), Movement.zoneChange);
    });
  });
}
