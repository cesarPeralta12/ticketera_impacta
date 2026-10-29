/// Dónde está una entrada ahora (afuera, adentro, en qué zona) y qué pasaría si se lee en esta puerta. Lo usa la
/// consulta: quien revisa una zona mira el estado de la persona SIN registrar ningún movimiento.
library;

import 'models.dart';

/// Estado de presencia de la entrada.
enum PresenceState {
  /// Todavía no ingresó.
  neverEntered,

  /// Está adentro.
  inside,

  /// Entró y salió.
  left,
}

class PresenceView {
  const PresenceView({
    required this.state,
    required this.headline,
    this.where,
    this.opens,
    this.thisZone,
    this.entriesLine,
    this.ifScannedHere,
  });

  final PresenceState state;

  /// "ADENTRO", "AFUERA · ya salió" o "TODAVÍA NO INGRESÓ".
  final String headline;

  /// Zona en la que está ahora ("Ultra VIP"), si se sabe.
  final String? where;

  /// Zonas que abre la entrada ("General y VIP"), si tiene restricción.
  final String? opens;

  /// ¿Está ahora en la zona de esta puerta? Nulo si la puerta no da a una zona.
  final bool? thisZone;

  /// "2 de 3 ingresos usados", "Reingresos sin límite (lleva 2)".
  final String? entriesLine;

  /// Qué haría la lectura en esta puerta ("INGRESO", "SALIDA", "Esta entrada no abre esta zona"…).
  final String? ifScannedHere;
}

/// Describe el estado de [ticket] frente a la puerta de [meta]. [outcome] es lo que decidiría el validador para esa
/// lectura (sin haberla registrado).
PresenceView describePresence(TicketRow ticket, SessionMeta meta, ScanOutcome outcome) {
  final inside = ticket.isInside;
  final state = inside
      ? PresenceState.inside
      : ticket.hasEntered
          ? PresenceState.left
          : PresenceState.neverEntered;

  final zoneName = ticket.zoneId == null ? null : (meta.zones[ticket.zoneId!] ?? meta.gates.where((g) => g.zoneId == ticket.zoneId).map((g) => g.zoneName).whereType<String>().firstOrNull);
  final gateZone = meta.gate?.zoneId;

  final headline = switch (state) {
    PresenceState.inside => zoneName == null ? 'ADENTRO' : 'ADENTRO · $zoneName',
    PresenceState.left => 'AFUERA · ya salió',
    PresenceState.neverEntered => 'TODAVÍA NO INGRESÓ',
  };

  String? entriesLine;
  if (ticket.maxEntries != 1) {
    entriesLine = ticket.maxEntries == 0 ? 'Reingresos sin límite (lleva ${ticket.entryCount})' : '${ticket.entryCount} de ${ticket.maxEntries} ingresos usados';
  } else if (ticket.entryCount > 0) {
    entriesLine = 'Ingreso único (ya lo usó)';
  }

  final what = outcome.verdict.ok ? (outcome.movement ?? Movement.entry).label.toUpperCase() : outcome.title;

  return PresenceView(
    state: state,
    headline: headline,
    where: zoneName,
    opens: meta.zonesIncluded(ticket.zoneIds),
    thisZone: gateZone == null ? null : (inside && ticket.zoneId == gateZone),
    entriesLine: entriesLine,
    ifScannedHere: outcome.detail == null ? what : '$what · ${outcome.detail}',
  );
}
