/// Dónde está en la pantalla el código que ve la cámara, para que el marco de lectura lo siga (como el lector de Google).
///
/// El lector da las esquinas del código en la imagen de la cámara. La vista previa muestra esa imagen a pantalla
/// completa recortada (BoxFit.cover), así que hay que escalarla y centrarla igual para saber dónde cae en la pantalla.
library;

import 'dart:math' as math;
import 'dart:ui';

/// Imagen de la cámara con la misma orientación que la pantalla: el lector a veces la informa girada (ancho y alto
/// cambiados). Si la pantalla es vertical y la imagen horizontal (o al revés), se invierte.
Size uprightImageSize(Size image, Size screen) {
  final imageLandscape = image.width > image.height;
  final screenLandscape = screen.width > screen.height;
  return imageLandscape == screenLandscape ? image : Size(image.height, image.width);
}

/// Rectángulo en pantalla que ocupa un código a partir de sus [corners] (en la imagen de la cámara, de tamaño [image]).
///
/// Devuelve null si no se puede ubicar con seguridad (menos de tres esquinas, o esquinas fuera de la imagen: señal de que
/// el lector las informó en otra orientación): en ese caso el marco se queda fijo, que es lo seguro.
/// [pad] agranda el rectángulo para que el marco rodee el código; [minSize] evita un marco diminuto.
Rect? codeRectOnScreen({
  required List<Offset> corners,
  required Size image,
  required Size screen,
  double pad = 14,
  double minSize = 96,
}) {
  if (corners.length < 3 || image.isEmpty || screen.isEmpty) return null;
  final slackX = image.width * 0.08;
  final slackY = image.height * 0.08;
  for (final c in corners) {
    if (c.dx < -slackX || c.dx > image.width + slackX || c.dy < -slackY || c.dy > image.height + slackY) return null;
  }
  final scale = math.max(screen.width / image.width, screen.height / image.height);
  final dx = (screen.width - image.width * scale) / 2;
  final dy = (screen.height - image.height * scale) / 2;
  final points = [for (final c in corners) Offset(c.dx * scale + dx, c.dy * scale + dy)];
  var rect = Rect.fromLTRB(
    points.map((p) => p.dx).reduce(math.min),
    points.map((p) => p.dy).reduce(math.min),
    points.map((p) => p.dx).reduce(math.max),
    points.map((p) => p.dy).reduce(math.max),
  ).inflate(pad);
  if (rect.width < minSize || rect.height < minSize) {
    rect = Rect.fromCenter(center: rect.center, width: math.max(rect.width, minSize), height: math.max(rect.height, minSize));
  }
  // Un código a medio salir de la pantalla: el marco queda dentro.
  rect = rect.intersect(Offset.zero & screen);
  return rect.isEmpty ? null : rect;
}
