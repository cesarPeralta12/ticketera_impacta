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

class Gate {
  const Gate({required this.id, required this.name, this.sectionIds = const []});

  final String id;
  final String name;
  final List<String> sectionIds;

  factory Gate.fromJson(Map<String, dynamic> json) => Gate(
        id: json['id'] as String,
        name: json['name'] as String,
        sectionIds: [for (final s in (json['sectionIds'] as List? ?? const [])) s as String],
      );

  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'sectionIds': sectionIds};
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
        'gates': [for (final g in gates) {'id': g.id, 'name': g.name}],
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
      );

  TicketRow copyWith({TicketStatus? status, DateTime? usedAt}) => TicketRow(
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

  /// Nombres de las puertas por las que entra una sección.
  List<String> gatesFor(String? sectionId) => [
        for (final g in gates)
          if (sectionId != null && g.sectionIds.contains(sectionId)) g.name,
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
  const DownloadResult({required this.meta, required this.tickets, required this.full});

  final SessionMeta meta;
  final List<TicketRow> tickets;

  /// true = lista completa; false = solo los cambios desde la última descarga.
  final bool full;

  factory DownloadResult.fromJson(Map<String, dynamic> json) {
    final tickets = [for (final t in json['tickets'] as List) TicketRow.fromJson(t as Map<String, dynamic>)];
    final session = json['session'] as Map<String, dynamic>;
    return DownloadResult(
      full: json['full'] as bool,
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
  methodNotAllowed('METHOD_NOT_ALLOWED');

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
      };
}

class ScanOutcome {
  const ScanOutcome({required this.verdict, this.ticket, this.detail});

  final ScanVerdict verdict;
  final TicketRow? ticket;

  /// Texto de apoyo: por dónde debe entrar, cuándo entró antes, etc.
  final String? detail;
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
  });

  final String id;
  final String sessionId;
  final String? gateId;
  final String raw;
  final String method;
  final DateTime scannedAt;

  /// Lo que decidió el teléfono. Los rechazos se suben tal cual; una aceptada la confirma el servidor.
  final ScanVerdict verdict;

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
