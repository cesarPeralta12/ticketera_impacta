/// Identidad visual de la app de puerta: colores, tipografía y el tema. Comparte la marca con la web de Impacta
/// (fondo oscuro, amarillo de acento, titulares condensados) y usa el verde, el ámbar y el rojo solo para el resultado
/// de una lectura, que es lo que el portero tiene que ver de un vistazo.
library;

import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';

class Brand {
  static const ink = Color(0xFF07090C);
  static const surface = Color(0xFF10141A);
  static const surface2 = Color(0xFF171C23);
  static const surface3 = Color(0xFF1F252E);
  static const stroke = Color(0x1FFFFFFF);
  static const text = Color(0xFFF4F6F8);
  static const muted = Color(0xFF98A2B0);
  static const faint = Color(0xFF6B7482);

  /// Amarillo de la marca: acciones principales y detalles.
  static const yellow = Color(0xFFF5B700);
  static const yellowInk = Color(0xFF1A1400);

  /// Resultado de una lectura.
  static const green = Color(0xFF1FD6A0);
  static const greenDeep = Color(0xFF0B6B52);
  static const amber = Color(0xFFFFB020);
  static const amberDeep = Color(0xFF8A5A00);
  static const red = Color(0xFFFF4D5E);
  static const redDeep = Color(0xFF8F1B29);

  /// Acentos: salida, zonas VIP, información.
  static const blue = Color(0xFF4EA1FF);
  static const violet = Color(0xFFB56BFF);
}

class Fonts {
  static const display = 'Anton';
  static const body = 'Barlow';
}

/// Estilos de texto reutilizables. El titular grande va en Anton y en mayúsculas, como en la web.
class Type {
  static const hero = TextStyle(fontFamily: Fonts.display, fontSize: 40, height: 1.02, letterSpacing: 0.4, color: Brand.text);
  static const title = TextStyle(fontFamily: Fonts.display, fontSize: 26, height: 1.1, letterSpacing: 0.3, color: Brand.text);
  static const heading = TextStyle(fontFamily: Fonts.body, fontSize: 20, fontWeight: FontWeight.w700, color: Brand.text);
  static const body = TextStyle(fontFamily: Fonts.body, fontSize: 16, fontWeight: FontWeight.w500, color: Brand.text, height: 1.3);
  static const muted = TextStyle(fontFamily: Fonts.body, fontSize: 14, fontWeight: FontWeight.w500, color: Brand.muted, height: 1.3);
  static const label = TextStyle(fontFamily: Fonts.body, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 1.4, color: Brand.muted);
  static const number = TextStyle(fontFamily: Fonts.display, fontSize: 30, color: Brand.text);
}

ThemeData buildTheme() {
  const scheme = ColorScheme.dark(
    primary: Brand.yellow,
    onPrimary: Brand.yellowInk,
    secondary: Brand.green,
    onSecondary: Brand.ink,
    error: Brand.red,
    onError: Colors.white,
    surface: Brand.surface,
    onSurface: Brand.text,
    onSurfaceVariant: Brand.muted,
    outline: Brand.stroke,
    surfaceContainerHighest: Brand.surface3,
    surfaceContainerHigh: Brand.surface2,
  );
  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: scheme,
    scaffoldBackgroundColor: Brand.ink,
    fontFamily: Fonts.body,
    splashFactory: InkSparkle.splashFactory,
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: Type.heading,
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: Brand.surface3,
      contentTextStyle: Type.body,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: Brand.surface2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      titleTextStyle: Type.heading,
      contentTextStyle: Type.muted,
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: Brand.surface2,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Brand.surface2,
      labelStyle: Type.muted,
      hintStyle: const TextStyle(color: Brand.faint),
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 18),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Brand.stroke)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Brand.stroke)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Brand.yellow, width: 1.6)),
      errorBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Brand.red)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(56),
        backgroundColor: Brand.yellow,
        foregroundColor: Brand.yellowInk,
        textStyle: const TextStyle(fontFamily: Fonts.body, fontSize: 17, fontWeight: FontWeight.w700, letterSpacing: 0.4),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(54),
        foregroundColor: Brand.text,
        side: const BorderSide(color: Brand.stroke),
        textStyle: const TextStyle(fontFamily: Fonts.body, fontSize: 16, fontWeight: FontWeight.w600),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: Brand.muted, textStyle: const TextStyle(fontFamily: Fonts.body, fontWeight: FontWeight.w600)),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Brand.yellowInk : Brand.muted),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Brand.yellow : Brand.surface3),
      trackOutlineColor: WidgetStateProperty.all(Colors.transparent),
    ),
    pageTransitionsTheme: const PageTransitionsTheme(builders: {
      TargetPlatform.android: FadeForwardsPageTransitionsBuilder(),
      TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
    }),
    textSelectionTheme: const TextSelectionThemeData(cursorColor: Brand.yellow, selectionHandleColor: Brand.yellow),
  );
}
