import 'package:flutter/material.dart';

import 'door_service.dart';
import 'screens/change_password_screen.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'storage.dart';

const brandGreen = Color(0xFF0F8A6B);
const brandInk = Color(0xFF14181B);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final service = DoorService(sessionStore: SessionStore(), db: await DoorDb.open());
  await service.restore();
  runApp(PuertaApp(service: service));
}

class PuertaApp extends StatelessWidget {
  const PuertaApp({super.key, required this.service});

  final DoorService service;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Impacta Puerta',
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.dark,
      darkTheme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: brandInk,
        colorScheme: ColorScheme.fromSeed(seedColor: brandGreen, brightness: Brightness.dark, surface: brandInk),
        inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder()),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52), textStyle: const TextStyle(fontSize: 16)),
        ),
      ),
      home: ListenableBuilder(
        listenable: service,
        builder: (context, _) => !service.loggedIn
            ? LoginScreen(service: service)
            : service.mustChangePassword
                ? ChangePasswordScreen(service: service)
                : HomeScreen(service: service),
      ),
    );
  }
}
