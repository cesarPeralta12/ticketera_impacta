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
  Gate(id: 'in', name: 'Principal'),
  Gate(id: 'vip', name: 'Acceso VIP', zoneId: 'z-vip', zoneName: 'VIP'),
];

SessionMeta _meta(String gateId, {Map<String, String> zones = const {'z-general': 'General', 'z-vip': 'VIP', 'z-ultra': 'Ultra VIP'}}) => SessionMeta(
      sessionId: 's1',
      title: 'Noche',
      gateId: gateId,
      gates: _gates,
      sections: const {},
      zones: zones,
      syncedAt: '2026-10-28T12:00:00.000Z',
      ticketCount: 1,
    );

TicketRow _ticket({List<String> zoneIds = const []}) => TicketRow(
      code: 'K7Q3MXPA2B',
      status: TicketStatus.valid,
      sectionId: null,
      mine: true,
      holder: 'Ana',
      type: 'VIP',
      methods: const ['QR'],
      zoneIds: zoneIds,
    );

void main() {
  group('nombres de zona (servidor nuevo)', () {
    test('la puerta trae el nombre de su zona y se guarda', () {
      final gate = Gate.fromJson({'id': 'vip', 'name': 'Acceso VIP', 'sectionIds': <String>[], 'direction': 'IN', 'zoneId': 'z-vip', 'zoneName': 'Ultra VIP'});
      expect(gate.zoneName, 'Ultra VIP');
      expect(Gate.fromJson(gate.toJson()).zoneName, 'Ultra VIP');
    });

    test('la descarga trae el mapa de zonas y el meta lo conserva al guardarse', () {
      final result = DownloadResult.fromJson({
        'full': true,
        'session': {'id': 's1', 'title': 'Noche'},
        'gateId': 'vip',
        'gates': [
          {'id': 'vip', 'name': 'Acceso VIP', 'sectionIds': <String>[], 'direction': 'IN', 'zoneId': 'z-vip', 'zoneName': 'VIP'},
        ],
        'sections': <String, String>{},
        'zones': {'z-vip': 'VIP', 'z-ultra': 'Ultra VIP'},
        'syncedAt': '2026-10-28T12:00:00.000Z',
        'tickets': <Map<String, dynamic>>[],
      });
      expect(result.meta.zones['z-ultra'], 'Ultra VIP');
      expect(SessionMeta.fromJson(result.meta.toJson()).zones, result.meta.zones);
    });

    test('con un servidor anterior (sin zonas) todo sigue funcionando', () {
      final old = SessionMeta.fromJson({
        'sessionId': 's1',
        'title': 'Noche',
        'gateId': null,
        'gates': [
          {'id': 'in', 'name': 'Principal', 'sectionIds': <String>[]},
        ],
        'sections': <String, String>{},
        'syncedAt': '2026-10-28T12:00:00.000Z',
        'ticketCount': 0,
      });
      expect(old.zones, isEmpty);
      expect(old.zonesIncluded(['z-vip']), isNull);
    });

    test('"Incluye": una, dos o tres zonas', () {
      final meta = _meta('in');
      expect(meta.zonesIncluded(['z-vip']), 'VIP');
      expect(meta.zonesIncluded(['z-vip', 'z-ultra']), 'VIP y Ultra VIP');
      expect(meta.zonesIncluded(['z-general', 'z-vip', 'z-ultra']), 'General, VIP y Ultra VIP');
      expect(meta.zonesIncluded([]), isNull);
    });

    test('al aceptar una entrada, el resultado dice qué zonas incluye', () async {
      final out = await validateScan(
        tickets: _FakeTickets([_ticket(zoneIds: const ['z-general', 'z-vip'])]),
        meta: _meta('vip'),
        raw: 'K7Q3MXPA2B',
        method: AccessMethod.qr,
      );
      expect(out.verdict, ScanVerdict.accepted);
      expect(out.includes, 'General y VIP');
    });

    test('sin zonas conocidas no se inventa nada', () async {
      final out = await validateScan(
        tickets: _FakeTickets([_ticket(zoneIds: const ['z-vip'])]),
        meta: _meta('vip', zones: const {}),
        raw: 'K7Q3MXPA2B',
        method: AccessMethod.qr,
      );
      expect(out.includes, isNull);
    });
  });

  group('zona llena', () {
    test('el resultado del servidor se reconoce y se muestra como aviso', () {
      expect(ScanVerdict.fromApi('ZONE_FULL'), ScanVerdict.zoneFull);
      expect(ScanVerdict.zoneFull.title, 'ZONA LLENA');
      expect(ScanVerdict.zoneFull.isWarning, isTrue);
    });
  });
}
