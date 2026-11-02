import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:impacta_puerta/external_code.dart';
import 'package:impacta_puerta/models.dart';
import 'package:impacta_puerta/validator.dart';

/// Los mismos casos que prueba el servidor (packages/core/src/external-codes.test.ts): el teléfono y el servidor tienen
/// que limpiar igual cada código, o una entrada que el panel reconoce la rechazaría la puerta.
final _cases = (jsonDecode(File('../../packages/core/src/external-codes.cases.json').readAsStringSync()) as List).cast<Map<String, dynamic>>();

class _Tickets implements TicketLookup {
  _Tickets(List<TicketRow> rows) : _rows = rows;
  final List<TicketRow> _rows;

  @override
  Future<TicketRow?> find(String sessionId, String code) async => _rows.where((r) => r.code == code).firstOrNull;

  @override
  Future<TicketRow?> findByExternalKey(String sessionId, List<String> keys) async =>
      _rows.where((r) => r.externalKey != null && keys.contains(r.externalKey)).firstOrNull;

  @override
  Future<Uint8List?> keyFor(String sessionId, String code) async => null;
}

SessionMeta _meta({List<ExternalCodeRule> rules = const [ExternalCodeRule()]}) => SessionMeta(
      sessionId: 's1',
      title: 'Noche',
      gateId: 'g1',
      gates: const [
        Gate(id: 'g1', name: 'Norte', sectionIds: ['campo']),
        Gate(id: 'g2', name: 'Sur', sectionIds: ['palco']),
      ],
      sections: const {'campo': 'Campo', 'palco': 'Palco'},
      syncedAt: '2026-11-02T12:00:00.000Z',
      ticketCount: 2,
      codeRules: rules,
    );

TicketRow _external(String code, String key, {String section = 'campo', bool mine = true, List<String> methods = const ['QR', 'BARCODE'], String? raw}) => TicketRow(
      code: code,
      status: TicketStatus.valid,
      sectionId: section,
      mine: mine,
      holder: 'Luz',
      type: 'General',
      methods: mine ? methods : const [],
      externalKey: key,
      externalCode: mine ? (raw ?? key) : null,
    );

void main() {
  group('normalizeExternalCode (casos compartidos con el servidor)', () {
    for (final c in _cases) {
      test(c['note'] as String, () {
        final rule = ExternalCodeRule.fromJson(c['rule']);
        expect(normalizeExternalCode(c['raw'] as String, rule), c['key']);
      });
    }

    test('un texto demasiado largo no es un código', () {
      expect(normalizeExternalCode('A' * 201), isNull);
      expect(normalizeExternalCode('A' * 101), isNull);
      expect(normalizeExternalCode('A' * 100), 'A' * 100);
    });

    test('varias reglas dan varias claves, sin repetir', () {
      const rules = [ExternalCodeRule(), ExternalCodeRule(ignoreLeadingZeros: true)];
      expect(externalKeyCandidates('00123', rules), ['00123', '123']);
      expect(externalKeyCandidates('ABC', rules), ['ABC']);
    });
  });

  group('validateScan con entradas de otro proveedor', () {
    const ipass = 'K7Q3MXPA2B';
    final tickets = _Tickets([
      _external(ipass, 'ABC123', raw: 'abc-123'),
      _external('BBBBBBBBBB', 'XYZ9', section: 'palco', mine: false),
      _external('DDDDDDDDDD', 'NFC1', methods: const ['NFC']),
    ]);

    Future<ScanOutcome> run(String raw, {AccessMethod? method = AccessMethod.qr, SessionMeta? meta}) =>
        validateScan(tickets: tickets, meta: meta ?? _meta(), raw: raw, method: method);

    test('se acepta con su QR en cualquier forma de escribirlo', () async {
      for (final raw in ['ABC123', 'abc-123', ' Abc 123 ', 'https://proveedor.com/t/ABC123', 'https://x.com/e?code=abc-123']) {
        final r = await run(raw);
        expect(r.verdict, ScanVerdict.accepted, reason: raw);
        expect(r.ticket?.code, ipass, reason: raw);
        expect(r.ticket?.externalCode, 'abc-123');
      }
    });

    test('también por código de barras y tipeado a mano', () async {
      expect((await run('ABC123', method: AccessMethod.barcode)).verdict, ScanVerdict.accepted);
      expect((await run('ABC123', method: null)).verdict, ScanVerdict.accepted);
    });

    test('una entrada de otra puerta dice por dónde debe entrar', () async {
      final r = await run('XYZ9');
      expect(r.verdict, ScanVerdict.wrongGate);
      expect(r.detail, contains('Sur'));
    });

    test('respeta el método de lectura de su tipo', () async {
      expect((await run('NFC1')).verdict, ScanVerdict.methodNotAllowed);
    });

    test('un código que no está en la lista no existe', () async {
      expect((await run('NOEXISTE')).verdict, ScanVerdict.notFound);
    });

    test('sin reglas del proveedor, lo que no es de iPass es inválido (como siempre)', () async {
      final r = await run('ABC123', meta: _meta(rules: const []));
      expect(r.verdict, ScanVerdict.invalid);
    });

    test('la entrada de iPass sigue leyéndose con su QR', () async {
      expect((await run('TK1.$ipass.firma')).verdict, ScanVerdict.accepted);
    });

    test('con reglas distintas por lote se prueban todas', () async {
      final r = await run('00123', meta: _meta(rules: const [ExternalCodeRule(), ExternalCodeRule(ignoreLeadingZeros: true)]));
      expect(r.verdict, ScanVerdict.notFound);
      final ok = await validateScan(
        tickets: _Tickets([_external(ipass, '123')]),
        meta: _meta(rules: const [ExternalCodeRule(), ExternalCodeRule(ignoreLeadingZeros: true)]),
        raw: '00123',
        method: AccessMethod.qr,
      );
      expect(ok.verdict, ScanVerdict.accepted);
    });
  });
}
