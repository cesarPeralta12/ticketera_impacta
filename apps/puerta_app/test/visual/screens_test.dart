/// Capturas de las pantallas para revisar el diseño sin un teléfono. No compara nada: si la variable de entorno
/// SHOTS_DIR no está definida, las pruebas solo comprueban que cada pantalla se dibuja sin errores.
///
///   SHOTS_DIR=D:/capturas flutter test test/visual
library;

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:impacta_puerta/app_services.dart';
import 'package:impacta_puerta/door_service.dart';
import 'package:impacta_puerta/feedback.dart';
import 'package:impacta_puerta/models.dart';
import 'package:impacta_puerta/screens/account_sheet.dart';
import 'package:impacta_puerta/screens/change_password_screen.dart';
import 'package:impacta_puerta/screens/home_screen.dart';
import 'package:impacta_puerta/screens/login_screen.dart';
import 'package:impacta_puerta/screens/result_overlay.dart';
import 'package:impacta_puerta/screens/scan_screen.dart';
import 'package:impacta_puerta/screens/scan_widgets.dart';
import 'package:impacta_puerta/settings.dart';
import 'package:impacta_puerta/storage.dart';
import 'package:impacta_puerta/ui/tokens.dart';
import 'package:impacta_puerta/ui/widgets.dart';

class _FakeStore implements SessionStore {
  @override
  Future<String?> get email async => 'puerta@impacta.test';

  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

class _FakeDb implements DoorDb {
  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

const _gates = [
  Gate(id: 'g1', name: 'Puerta principal', direction: GateDirection.inward),
  Gate(id: 'g2', name: 'Acceso VIP', direction: GateDirection.inward, zoneId: 'vip'),
  Gate(id: 'g3', name: 'Salida', direction: GateDirection.outward),
  Gate(id: 'g4', name: 'Lateral', direction: GateDirection.both),
];

class _FakeService extends DoorService {
  _FakeService({this.empty = false, this.downloaded = true}) : super(sessionStore: _FakeStore(), db: _FakeDb()) {
    staffName = 'Control de Puerta';
    role = 'ADMIN';
    serverUrl = 'https://ticketera-panel.proshop.lat';
    pendingCount = 3;
    conflictCount = 0;
  }

  final bool empty;
  final bool downloaded;

  SessionMeta get fakeMeta => const SessionMeta(
        sessionId: 's1',
        title: 'Loko Fest — Edición Aniversario',
        gateId: 'g2',
        gates: _gates,
        sections: {'campo': 'Campo'},
        syncedAt: '2026-10-18T22:40:00.000Z',
        ticketCount: 300,
      );

  @override
  Future<void> loadAssignments() async {
    assignments = empty
        ? const []
        : [
            Assignment(
              sessionId: 's1',
              title: 'Loko Fest — Edición Aniversario',
              startsAt: DateTime.utc(2026, 11, 7, 1),
              venue: 'Arena 26',
              gates: _gates,
              methods: const [AccessMethod.qr, AccessMethod.barcode, AccessMethod.nfc],
            ),
          ];
  }

  @override
  Future<SessionMeta?> meta(String sessionId) async => downloaded ? fakeMeta : null;

  @override
  Future<({int total, int used, int inside})> gateCounts(String sessionId) async => (total: 300, used: 62, inside: 48);

  @override
  Future<void> refreshCounters(String sessionId) async {}

  @override
  Future<bool> sync(String sessionId) async => true;

  @override
  Future<List<RecentScan>> recentScans(String sessionId) async => [
        RecentScan(at: DateTime(2026, 10, 18, 22, 41), verdict: ScanVerdict.accepted, movement: Movement.entry, holder: 'Ana Gómez', type: 'Preventa', code: 'AJ4DVJZB44'),
        RecentScan(at: DateTime(2026, 10, 18, 22, 40), verdict: ScanVerdict.accepted, movement: Movement.exit, holder: 'Beto Rojas', type: 'Preventa', code: '32XKAR69H5'),
        RecentScan(at: DateTime(2026, 10, 18, 22, 38), verdict: ScanVerdict.alreadyUsed, movement: null, holder: 'Carla Peña', type: 'Preventa', code: '6X8P3ZDXWN'),
        RecentScan(at: DateTime(2026, 10, 18, 22, 37), verdict: ScanVerdict.accepted, movement: Movement.reentry, holder: 'Dani Ríos', type: 'General', code: 'SXZGDR8VG6'),
        RecentScan(at: DateTime(2026, 10, 18, 22, 35), verdict: ScanVerdict.notFound, movement: null, holder: null, type: null, code: null),
        RecentScan(at: DateTime(2026, 10, 18, 22, 33), verdict: ScanVerdict.accepted, movement: Movement.zoneChange, holder: 'Vera Montaño', type: 'VIP', code: 'PUVY8GJT4G'),
      ];
}

const _ana = TicketRow(code: 'AJ4DVJZB44', status: TicketStatus.valid, sectionId: 'campo', mine: true, holder: 'Ana Gómez', document: '4455667', type: 'Preventa', seat: null, maxEntries: 2, entries: 0);

Future<void> _loadFonts() async {
  Future<void> load(String family, List<String> files) async {
    final loader = FontLoader(family);
    for (final f in files) {
      loader.addFont(rootBundle.load('assets/fonts/$f'));
    }
    await loader.load();
  }

  // Los iconos de Material no vienen en las pruebas: se cargan del SDK para que las capturas los muestren.
  final root = Platform.environment['FLUTTER_ROOT'] ?? 'D:/flutter';
  final icons = File('$root/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
  if (icons.existsSync()) {
    final loader = FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(icons.readAsBytesSync())));
    await loader.load();
  }
  await load('Anton', ['Anton-Regular.ttf']);
  await load('Barlow', ['Barlow-Regular.ttf', 'Barlow-Medium.ttf', 'Barlow-SemiBold.ttf', 'Barlow-Bold.ttf']);
}

final _shot = GlobalKey();

Future<void> _pump(WidgetTester tester, Widget home) async {
  tester.view.physicalSize = const Size(1080, 2160);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    RepaintBoundary(
      key: _shot,
      child: AppServices(
        settings: AppSettings.memory(),
        feedback: DoorFeedback.silent(),
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: buildTheme().copyWith(scaffoldBackgroundColor: Colors.transparent),
          builder: (context, child) => Backdrop(child: child ?? const SizedBox.shrink()),
          home: home,
        ),
      ),
    ),
  );
  // Las animaciones de entrada duran unos 1,2 s; las que giran sin parar no dejan "asentar" la pantalla.
  await tester.pump(const Duration(milliseconds: 100));
  await tester.pump(const Duration(milliseconds: 1500));
}

Future<void> _shotOf(WidgetTester tester, String name) async {
  final dir = Platform.environment['SHOTS_DIR'];
  if (dir == null) return;
  await tester.runAsync(() async {
    final boundary = _shot.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final image = await boundary.toImage(pixelRatio: 2);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    await Directory(dir).create(recursive: true);
    await File('$dir/$name.png').writeAsBytes(data!.buffer.asUint8List());
  });
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(_loadFonts);

  testWidgets('inicio de sesión', (tester) async {
    await _pump(tester, LoginScreen(service: _FakeService()));
    await _shotOf(tester, '01-login');
  });

  testWidgets('cambio de contraseña', (tester) async {
    await _pump(tester, ChangePasswordScreen(service: _FakeService()));
    await _shotOf(tester, '02-contrasena');
  });

  testWidgets('inicio con datos descargados', (tester) async {
    await _pump(tester, HomeScreen(service: _FakeService()));
    await tester.pump(const Duration(seconds: 1));
    await _shotOf(tester, '03-inicio');
    await tester.drag(find.byType(ListView).first, const Offset(0, -700));
    await tester.pump(const Duration(milliseconds: 1500));
    await _shotOf(tester, '04-inicio-abajo');
  });

  testWidgets('inicio sin descargar', (tester) async {
    await _pump(tester, HomeScreen(service: _FakeService(downloaded: false)));
    await tester.pump(const Duration(seconds: 1));
    await _shotOf(tester, '05-inicio-sin-datos');
  });

  testWidgets('inicio sin eventos', (tester) async {
    await _pump(tester, HomeScreen(service: _FakeService(empty: true)));
    await tester.pump(const Duration(seconds: 1));
    await _shotOf(tester, '06-inicio-vacio');
  });

  testWidgets('hoja de la cuenta', (tester) async {
    final service = _FakeService();
    await _pump(tester, Scaffold(body: Builder(builder: (context) => Center(child: TextButton(onPressed: () => showAccountSheet(context, service: service, pending: 3), child: const Text('abrir'))))));
    await tester.tap(find.text('abrir'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 900));
    await _shotOf(tester, '07-cuenta');
  });

  final preview = Container(decoration: const BoxDecoration(gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF3A3F4B), Color(0xFF14171D)])));

  Future<void> scan(WidgetTester tester, AccessMethod method, String name) async {
    final service = _FakeService();
    await _pump(
      tester,
      ScanScreen(service: service, meta: service.fakeMeta, method: method, assignment: (await (() async {
        await service.loadAssignments();
        return service.assignments.first;
      })()), previewOverride: preview),
    );
    await _shotOf(tester, name);
  }

  testWidgets('lectura con cámara', (tester) => scan(tester, AccessMethod.qr, '08-lectura-qr'));
  testWidgets('lectura con NFC', (tester) => scan(tester, AccessMethod.nfc, '09-lectura-nfc'));

  Future<void> overlay(WidgetTester tester, String name, ScanOutcome outcome, {String? zone}) async {
    await _pump(tester, Scaffold(body: ResultOverlay(outcome: outcome, onDismiss: () {}, duration: const Duration(seconds: 3), zoneLabel: zone)));
    await _shotOf(tester, name);
  }

  testWidgets('resultado: ingreso', (tester) => overlay(tester, '10-ok-ingreso', const ScanOutcome(verdict: ScanVerdict.accepted, movement: Movement.entry, ticket: _ana)));
  testWidgets('resultado: reingreso', (tester) => overlay(tester, '11-ok-reingreso', ScanOutcome(verdict: ScanVerdict.accepted, movement: Movement.reentry, ticket: _ana.copyWith(entries: 1))));
  testWidgets('resultado: salida', (tester) => overlay(tester, '12-ok-salida', const ScanOutcome(verdict: ScanVerdict.accepted, movement: Movement.exit, ticket: _ana)));
  testWidgets('resultado: zona', (tester) => overlay(tester, '13-ok-zona', const ScanOutcome(verdict: ScanVerdict.accepted, movement: Movement.zoneChange, ticket: _ana), zone: 'Acceso VIP'));
  testWidgets('resultado: ya utilizada', (tester) => overlay(tester, '14-aviso-ya-usada', const ScanOutcome(verdict: ScanVerdict.alreadyUsed, ticket: _ana, detail: 'Ingresó a las 22:14 y no salió.')));
  testWidgets('resultado: no existe', (tester) => overlay(tester, '15-rechazo', const ScanOutcome(verdict: ScanVerdict.notFound, detail: 'No está en la lista descargada. Actualiza los datos si se vendió hace poco.')));
  testWidgets('resultado: impresa sin vender', (tester) => overlay(tester, '16-rechazo-impresa', const ScanOutcome(verdict: ScanVerdict.cancelled, ticket: _ana, detail: 'Si es una entrada impresa, puede que todavía no esté marcada como vendida.')));

  testWidgets('hoja de confirmación', (tester) async {
    await _pump(tester, Scaffold(body: Builder(builder: (context) => Center(child: TextButton(onPressed: () => showConfirmSheet(context, outcome: const ScanOutcome(verdict: ScanVerdict.accepted, movement: Movement.entry, ticket: _ana), sectionName: 'Campo', gateName: 'Acceso VIP'), child: const Text('abrir'))))));
    await tester.tap(find.text('abrir'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 900));
    await _shotOf(tester, '17-confirmar');
  });

  testWidgets('últimas lecturas', (tester) async {
    final service = _FakeService();
    await _pump(tester, Scaffold(body: Builder(builder: (context) => Center(child: TextButton(onPressed: () => showRecentScans(context, () => service.recentScans('s1')), child: const Text('abrir'))))));
    await tester.tap(find.text('abrir'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 1500));
    await _shotOf(tester, '18-ultimas');
  });
}
