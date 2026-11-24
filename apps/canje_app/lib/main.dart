import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app_services.dart';
import 'door_service.dart';
import 'feedback.dart';
import 'screens/canje_home_screen.dart';
import 'screens/change_password_screen.dart';
import 'screens/login_screen.dart';
import 'settings.dart';
import 'storage.dart';
import 'ui/tokens.dart';
import 'ui/widgets.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
    systemNavigationBarColor: Brand.ink,
    systemNavigationBarIconBrightness: Brightness.light,
  ));
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  final store = SessionStore();
  final service = DoorService(sessionStore: store, db: await DoorDb.open(await store.dbKey));
  await service.restore();
  final settings = await AppSettings.load();
  runApp(CanjeApp(service: service, settings: settings, feedback: DoorFeedback(settings)));
}

class CanjeApp extends StatelessWidget {
  const CanjeApp({super.key, required this.service, required this.settings, required this.feedback});

  final DoorService service;
  final AppSettings settings;
  final DoorFeedback feedback;

  @override
  Widget build(BuildContext context) {
    return AppServices(
      settings: settings,
      feedback: feedback,
      child: MaterialApp(
        title: 'iPass Canje',
        debugShowCheckedModeBanner: false,
        themeMode: ThemeMode.dark,
        darkTheme: buildTheme().copyWith(scaffoldBackgroundColor: Colors.transparent),
        builder: (context, child) => Backdrop(child: child ?? const SizedBox.shrink()),
        home: ListenableBuilder(
          listenable: service,
          builder: (context, _) => AnimatedSwitcher(
            duration: const Duration(milliseconds: 380),
            child: !service.loggedIn
                ? LoginScreen(key: const ValueKey('login'), service: service)
                : service.mustChangePassword
                    ? ChangePasswordScreen(key: const ValueKey('password'), service: service)
                    : CanjeHomeScreen(key: const ValueKey('home'), service: service),
          ),
        ),
      ),
    );
  }
}
