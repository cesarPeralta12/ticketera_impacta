import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:impacta_puerta/models.dart';
import 'package:impacta_puerta/presence_view.dart';
import 'package:impacta_puerta/validator.dart';

class _Tickets implements TicketLookup {
  _Tickets(this.row);
  final TicketRow row;

  @override
  Future<TicketRow?> find(String sessionId, String code) async => row;

  @override
  Future<Uint8List?> keyFor(String sessionId, String code) async => null;
}

const _gates = [
  Gate(id: 'in', name: 'Principal', direction: GateDirection.inward, zoneId: 'z-gen', zoneName: 'General'),
  Gate(id: 'vip', name: 'Acceso VIP', direction: GateDirection.inward, zoneId: 'z-vip', zoneName: 'VIP'),
];

SessionMeta _meta(String gateId) => SessionMeta(
      sessionId: 's1',
      title: 'Noche',
      gateId: gateId,
      gates: _gates,
      sections: const {},
      zones: const {'z-gen': 'General', 'z-vip': 'VIP'},
      syncedAt: '2026-10-18T12:00:00.000Z',
      ticketCount: 1,
    );

TicketRow _ticket({TicketStatus status = TicketStatus.valid, bool? inside, int? entries, int maxEntries = 0, String? zoneId, List<String> zoneIds = const ['z-gen', 'z-vip']}) => TicketRow(
      code: 'K7Q3MXPA2B',
      status: status,
      sectionId: null,
      mine: true,
      holder: 'Ana',
      type: 'VIP',
      methods: const ['QR'],
      inside: inside,
      entries: entries,
      maxEntries: maxEntries,
      zoneIds: zoneIds,
      zoneId: zoneId,
    );

Future<PresenceView> _view(TicketRow t, String gate) async {
  final meta = _meta(gate);
  final outcome = await validateScan(tickets: _Tickets(t), meta: meta, raw: t.code, method: AccessMethod.qr);
  return describePresence(t, meta, outcome);
}

void main() {
  test('sin ingresar: lo dice y la lectura aquí sería un ingreso', () async {
    final v = await _view(_ticket(), 'in');
    expect(v.state, PresenceState.neverEntered);
    expect(v.headline, 'TODAVÍA NO INGRESÓ');
    expect(v.ifScannedHere, 'INGRESO');
    expect(v.opens, 'General y VIP');
  });

  test('adentro en General, consultando en la puerta VIP: no está en el VIP y pasaría a él', () async {
    final v = await _view(_ticket(status: TicketStatus.used, inside: true, entries: 1, zoneId: 'z-gen'), 'vip');
    expect(v.state, PresenceState.inside);
    expect(v.headline, 'ADENTRO · General');
    expect(v.where, 'General');
    expect(v.thisZone, isFalse);
    expect(v.ifScannedHere, 'CAMBIO DE ZONA');
  });

  test('ya está en el VIP (lo dice el servidor aunque entró por otro teléfono): sí está en esa zona y no vuelve a pasar', () async {
    final v = await _view(_ticket(status: TicketStatus.used, inside: true, entries: 1, maxEntries: 1, zoneId: 'z-vip'), 'vip');
    expect(v.thisZone, isTrue);
    expect(v.headline, 'ADENTRO · VIP');
    expect(v.ifScannedHere, contains('Ya está adentro'));
  });

  test('salió: afuera, y cuántos ingresos lleva', () async {
    final v = await _view(_ticket(status: TicketStatus.valid, inside: false, entries: 2, maxEntries: 3), 'in');
    expect(v.state, PresenceState.left);
    expect(v.headline, 'AFUERA · ya salió');
    expect(v.entriesLine, '2 de 3 ingresos usados');
    expect(v.ifScannedHere, 'REINGRESO');
  });

  test('una puerta sin zona no afirma nada sobre la zona', () async {
    final meta = SessionMeta(sessionId: 's1', title: 'x', gateId: 'g', gates: const [Gate(id: 'g', name: 'Puerta')], sections: const {}, syncedAt: '2026-10-18T12:00:00.000Z', ticketCount: 1);
    final t = _ticket(zoneIds: const []);
    final outcome = await validateScan(tickets: _Tickets(t), meta: meta, raw: t.code, method: AccessMethod.qr);
    expect(describePresence(t, meta, outcome).thisZone, isNull);
  });

  test('el servidor manda la zona actual de cada entrada y la app la lee', () {
    final t = TicketRow.fromJson({'code': 'K7Q3MXPA2B', 'status': 'U', 'sectionId': null, 'mine': true, 'inside': true, 'entries': 1, 'zoneId': 'z-vip'});
    expect(t.zoneId, 'z-vip');
    expect(TicketRow.fromJson({'code': 'K7Q3MXPA2B', 'status': 'V', 'sectionId': null}).zoneId, isNull); // servidor anterior
  });
}
