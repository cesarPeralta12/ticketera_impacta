import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:impacta_puerta/bar.dart';
import 'package:impacta_puerta/screens/bar_screen.dart';
import 'package:impacta_puerta/storage.dart';
import 'package:impacta_puerta/ui/tokens.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

const _mesa = Voucher(code: 'M4P9RXHB3C', label: 'Mesa VIP N° 4', people: 6, buyer: 'Ana Rojas', orderCode: 'ABC123', amount: 100000, currency: 'BOB');

class _Lookup implements VoucherLookup {
  _Lookup(List<Voucher> list) : _byCode = {for (final v in list) v.code: v};
  final Map<String, Voucher> _byCode;

  @override
  Future<Voucher?> findVoucher(String sessionId, String code) async => _byCode[code];
}

void main() {
  group('lectura del código', () {
    test('acepta el QR de consumo y el código escrito', () {
      expect(extractVoucherCode('CV1.M4P9RXHB3C.firmaabc'), 'M4P9RXHB3C');
      expect(extractVoucherCode('m4p9r-xhb3c'), 'M4P9RXHB3C');
      expect(extractVoucherCode('M4P9RXHB3C'), 'M4P9RXHB3C');
    });

    test('rechaza lo que no es un QR de consumo', () {
      expect(extractVoucherCode('TK1.M4P9RXHB3C.firma'), isNull); // QR de una entrada
      expect(extractVoucherCode('hola'), isNull);
      expect(extractVoucherCode('CV1.corto.firma'), isNull);
      expect(extractVoucherCode('CV1.M4P9RXHB3C'), isNull);
    });
  });

  group('qué pasa al leer', () {
    Future<VoucherOutcome> read(List<Voucher> list, String raw) => inspectVoucher(vouchers: _Lookup(list), sessionId: 's1', raw: raw);

    test('disponible: muestra el vale para marcarlo', () async {
      final o = await read([_mesa], 'CV1.M4P9RXHB3C.firma');
      expect(o.verdict, VoucherVerdict.available);
      expect(o.voucher?.amount, 100000);
    });

    test('ya leído: dice cuándo y quién, y no se puede usar', () async {
      final read1 = _mesa.copyWith(redeemedAt: DateTime(2026, 10, 30, 22, 14), redeemedBy: 'Barra 2', note: '1 botella');
      final o = await read([read1], 'M4P9RXHB3C');
      expect(o.verdict, VoucherVerdict.alreadyRead);
      expect(o.title, 'YA FUE LEÍDO');
      expect(o.detail, contains('22:14'));
      expect(o.detail, contains('Barra 2'));
      expect(o.detail, contains('1 botella'));
    });

    test('anulado, desconocido y QR de entrada', () async {
      expect((await read([_mesa.copyWith(cancelled: true)], 'M4P9RXHB3C')).verdict, VoucherVerdict.cancelled);
      expect((await read([_mesa], 'hola')).verdict, VoucherVerdict.invalid);
      expect((await read([_mesa], 'K7Q3MXPA2B')).verdict, VoucherVerdict.notFound); // formato válido pero no está en la lista
      expect((await read([_mesa], 'TK1.K7Q3MXPA2B.firma')).verdict, VoucherVerdict.invalid);
    });
  });

  test('el monto se muestra en bolivianos con miles y centavos', () {
    expect(formatVoucherAmount(100000, 'BOB'), 'Bs 1.000,00');
    expect(formatVoucherAmount(2550, 'BOB'), 'Bs 25,50');
    expect(formatVoucherAmount(123456789, 'BOB'), 'Bs 1.234.567,89');
    expect(formatVoucherAmount(500, 'USD'), '5,00 USD');
  });

  group('guardado en el teléfono', () {
    late Directory dir;
    late DoorDb db;

    setUpAll(() {
      sqfliteFfiInit();
      databaseFactory = databaseFactoryFfi;
    });

    setUp(() async {
      dir = await Directory.systemTemp.createTemp('puerta_bar_test');
      await databaseFactory.setDatabasesPath(dir.path);
      db = await DoorDb.open(Uint8List.fromList(List.generate(32, (i) => i)));
    });

    tearDown(() async {
      await databaseFactory.deleteDatabase('${dir.path}/puerta.db');
      await dir.delete(recursive: true);
    });

    test('lo leído en este teléfono queda marcado, pendiente de subir, y no se vuelve a poder leer', () async {
      await db.saveVouchers('s1', [_mesa]);
      await db.markVoucherRead(id: 'lectura-0001', sessionId: 's1', code: 'M4P9RXHB3C', at: DateTime(2026, 10, 30, 22, 0), note: 'botella');
      final stored = await db.findVoucher('s1', 'M4P9RXHB3C');
      expect(stored?.isRead, isTrue);
      expect(stored?.note, 'botella');
      expect(await db.pendingVoucherCount('s1'), 1);
      expect((await db.voucherCounts('s1')), (total: 1, read: 1));
      expect((await inspectVoucher(vouchers: db, sessionId: 's1', raw: 'M4P9RXHB3C')).verdict, VoucherVerdict.alreadyRead);
    });

    test('una descarga nueva no deshace lo leído aquí sin subir', () async {
      await db.saveVouchers('s1', [_mesa]);
      await db.markVoucherRead(id: 'lectura-0002', sessionId: 's1', code: 'M4P9RXHB3C', at: DateTime(2026, 10, 30, 22, 0));
      await db.saveVouchers('s1', [_mesa]); // el servidor todavía no sabe de la lectura
      expect((await db.findVoucher('s1', 'M4P9RXHB3C'))?.isRead, isTrue);
    });

    test('si otro teléfono ya lo había leído, queda con sus datos y cuenta como conflicto', () async {
      await db.saveVouchers('s1', [_mesa]);
      await db.markVoucherRead(id: 'lectura-0003', sessionId: 's1', code: 'M4P9RXHB3C', at: DateTime(2026, 10, 30, 22, 5));
      final other = _mesa.copyWith(redeemedAt: DateTime(2026, 10, 30, 22, 1), redeemedBy: 'Barra 2');
      await db.applyVoucherResults('s1', {'lectura-0003': (result: 'ALREADY_REDEEMED', voucher: other)});
      expect(await db.pendingVoucherCount('s1'), 0);
      expect(await db.voucherConflictCount('s1'), 1);
      final stored = await db.findVoucher('s1', 'M4P9RXHB3C');
      expect(stored?.redeemedBy, 'Barra 2');
      expect(stored?.redeemedAt, DateTime(2026, 10, 30, 22, 1));
    });

    test('las lecturas pendientes salen en el orden en que se hicieron', () async {
      final second = Voucher(code: 'K7Q3MXPA2B', label: 'Mesa 2', people: 4, buyer: 'Luis', orderCode: 'DEF456', amount: 5000, currency: 'BOB');
      await db.saveVouchers('s1', [_mesa, second]);
      await db.markVoucherRead(id: 'lectura-b', sessionId: 's1', code: 'K7Q3MXPA2B', at: DateTime(2026, 10, 30, 22, 9));
      await db.markVoucherRead(id: 'lectura-a', sessionId: 's1', code: 'M4P9RXHB3C', at: DateTime(2026, 10, 30, 22, 3));
      expect((await db.pendingVoucherReads('s1')).map((r) => r.id), ['lectura-a', 'lectura-b']);
    });
  });

  testWidgets('la ficha del consumo se dibuja: disponible y ya leído', (tester) async {
    Future<void> open(VoucherOutcome outcome) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: buildTheme(),
          home: Scaffold(
            body: Builder(
              builder: (context) => Center(
                child: TextButton(
                  onPressed: () => showVoucherSheet(
                    context,
                    outcome: outcome,
                    night: BarNight(sessionId: 's1', title: 'Noche', startsAt: DateTime(2026, 10, 30, 22), venue: 'Club', timezone: 'America/La_Paz', vouchers: 1, read: 0),
                  ),
                  child: const Text('abrir'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('abrir'));
      await tester.pumpAndSettle();
    }

    await open(const VoucherOutcome(verdict: VoucherVerdict.available, voucher: _mesa));
    expect(find.text('Mesa VIP N° 4'), findsOneWidget);
    expect(find.text('Bs 1.000,00'), findsOneWidget);
    expect(find.text('MARCAR COMO LEÍDO'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.tapAt(const Offset(10, 10)); // cierra la hoja
    await tester.pumpAndSettle();
    await open(VoucherOutcome(verdict: VoucherVerdict.alreadyRead, voucher: _mesa.copyWith(redeemedAt: DateTime(2026, 10, 30, 22, 14), redeemedBy: 'Barra 2'), detail: 'Se leyó a las 22:14 por Barra 2. No se puede usar de nuevo.'));
    expect(find.text('YA FUE LEÍDO'), findsOneWidget);
    expect(find.text('MARCAR COMO LEÍDO'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
