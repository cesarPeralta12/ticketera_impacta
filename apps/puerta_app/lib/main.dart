import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app_services.dart';
import 'door_service.dart';
import 'feedback.dart';
import 'screens/change_password_screen.dart';
import 'screens/home_screen.dart';
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
  runApp(PuertaApp(service: service, settings: settings, feedback: DoorFeedback(settings)));
}

class PuertaApp extends StatelessWidget {
  const PuertaApp({super.key, required this.service, required this.settings, required this.feedback});

  final DoorService service;
  final AppSettings settings;
  final DoorFeedback feedback;

  @override
  Widget build(BuildContext context) {
    return AppServices(
      settings: settings,
      feedback: feedback,
      child: MaterialApp(
        title: 'iPass Puerta',
        debugShowCheckedModeBanner: false,
        themeMode: ThemeMode.dark,
        darkTheme: buildTheme().copyWith(scaffoldBackgroundColor: Colors.transparent),
        // El fondo con resplandores vive debajo de todas las pantallas: al cambiar de una a otra, no parpadea.
        builder: (context, child) => Backdrop(child: child ?? const SizedBox.shrink()),
        home: ListenableBuilder(
          listenable: service,
          builder: (context, _) => AnimatedSwitcher(
            duration: const Duration(milliseconds: 380),
            switchInCurve: Curves.easeOutCubic,
            transitionBuilder: (child, animation) => FadeTransition(
              opacity: animation,
              child: SlideTransition(position: Tween(begin: const Offset(0, 0.03), end: Offset.zero).animate(animation), child: child),
            ),
            child: !service.loggedIn
                ? LoginScreen(key: const ValueKey('login'), service: service)
                : service.mustChangePassword
                    ? ChangePasswordScreen(key: const ValueKey('password'), service: service)
                    : HomeScreen(key: const ValueKey('home'), service: service),
          ),
        ),
      ),
    );
  }
}
