import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:impacta_puerta/dynamic_qr.dart';
import 'package:impacta_puerta/models.dart';
import 'package:impacta_puerta/validator.dart';

class _FakeTickets implements TicketLookup {
  _FakeTickets(List<TicketRow> rows, {this.keys = const {}}) : _rows = {for (final r in rows) r.code: r};
  final Map<String, TicketRow> _rows;
  final Map<String, Uint8List> keys;

  @override
  Future<TicketRow?> find(String sessionId, String code) async => _rows[code];

  @override
  Future<Uint8List?> keyFor(String sessionId, String code) async => keys[code];
}

const _meta = SessionMeta(
  sessionId: 's1',
  title: 'Loko Fest',
  gateId: 'g1',
  gates: [
    Gate(id: 'g1', name: 'Acceso norte', sectionIds: ['campo']),
    Gate(id: 'g2', name: 'Acceso sur', sectionIds: ['palco']),
  ],
  sections: {'campo': 'Campo', 'palco': 'Palco'},
  syncedAt: '2026-10-08T12:00:00.000Z',
  ticketCount: 4,
);

TicketRow _ticket(
  String code, {
  TicketStatus status = TicketStatus.valid,
  String section = 'campo',
  bool mine = true,
  List<String> methods = const ['QR', 'BARCODE'],
  DateTime? usedAt,
  bool dynamic = false,
}) =>
    TicketRow(
      code: code,
      status: status,
      sectionId: section,
      mine: mine,
      holder: 'Ana',
      type: 'General',
      methods: mine ? methods : const [],
      usedAt: usedAt,
      qrDynamic: dynamic,
    );

void main() {
  const ok = 'K7Q3MXPA2B';
  const used = 'AAAAAAAAAA';
  const other = 'BBBBBBBBBB';
  const cancelled = 'CCCCCCCCCC';
  const nfcOnly = 'DDDDDDDDDD';

  final tickets = _FakeTickets([
    _ticket(ok),
    _ticket(used, status: TicketStatus.used, usedAt: DateTime(2026, 10, 8, 20, 14)),
    _ticket(other, section: 'palco', mine: false),
    _ticket(cancelled, status: TicketStatus.cancelled),
    _ticket(nfcOnly, methods: const ['NFC']),
  ]);

  Future<ScanOutcome> run(String raw, AccessMethod? method) => validateScan(tickets: tickets, meta: _meta, raw: raw, method: method);

  group('extractTicketCode', () {
    test('acepta el QR completo, el código a secas y lo escrito a mano', () {
      expect(extractTicketCode('TK1.$ok.firmaABC'), ok);
      expect(extractTicketCode(ok), ok);
      expect(extractTicketCode('k7q3m-xpa2b'), ok);
    });

    test('rechaza lo que no es una entrada', () {
      expect(extractTicketCode('hola'), isNull);
      expect(extractTicketCode('TK1.$ok'), isNull);
      expect(extractTicketCode('TK1.$ok.a.b'), isNull);
      expect(extractTicketCode('K7Q3MXPA20'), isNull); // el 0 no está en el alfabeto
    });

    test('encuentra el código dentro del texto de una etiqueta NFC', () {
      expect(extractCodeFromNfcText('https://impacta.bo/orden?c=$ok'), ok);
      expect(extractCodeFromNfcText('TK1.$ok.abc_DEF-123'), ok);
      expect(extractCodeFromNfcText('sin entrada'), isNull);
    });
  });

  group('validateScan', () {
    test('acepta una entrada válida de esta puerta', () async {
      final r = await run(ok, AccessMethod.barcode);
      expect(r.verdict, ScanVerdict.accepted);
      expect(r.ticket?.holder, 'Ana');
    });

    test('QR y código de barras leen la misma entrada si el tipo admite ambos', () async {
      expect((await run('TK1.$ok.sig', AccessMethod.qr)).verdict, ScanVerdict.accepted);
      expect((await run(ok, AccessMethod.barcode)).verdict, ScanVerdict.accepted);
    });

    test('rechaza un método que el tipo de entrada no admite y dice cuál sí', () async {
      final r = await run(nfcOnly, AccessMethod.qr);
      expect(r.verdict, ScanVerdict.methodNotAllowed);
      expect(r.detail, contains('NFC'));
    });

    test('el código escrito a mano siempre se admite', () async {
      expect((await run(nfcOnly, null)).verdict, ScanVerdict.accepted);
    });

    test('entrada de otra puerta: dice por dónde entra', () async {
      final r = await run(other, AccessMethod.qr);
      expect(r.verdict, ScanVerdict.wrongGate);
      expect(r.detail, contains('Acceso sur'));
    });

    test('ya usada muestra a qué hora ingresó', () async {
      final r = await run(used, AccessMethod.qr);
      expect(r.verdict, ScanVerdict.alreadyUsed);
      expect(r.detail, contains('20:14'));
    });

    test('anulada, inexistente e inválida', () async {
      expect((await run(cancelled, AccessMethod.qr)).verdict, ScanVerdict.cancelled);
      expect((await run('EEEEEEEEEE', AccessMethod.qr)).verdict, ScanVerdict.notFound);
      expect((await run('basura', AccessMethod.qr)).verdict, ScanVerdict.invalid);
    });
  });

  group('QR dinámico', () {
    const dyn = 'ZZ9988AABB';
    const stepMs = stepSeconds * 1000;
    final at = DateTime.fromMillisecondsSinceEpoch(57000000 * stepMs + 5000);
    final key = keyFromBase64('kpQgT_DmtZ8AscLVrmdQUw'); // llave de ZZ9988AABB (vector compartido con el servidor)
    final dynTickets = _FakeTickets(
      [_ticket(dyn, dynamic: true, methods: const ['QR']), _ticket('FFFFFFFFFF'), _ticket('GGGGGGGGGG', dynamic: true, methods: const ['QR'])],
      keys: {dyn: key},
    );
    Future<ScanOutcome> read(String raw, {AccessMethod? method = AccessMethod.qr, DateTime? now}) =>
        validateScan(tickets: dynTickets, meta: _meta, raw: raw, method: method, now: now ?? at);
    String qr(int offset) => signDynamicPayload(key, dyn, at.millisecondsSinceEpoch + offset * stepMs);

    test('un QR vigente (y los pasos vecinos) entra', () async {
      expect((await read(qr(0))).verdict, ScanVerdict.accepted);
      expect((await read(qr(-1))).verdict, ScanVerdict.accepted);
      expect((await read(qr(1))).verdict, ScanVerdict.accepted);
    });

    test('una captura vieja es QR vencido y lo explica', () async {
      final r = await read(qr(-6));
      expect(r.verdict, ScanVerdict.qrExpired);
      expect(r.detail, contains('cambia cada 30'));
    });

    test('el código estático (TK1, de barras o a mano) no sirve', () async {
      expect((await read('TK1.$dyn.firma')).verdict, ScanVerdict.staticNotAllowed);
      expect((await read(dyn, method: AccessMethod.barcode)).verdict, ScanVerdict.staticNotAllowed);
      expect((await read(dyn, method: null)).verdict, ScanVerdict.staticNotAllowed);
    });

    test('una prueba falsificada es inválida', () async {
      final forged = 'TK2.$dyn.${stepAt(at.millisecondsSinceEpoch).toRadixString(36)}.AAAAAAAAAAA';
      expect((await read(forged)).verdict, ScanVerdict.invalid);
    });

    test('escrito a mano vale con el OTP vigente y no con uno equivocado', () async {
      final otp = dynamicOtp(key, dyn, stepAt(at.millisecondsSinceEpoch));
      expect((await read('ZZ998-8AABB $otp', method: null)).verdict, ScanVerdict.accepted);
      expect((await read('ZZ998-8AABB 000000', method: null)).verdict, ScanVerdict.invalid);
    });

    test('un TK2 en una entrada estática es inválido; un número de más en una estática no estorba', () async {
      final forStatic = signDynamicPayload(key, 'FFFFFFFFFF', at.millisecondsSinceEpoch);
      expect((await read(forStatic)).verdict, ScanVerdict.invalid);
      expect((await read('FFFFF-FFFFF 123456', method: null)).verdict, ScanVerdict.accepted);
    });

    test('sin la llave descargada pide actualizar los datos', () async {
      final r = await read(signDynamicPayload(key, 'GGGGGGGGGG', at.millisecondsSinceEpoch));
      expect(r.verdict, ScanVerdict.invalid);
      expect(r.detail, contains('Actualiza'));
    });

    test('las lecturas rechazadas por QR dinámico se suben con su motivo', () {
      PendingScan scan(ScanVerdict v) =>
          PendingScan(id: 'id-12345678', sessionId: 's1', gateId: 'g1', raw: qr(0), method: 'QR', scannedAt: DateTime.utc(2026, 10, 8, 20), verdict: v);
      expect(scan(ScanVerdict.qrExpired).toApi()['offlineResult'], 'QR_EXPIRED');
      expect(scan(ScanVerdict.staticNotAllowed).toApi()['offlineResult'], 'STATIC_NOT_ALLOWED');
    });
  });

  test('una lectura rechazada se sube con su motivo; una aceptada la confirma el servidor', () {
    final at = DateTime.utc(2026, 10, 8, 20);
    PendingScan scan(ScanVerdict v) =>
        PendingScan(id: 'id-12345678', sessionId: 's1', gateId: 'g1', raw: ok, method: 'QR', scannedAt: at, verdict: v);
    expect(scan(ScanVerdict.accepted).toApi().containsKey('offlineResult'), isFalse);
    expect(scan(ScanVerdict.alreadyUsed).toApi()['offlineResult'], 'ALREADY_USED');
    expect(scan(ScanVerdict.methodNotAllowed).toApi()['offlineResult'], 'METHOD_NOT_ALLOWED');
  });
}
