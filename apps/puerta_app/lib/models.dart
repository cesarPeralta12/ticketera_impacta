/// Modelos de la app de puerta: lo que llega del servidor y lo que se guarda en el teléfono.
library;

import 'package:flutter/material.dart';

/// Formas de leer una entrada. Cada tipo de entrada define cuáles admite.
enum AccessMethod {
  qr('QR', 'Cámara', 'Leer el QR con la cámara', Icons.qr_code_scanner),
  barcode('BARCODE', 'Código de barras', 'Leer el código de barras', Icons.view_week_outlined),
  nfc('NFC', 'NFC', 'Acercar la entrada al teléfono', Icons.nfc);

  const AccessMethod(this.api, this.label, this.hint, this.icon);

  /// Nombre que usa la API.
  final String api;
  final String label;
  final String hint;
  final IconData icon;

  static AccessMethod? fromApi(String value) {
    for (final m in AccessMethod.values) {
      if (m.api == value) return m;
    }
    return null;
  }
}

/// Cómo se leyó una entrada (los tres métodos más el código escrito a mano).
String scanMethodApi(AccessMethod? method) => method?.api ?? 'MANUAL';

/// Para qué lado sirve una puerta: entrada (lo de siempre), salida, o las dos según si la persona está adentro.
enum GateDirection {
  inward('IN', 'Entrada', Icons.south_east),
  outward('OUT', 'Salida', Icons.north_east),
  both('BOTH', 'Entrada y salida', Icons.swap_vert);

  const GateDirection(this.api, this.label, this.icon);

  final String api;
  final String label;
  final IconData icon;

  /// Un servidor anterior no manda la dirección: se entiende que es una puerta de entrada.
  static GateDirection fromApi(String? value) =>
      GateDirection.values.firstWhere((d) => d.api == value, orElse: () => GateDirection.inward);
}

class Gate {
  const Gate({required this.id, required this.name, this.sectionIds = const [], this.direction = GateDirection.inward, this.zoneId, this.directionKnown = true});

  final String id;
  final String name;
  final List<String> sectionIds;
  final GateDirection direction;

  /// Zona a la que da la puerta (ej. el VIP). Nula = ingreso general.
  final String? zoneId;

  /// La lista de funciones no trae la dirección de las puertas (solo la descarga): hasta entonces no se afirma
  /// que sea de entrada.
  final bool directionKnown;

  factory Gate.fromJson(Map<String, dynamic> json) => Gate(
        id: json['id'] as String,
        name: json['name'] as String,
        sectionIds: [for (final s in (json['sectionIds'] as List? ?? const [])) s as String],
        direction: GateDirection.fromApi(json['direction'] as String?),
        zoneId: json['zoneId'] as String?,
        directionKnown: json['direction'] != null,
      );

  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'sectionIds': sectionIds, if (directionKnown) 'direction': direction.api, 'zoneId': zoneId};
}

/// Una función (evento + fecha) que el portero puede controlar.
class Assignment {
  const Assignment({
    required this.sessionId,
    required this.title,
    required this.startsAt,
    required this.venue,
    required this.gates,
    required this.methods,
  });

  final String sessionId;
  final String title;
  final DateTime startsAt;
  final String venue;

  /// Puertas entre las que puede elegir (una sola si el panel le asignó una).
  final List<Gate> gates;

  /// Métodos de lectura que admiten las entradas de esta función.
  final List<AccessMethod> methods;

  factory Assignment.fromJson(Map<String, dynamic> json) => Assignment(
        sessionId: json['sessionId'] as String,
        title: json['title'] as String,
        startsAt: DateTime.parse(json['startsAt'] as String),
        venue: json['venue'] as String,
        gates: [for (final g in json['gates'] as List) Gate.fromJson(g as Map<String, dynamic>)],
        methods: [
          for (final m in json['methods'] as List)
            if (AccessMethod.fromApi(m as String) != null) AccessMethod.fromApi(m)!,
        ],
      );
}

extension AssignmentJson on Assignment {
  Map<String, dynamic> toJson() => {
        'sessionId': sessionId,
        'title': title,
        'startsAt': startsAt.toUtc().toIso8601String(),
        'venue': venue,
        'gates': [for (final g in gates) g.toJson()],
        'methods': [for (final m in methods) m.api],
      };
}

/// Estado de una entrada en la lista descargada.
enum TicketStatus {
  valid('V'),
  used('U'),
  cancelled('C');

  const TicketStatus(this.code);
  final String code;

  static TicketStatus fromCode(String code) =>
      TicketStatus.values.firstWhere((s) => s.code == code, orElse: () => TicketStatus.valid);
}

/// Una entrada de la lista descargada. Las de otras puertas llegan compactas (sin titular ni métodos).
class TicketRow {
  const TicketRow({
    required this.code,
    required this.status,
    required this.sectionId,
    required this.mine,
    this.holder,
    this.document,
    this.type,
    this.seat,
    this.methods = const [],
    this.usedAt,
    this.qrDynamic = false,
    this.key,
    this.inside,
    this.entries,
    this.maxEntries = 1,
    this.zoneIds = const [],
    this.zoneId,
  });

  final String code;
  final TicketStatus status;
  final String? sectionId;

  /// ¿Entra por la puerta de este teléfono?
  final bool mine;
  final String? holder;

  /// Carnet o documento de quien compró (para cotejarlo en puerta).
  final String? document;
  final String? type;
  final String? seat;
  final List<String> methods;

  /// Hora local en que se leyó en este teléfono (si ya entró aquí).
  final DateTime? usedAt;

  /// QR dinámico: solo vale con una prueba vigente (QR que cambia cada 30 s, o código + OTP).
  final bool qrDynamic;

  /// Llave de la entrada (base64url), solo al bajarla del servidor. En el teléfono se guarda cifrada y no viaja aquí.
  final String? key;

  /// ¿Está adentro ahora? Un servidor anterior no lo manda: se entiende que "usada" es "adentro".
  final bool? inside;

  /// Cuántas veces entró (nulo = según el estado).
  final int? entries;

  /// Cuántas veces puede entrar: 1 = un solo ingreso (lo de siempre), 0 = sin límite.
  final int maxEntries;

  /// Zonas que abre su tipo de entrada (vacío = las de siempre, sin restricción).
  final List<String> zoneIds;

  /// Zona en la que quedó según lo leído en este teléfono (el servidor no la manda).
  final String? zoneId;

  bool get isInside => inside ?? status == TicketStatus.used;
  int get entryCount => entries ?? (status == TicketStatus.used ? 1 : 0);

  /// ¿Ya entró alguna vez? (una que salió y puede volver baja como "válida", pero ya había entrado).
  bool get hasEntered => entryCount > 0;

  /// Entró, salió, y todavía le quedan ingresos.
  bool get canReenter => !isInside && hasEntered && (maxEntries == 0 || entryCount < maxEntries);

  factory TicketRow.fromJson(Map<String, dynamic> json) => TicketRow(
        code: json['code'] as String,
        status: TicketStatus.fromCode(json['status'] as String),
        sectionId: json['sectionId'] as String?,
        mine: json['mine'] as bool? ?? true,
        holder: json['holder'] as String?,
        document: json['document'] as String?,
        type: json['type'] as String?,
        seat: json['seat'] as String?,
        methods: [for (final m in (json['methods'] as List? ?? const [])) m as String],
        qrDynamic: json['dynamic'] as bool? ?? false,
        key: json['key'] as String?,
        inside: json['inside'] as bool?,
        entries: (json['entries'] as num?)?.toInt(),
        maxEntries: (json['maxEntries'] as num?)?.toInt() ?? 1,
        zoneIds: [for (final z in (json['zoneIds'] as List? ?? const [])) z as String],
      );

  TicketRow copyWith({TicketStatus? status, DateTime? usedAt, bool? inside, int? entries, String? zoneId}) => TicketRow(
        code: code,
        status: status ?? this.status,
        sectionId: sectionId,
        mine: mine,
        holder: holder,
        document: document,
        type: type,
        seat: seat,
        methods: methods,
        usedAt: usedAt ?? this.usedAt,
        qrDynamic: qrDynamic,
        key: key,
        inside: inside ?? this.inside,
        entries: entries ?? this.entries,
        maxEntries: maxEntries,
        zoneIds: zoneIds,
        zoneId: zoneId ?? this.zoneId,
      );
}

/// Datos de una función ya descargada.
class SessionMeta {
  const SessionMeta({
    required this.sessionId,
    required this.title,
    required this.gateId,
    required this.gates,
    required this.sections,
    required this.syncedAt,
    required this.ticketCount,
  });

  final String sessionId;
  final String title;

  /// Puerta de este teléfono (null = sin restricción).
  final String? gateId;
  final List<Gate> gates;
  final Map<String, String> sections;

  /// Hora del servidor de la última descarga (para pedir solo los cambios).
  final String syncedAt;
  final int ticketCount;

  Gate? get gate => gates.where((g) => g.id == gateId).firstOrNull;

  /// Nombres de las puertas de entrada por las que entra una sección.
  List<String> gatesFor(String? sectionId) => [
        for (final g in gates)
          if (g.direction != GateDirection.outward && sectionId != null && g.sectionIds.contains(sectionId)) g.name,
      ];

  /// Nombres de las puertas de entrada que dan a una zona.
  List<String> gatesForZones(List<String> zoneIds) => [
        for (final g in gates)
          if (g.direction != GateDirection.outward && g.zoneId != null && zoneIds.contains(g.zoneId)) g.name,
      ];

  Map<String, dynamic> toJson() => {
        'sessionId': sessionId,
        'title': title,
        'gateId': gateId,
        'gates': [for (final g in gates) g.toJson()],
        'sections': sections,
        'syncedAt': syncedAt,
        'ticketCount': ticketCount,
      };

  factory SessionMeta.fromJson(Map<String, dynamic> json) => SessionMeta(
        sessionId: json['sessionId'] as String,
        title: json['title'] as String,
        gateId: json['gateId'] as String?,
        gates: [for (final g in json['gates'] as List) Gate.fromJson(g as Map<String, dynamic>)],
        sections: {for (final e in (json['sections'] as Map).entries) e.key as String: e.value as String},
        syncedAt: json['syncedAt'] as String,
        ticketCount: json['ticketCount'] as int,
      );
}

/// Respuesta de `GET /sessions/:id/download`.
class DownloadResult {
  const DownloadResult({required this.meta, required this.tickets, required this.full, this.revoked = const []});

  final SessionMeta meta;
  final List<TicketRow> tickets;

  /// true = lista completa; false = solo los cambios desde la última descarga.
  final bool full;

  /// Códigos que dejaron de valer (la entrada se transfirió y tiene un código nuevo).
  final List<String> revoked;

  factory DownloadResult.fromJson(Map<String, dynamic> json) {
    final tickets = [for (final t in json['tickets'] as List) TicketRow.fromJson(t as Map<String, dynamic>)];
    final session = json['session'] as Map<String, dynamic>;
    return DownloadResult(
      full: json['full'] as bool,
      revoked: [for (final c in (json['revoked'] as List? ?? const [])) c as String],
      tickets: tickets,
      meta: SessionMeta(
        sessionId: session['id'] as String,
        title: session['title'] as String,
        gateId: json['gateId'] as String?,
        gates: [for (final g in json['gates'] as List) Gate.fromJson(g as Map<String, dynamic>)],
        sections: {for (final e in (json['sections'] as Map).entries) e.key as String: e.value as String},
        syncedAt: json['syncedAt'] as String,
        ticketCount: tickets.length,
      ),
    );
  }
}

/// Resultado de validar una entrada en el teléfono.
enum ScanVerdict {
  accepted('ACCEPTED'),
  alreadyUsed('ALREADY_USED'),
  notFound('NOT_FOUND'),
  cancelled('CANCELLED'),
  wrongGate('WRONG_GATE'),
  invalid('INVALID'),
  methodNotAllowed('METHOD_NOT_ALLOWED'),
  qrExpired('QR_EXPIRED'),
  staticNotAllowed('STATIC_NOT_ALLOWED'),
  outOfHours('OUT_OF_HOURS'),
  notActivated('NOT_ACTIVATED'),
  notInside('NOT_INSIDE');

  const ScanVerdict(this.api);
  final String api;

  bool get ok => this == ScanVerdict.accepted;

  String get title => switch (this) {
        ScanVerdict.accepted => 'ACCESO AUTORIZADO',
        ScanVerdict.alreadyUsed => 'YA UTILIZADA',
        ScanVerdict.notFound => 'NO EXISTE',
        ScanVerdict.cancelled => 'ENTRADA ANULADA',
        ScanVerdict.wrongGate => 'PUERTA EQUIVOCADA',
        ScanVerdict.invalid => 'CÓDIGO INVÁLIDO',
        ScanVerdict.methodNotAllowed => 'MÉTODO NO PERMITIDO',
        ScanVerdict.qrExpired => 'QR VENCIDO',
        ScanVerdict.staticNotAllowed => 'EXIGE QR DINÁMICO',
        ScanVerdict.outOfHours => 'FUERA DE HORARIO',
        ScanVerdict.notActivated => 'IMPRESA SIN VENDER',
        ScanVerdict.notInside => 'NO ESTABA ADENTRO',
      };

  /// Gravedad para elegir color y sonido: aviso (se puede resolver) o rechazo.
  bool get isWarning => switch (this) {
        ScanVerdict.alreadyUsed ||
        ScanVerdict.wrongGate ||
        ScanVerdict.methodNotAllowed ||
        ScanVerdict.qrExpired ||
        ScanVerdict.staticNotAllowed ||
        ScanVerdict.outOfHours ||
        ScanVerdict.notInside =>
          true,
        _ => false,
      };

  static ScanVerdict? fromApi(String value) {
    for (final v in ScanVerdict.values) {
      if (v.api == value) return v;
    }
    return null;
  }
}

/// Qué pasó con la persona al aceptar la lectura.
enum Movement {
  entry('ENTRY', 'Ingreso', 'ACCESO AUTORIZADO'),
  reentry('REENTRY', 'Reingreso', 'REINGRESO AUTORIZADO'),
  exit('EXIT', 'Salida', 'SALIDA REGISTRADA'),
  zoneChange('ZONE_CHANGE', 'Cambio de zona', 'PASO AUTORIZADO');

  const Movement(this.api, this.label, this.title);

  final String api;
  final String label;
  final String title;

  static Movement? fromApi(String? value) {
    for (final m in Movement.values) {
      if (m.api == value) return m;
    }
    return null;
  }
}

class ScanOutcome {
  const ScanOutcome({required this.verdict, this.ticket, this.detail, this.movement, this.gateName, this.askExit = false});

  final ScanVerdict verdict;
  final TicketRow? ticket;

  /// Texto de apoyo: por dónde debe entrar, cuándo entró antes, etc.
  final String? detail;

  /// Solo en las aceptadas: ingreso, reingreso, salida o cambio de zona.
  final Movement? movement;

  /// Puerta por la que se leyó (para decir "pasó a la zona de Acceso VIP").
  final String? gateName;

  /// La entrada ya ingresó y se leyó en una puerta que no es solo de salida: el portero decide si la persona está
  /// saliendo (se registra la salida) o si es una entrada ya usada.
  final bool askExit;

  /// Título grande de la pantalla de resultado.
  String get title => verdict.ok ? (movement ?? Movement.entry).title : verdict.title;
}

/// Lectura guardada en el teléfono, pendiente de subir.
class PendingScan {
  const PendingScan({
    required this.id,
    required this.sessionId,
    required this.gateId,
    required this.raw,
    required this.method,
    required this.scannedAt,
    required this.verdict,
    this.movement,
    this.zoneId,
  });

  final String id;
  final String sessionId;
  final String? gateId;
  final String raw;
  final String method;
  final DateTime scannedAt;

  /// Lo que decidió el teléfono. Los rechazos se suben tal cual; una aceptada la confirma el servidor.
  final ScanVerdict verdict;

  /// Ingreso, reingreso, salida o cambio de zona: solo sirve para rehacer el estado local (el servidor lo decide
  /// por la dirección de la puerta, así que no se envía).
  final Movement? movement;

  /// Zona en la que quedó la persona (la de la puerta) según este teléfono.
  final String? zoneId;

  Map<String, dynamic> toApi() => {
        'id': id,
        'raw': raw,
        'method': method,
        'scannedAt': scannedAt.toUtc().toIso8601String(),
        'offline': true,
        'accessPointId': ?gateId,
        if (!verdict.ok) 'offlineResult': verdict.api,
      };
}

/// Una lectura reciente, para la lista "Últimas lecturas".
class RecentScan {
  const RecentScan({required this.at, required this.verdict, required this.movement, this.holder, this.type, this.code});

  final DateTime at;
  final ScanVerdict verdict;
  final Movement? movement;
  final String? holder;
  final String? type;
  final String? code;
}
