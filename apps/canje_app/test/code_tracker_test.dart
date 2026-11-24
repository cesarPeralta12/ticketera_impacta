import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:impacta_canje/code_tracker.dart';

/// Cuadrado de lado [side] centrado en [c], como lo informa el lector (cuatro esquinas).
List<Offset> _square(Offset c, double side) => [
      c + Offset(-side / 2, -side / 2),
      c + Offset(side / 2, -side / 2),
      c + Offset(side / 2, side / 2),
      c + Offset(-side / 2, side / 2),
    ];

void main() {
  const screen = Size(400, 800);
  // Imagen vertical con la misma forma que la pantalla: sin recorte.
  const sameShape = Size(1000, 2000);
  // Imagen 9:16 en una pantalla más ancha en proporción: se recorta arriba y abajo (BoxFit.cover).
  const wider = Size(1080, 1920);

  group('dónde cae el código en la pantalla', () {
    test('el centro de la imagen es el centro de la pantalla', () {
      final r = codeRectOnScreen(corners: _square(const Offset(500, 1000), 200), image: sameShape, screen: screen, pad: 0, minSize: 0)!;
      expect(r.center.dx, closeTo(200, 0.01));
      expect(r.center.dy, closeTo(400, 0.01));
      expect(r.width, closeTo(80, 0.01)); // 200 px de imagen = 80 px de pantalla (escala 0,4)
    });

    test('con BoxFit.cover la imagen se recorta por los lados y se descuenta ese margen', () {
      // Escala = máx(400/1080, 800/1920) = 0,4167: la imagen mide 450×800 y sobran 25 px a cada lado.
      final r = codeRectOnScreen(corners: _square(const Offset(540, 960), 216), image: wider, screen: screen, pad: 0, minSize: 0)!;
      expect(r.center.dx, closeTo(200, 0.01));
      expect(r.center.dy, closeTo(400, 0.01));
      expect(r.width, closeTo(90, 0.01));
      // Una esquina de la imagen izquierda queda fuera de la pantalla (-25): el rectángulo se recorta a 0.
      final edge = codeRectOnScreen(corners: _square(const Offset(60, 960), 100), image: wider, screen: screen, pad: 0, minSize: 0)!;
      expect(edge.left, 0);
    });

    test('un código lejos del centro se ubica donde está', () {
      final r = codeRectOnScreen(corners: _square(const Offset(250, 500), 100), image: sameShape, screen: screen, pad: 0, minSize: 0)!;
      expect(r.center.dx, closeTo(100, 0.01));
      expect(r.center.dy, closeTo(200, 0.01));
    });

    test('el margen agranda el marco y un código pequeño no queda con un marco diminuto', () {
      final padded = codeRectOnScreen(corners: _square(const Offset(500, 1000), 200), image: sameShape, screen: screen, pad: 14, minSize: 0)!;
      expect(padded.width, closeTo(80 + 28, 0.01));
      final small = codeRectOnScreen(corners: _square(const Offset(500, 1000), 20), image: sameShape, screen: screen, pad: 0, minSize: 96)!;
      expect(small.width, 96);
      expect(small.height, 96);
      expect(small.center.dx, closeTo(200, 0.01));
    });

    test('el marco no se sale de la pantalla', () {
      final r = codeRectOnScreen(corners: _square(const Offset(980, 1950), 160), image: sameShape, screen: screen, pad: 30, minSize: 0)!;
      expect(r.right, lessThanOrEqualTo(400));
      expect(r.bottom, lessThanOrEqualTo(800));
    });
  });

  group('cuando no se puede ubicar con seguridad, el marco se queda fijo', () {
    test('menos de tres esquinas', () {
      expect(codeRectOnScreen(corners: const [Offset(1, 1), Offset(2, 2)], image: sameShape, screen: screen), isNull);
      expect(codeRectOnScreen(corners: const [], image: sameShape, screen: screen), isNull);
    });

    test('esquinas fuera de la imagen: el lector las informó en otra orientación', () {
      expect(codeRectOnScreen(corners: _square(const Offset(1800, 500), 100), image: sameShape, screen: screen), isNull);
    });

    test('imagen o pantalla vacías', () {
      expect(codeRectOnScreen(corners: _square(const Offset(10, 10), 5), image: Size.zero, screen: screen), isNull);
      expect(codeRectOnScreen(corners: _square(const Offset(10, 10), 5), image: sameShape, screen: Size.zero), isNull);
    });
  });

  group('orientación de la imagen', () {
    test('una imagen horizontal en una pantalla vertical se invierte', () {
      expect(uprightImageSize(const Size(1920, 1080), screen), const Size(1080, 1920));
    });

    test('una imagen que ya es vertical queda igual', () {
      expect(uprightImageSize(const Size(1080, 1920), screen), const Size(1080, 1920));
    });

    test('en una pantalla horizontal, la imagen horizontal queda igual', () {
      expect(uprightImageSize(const Size(1920, 1080), const Size(800, 400)), const Size(1920, 1080));
    });
  });
}
