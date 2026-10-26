/// Identidad visual de la app de puerta: colores, tipografía y el tema. Sigue la guía visual de iPass (la misma de la
/// web y el panel): azul noche de base, magenta para las acciones y la marca, amarillo para destacar, y Poppins.
/// El verde, el ámbar y el rojo quedan para el resultado de una lectura, que es lo que el portero tiene que ver de
/// un vistazo.
library;

import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';

class Brand {
  // Azul noche (fondos): el mismo de la web.
  static const ink = Color(0xFF111A2B);
  static const surface = Color(0xFF192438);
  static const surface2 = Color(0xFF222F48);
  static const surface3 = Color(0xFF2C3A57);
  static const stroke = Color(0xFF2A3751);
  static const text = Color(0xFFF5F6F8);
  static const muted = Color(0xFF9BA9C4);
  static const faint = Color(0xFF7D89A3);

  /// Magenta iPass: acciones principales y marca. El texto encima va en blanco.
  static const accent = Color(0xFFAD468D);
  static const accentDark = Color(0xFF913673);
  static const accentInk = Color(0xFFFFFFFF);
  static const pink = Color(0xFFD985B8);

  /// Azul pizarra del logo.
  static const slate = Color(0xFF60718B);

  /// Amarillo: para destacar (rótulos, cifras, la lectura en curso). Nunca de fondo de botón.
  static const highlight = Color(0xFFF5B700);
  static const highlightInk = Color(0xFF192438);

  /// Resultado de una lectura.
  static const green = Color(0xFF35C48F);
  static const greenDeep = Color(0xFF0E6B4D);
  static const amber = Color(0xFFFFB020);
  static const amberDeep = Color(0xFF8A5A00);
  static const red = Color(0xFFFF6B81);
  static const redDeep = Color(0xFFA3243A);

  /// Salida y "entrada y salida": azul pizarra claro (el del logo, aclarado para leerse sobre el fondo oscuro).
  static const blue = Color(0xFF8CA0C0);
  static const blueDeep = Color(0xFF34435F);

  /// Cambio de zona (VIP): rosa de la marca.
  static const violet = Color(0xFFD985B8);
  static const violetDeep = Color(0xFF7A2F62);
}

class Fonts {
  /// Poppins en toda la app (guía visual iPass): Bold títulos, SemiBold secciones, Medium botones, Regular texto.
  static const display = 'Poppins';
  static const body = 'Poppins';
}

/// Estilos de texto reutilizables.
class Type {
  static const hero = TextStyle(fontFamily: Fonts.display, fontSize: 28, fontWeight: FontWeight.w800, height: 1.12, letterSpacing: -0.5, color: Brand.text);
  static const title = TextStyle(fontFamily: Fonts.display, fontSize: 21, fontWeight: FontWeight.w700, height: 1.2, letterSpacing: -0.3, color: Brand.text);
  static const heading = TextStyle(fontFamily: Fonts.body, fontSize: 18, fontWeight: FontWeight.w600, height: 1.25, color: Brand.text);
  static const body = TextStyle(fontFamily: Fonts.body, fontSize: 15, fontWeight: FontWeight.w500, color: Brand.text, height: 1.35);
  static const muted = TextStyle(fontFamily: Fonts.body, fontSize: 13.5, fontWeight: FontWeight.w400, color: Brand.muted, height: 1.4);
  static const label = TextStyle(fontFamily: Fonts.body, fontSize: 11.5, fontWeight: FontWeight.w600, letterSpacing: 1.3, color: Brand.muted);
  static const number = TextStyle(fontFamily: Fonts.display, fontSize: 26, fontWeight: FontWeight.w700, letterSpacing: -0.4, color: Brand.text);
}

ThemeData buildTheme() {
  const scheme = ColorScheme.dark(
    primary: Brand.accent,
    onPrimary: Brand.accentInk,
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
      fillColor: Brand.surface,
      labelStyle: Type.muted,
      hintStyle: const TextStyle(color: Brand.faint),
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 18),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Brand.stroke)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Brand.stroke)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Brand.accent, width: 1.6)),
      errorBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Brand.red)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(56),
        backgroundColor: Brand.accent,
        foregroundColor: Brand.accentInk,
        textStyle: const TextStyle(fontFamily: Fonts.body, fontSize: 16, fontWeight: FontWeight.w600),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(54),
        foregroundColor: Brand.text,
        side: const BorderSide(color: Brand.stroke),
        textStyle: const TextStyle(fontFamily: Fonts.body, fontSize: 15, fontWeight: FontWeight.w600),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: Brand.muted, textStyle: const TextStyle(fontFamily: Fonts.body, fontWeight: FontWeight.w600)),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Brand.accentInk : Brand.muted),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Brand.accent : Brand.surface3),
      trackOutlineColor: WidgetStateProperty.all(Colors.transparent),
    ),
    pageTransitionsTheme: const PageTransitionsTheme(builders: {
      TargetPlatform.android: FadeForwardsPageTransitionsBuilder(),
      TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
    }),
    textSelectionTheme: const TextSelectionThemeData(cursorColor: Brand.accent, selectionHandleColor: Brand.accent),
  );
}
