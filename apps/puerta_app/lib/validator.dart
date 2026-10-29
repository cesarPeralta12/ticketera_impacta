/// Validación de una entrada en el teléfono, sin internet. Lógica pura (sin Flutter ni base de datos)
/// para poder probarla: refleja las reglas de `scanTicket` del servidor.
library;

import 'dart:typed_data';

import 'dynamic_qr.dart';
import 'models.dart';

/// Alfabeto de los códigos de entrada (sin 0/O, 1/I/L), igual que el servidor.
const _alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const codeLength = 10;

bool isValidCode(String code) =>
    code.length == codeLength && code.split('').every(_alphabet.contains);

String _clean(String s) => s.replaceAll('-', '').toUpperCase();

/// Código de entrada a partir de lo leído: el QR completo `TK1.<código>.<firma>`, el QR dinámico
/// `TK2.<código>.<paso>.<prueba>`, el código de barras (el código a secas) o lo escrito a mano (con o sin
/// guion, y con el OTP de 6 dígitos si la entrada es dinámica). null si no parece una entrada.
///
/// No verifica la firma estática: el teléfono no lleva el secreto. Valida que el código exista en la lista
/// descargada (son aleatorios, no se pueden adivinar). La prueba del QR dinámico sí se verifica en
/// [validateScan] con la llave descargada.
String? extractTicketCode(String raw) {
  final input = raw.trim();
  if (input.startsWith('TK2.')) return parseDynamicPayload(input)?.code;
  final withOtp = parseManualWithOtp(input);
  if (withOtp != null) return withOtp.code;
  if (input.startsWith('TK1.')) {
    final parts = input.split('.');
    return parts.length == 3 && isValidCode(parts[1]) && parts[2].isNotEmpty ? parts[1] : null;
  }
  final manual = _clean(input);
  return isValidCode(manual) ? manual : null;
}

/// Código dentro del texto de una etiqueta NFC (texto o enlace): acepta el QR completo o el código suelto.
String? extractCodeFromNfcText(String text) {
  final direct = extractTicketCode(text);
  if (direct != null) return direct;
  final qr = RegExp(r'TK[12]\.[A-Za-z0-9]{10}\.[A-Za-z0-9_.-]+').firstMatch(text);
  if (qr != null) return extractTicketCode(qr.group(0)!);
  for (final m in RegExp(r'[A-Za-z0-9-]{10,11}').allMatches(text)) {
    final code = extractTicketCode(m.group(0)!);
    if (code != null) return code;
  }
  return null;
}

/// Acceso a la lista descargada y a lo ya leído en este teléfono.
abstract class TicketLookup {
  Future<TicketRow?> find(String sessionId, String code);

  /// Llave del QR dinámico de una entrada (descifrada), o null si no la hay.
  Future<Uint8List?> keyFor(String sessionId, String code);
}

String _hhmm(DateTime t) {
  final l = t.toLocal();
  return '${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
}

/// Decide qué pasa con una lectura, en este orden (como el servidor):
/// ¿es un código válido? ¿existe? ¿es de otra puerta? ¿la prueba del QR dinámico es vigente? ¿se puede leer
/// con este método? ¿está anulada? ¿ya entró?
///
/// [now] es la hora del servidor según el teléfono (su reloj más el desfase medido al sincronizar): con ella
/// se compara el paso del QR dinámico.
Future<ScanOutcome> validateScan({
  required TicketLookup tickets,
  required SessionMeta meta,
  required String raw,
  required AccessMethod? method,
  DateTime? now,
}) async {
  final code = extractTicketCode(raw);
  if (code == null) return const ScanOutcome(verdict: ScanVerdict.invalid);

  final ticket = await tickets.find(meta.sessionId, code);
  if (ticket == null) {
    return const ScanOutcome(
      verdict: ScanVerdict.notFound,
      detail: 'No está en la lista descargada. Actualiza los datos si se vendió hace poco.',
    );
  }

  if (!ticket.mine) {
    final gates = meta.gatesFor(ticket.sectionId);
    return ScanOutcome(
      verdict: ScanVerdict.wrongGate,
      ticket: ticket,
      detail: gates.isEmpty ? 'Esta entrada no entra por esta puerta.' : 'Debe entrar por: ${gates.join(', ')}',
    );
  }

  final dynamicFailure = await _checkDynamic(tickets, meta, ticket, raw.trim(), (now ?? DateTime.now()).millisecondsSinceEpoch);
  if (dynamicFailure != null) return ScanOutcome(verdict: dynamicFailure.$1, ticket: ticket, detail: dynamicFailure.$2);

  // Escribir el código a mano siempre se admite: es el respaldo si el lector falla.
  if (method != null && !ticket.methods.contains(method.api)) {
    final allowed = [
      for (final m in ticket.methods)
        if (AccessMethod.fromApi(m) != null) AccessMethod.fromApi(m)!.label,
    ];
    return ScanOutcome(
      verdict: ScanVerdict.methodNotAllowed,
      ticket: ticket,
      detail: allowed.isEmpty ? null : 'Esta entrada se lee con: ${allowed.join(', ')}',
    );
  }

  if (ticket.status == TicketStatus.cancelled) {
    return ScanOutcome(
      verdict: ScanVerdict.cancelled,
      ticket: ticket,
      // Una impresa que todavía no se marcó vendida baja anulada: se aclara para que el portero no piense que es falsa.
      detail: 'Si es una entrada impresa, puede que todavía no esté marcada como vendida.',
    );
  }

  final gate = meta.gate;
  final includes = meta.zonesIncluded(ticket.zoneIds);
  final direction = gate?.direction ?? GateDirection.inward;
  final inside = ticket.isInside;
  final gateZone = gate?.zoneId;
  // Sin ninguna puerta de salida en el recinto, una entrada con reingreso sale (al baño, a fumar) y vuelve por la misma
  // puerta de entrada: con la persona adentro, la lectura es la salida y la siguiente, la vuelta. Sin reingreso la segunda
  // lectura sigue siendo "ya utilizada". Si la puerta da a otra zona que la entrada abre (VIP), es un cambio de zona.
  final venueHasExitGate = meta.gates.any((g) => g.direction != GateDirection.inward);
  final leadsToOtherZone = gateZone != null && gateZone != ticket.zoneId && (ticket.zoneIds.isEmpty || ticket.zoneIds.contains(gateZone));
  final sameDoorExit = direction == GateDirection.inward && inside && ticket.maxEntries != 1 && !venueHasExitGate && !leadsToOtherZone;
  // Una puerta de salida, o de ida y vuelta con la persona adentro: es una salida (sin zonas ni reingreso).
  final exiting = direction == GateDirection.outward || (direction == GateDirection.both && inside) || sameDoorExit;
  if (exiting) {
    if (inside) {
      return ScanOutcome(
        verdict: ScanVerdict.accepted,
        ticket: ticket,
        movement: Movement.exit,
        gateName: gate?.name,
        includes: includes,
        // En una puerta de entrada (o de entrada y salida) no se sabe si la persona sale o es una lectura repetida:
        // se le pregunta al portero. En una puerta solo de salida no hay duda.
        askExit: direction != GateDirection.outward,
      );
    }
    return ScanOutcome(
      verdict: ScanVerdict.notInside,
      ticket: ticket,
      detail: ticket.hasEntered ? 'Ya había salido.' : 'Esta entrada todavía no ingresó.',
    );
  }

  // Una puerta que da a una zona (VIP) solo acepta las entradas que abren esa zona.
  if (gateZone != null && ticket.zoneIds.isNotEmpty && !ticket.zoneIds.contains(gateZone)) {
    final others = meta.gatesForZones(ticket.zoneIds);
    return ScanOutcome(
      verdict: ScanVerdict.wrongGate,
      ticket: ticket,
      detail: others.isEmpty ? 'Esta entrada no abre esta zona.' : 'No abre esta zona. Debe entrar por: ${others.join(', ')}',
    );
  }

  if (inside) {
    // Ya está adentro: si la puerta da a otra zona que su entrada abre, pasa de zona; si no, ya está usada.
    if (gateZone != null && ticket.zoneId != gateZone) {
      return ScanOutcome(verdict: ScanVerdict.accepted, ticket: ticket, movement: Movement.zoneChange, gateName: gate?.name, includes: includes);
    }
    final at = ticket.usedAt;
    return ScanOutcome(
      verdict: ScanVerdict.alreadyUsed,
      ticket: ticket,
      detail: at == null ? 'Ya está adentro.' : 'Ingresó a las ${_hhmm(at)} y no salió.',
    );
  }
  if (ticket.hasEntered) {
    // Salió: vuelve a entrar solo si le quedan ingresos.
    if (ticket.canReenter || ticket.status == TicketStatus.valid) {
      return ScanOutcome(verdict: ScanVerdict.accepted, ticket: ticket, movement: Movement.reentry, gateName: gate?.name, includes: includes);
    }
    final n = ticket.entryCount;
    return ScanOutcome(
      verdict: ScanVerdict.alreadyUsed,
      ticket: ticket,
      detail: ticket.maxEntries == 1 ? 'Ya ingresó y su entrada es de un solo ingreso.' : 'Ya usó sus $n ingreso(s).',
    );
  }
  if (ticket.status == TicketStatus.used) {
    final at = ticket.usedAt;
    return ScanOutcome(verdict: ScanVerdict.alreadyUsed, ticket: ticket, detail: at == null ? 'Ya ingresó antes.' : 'Ingresó a las ${_hhmm(at)}');
  }
  return ScanOutcome(verdict: ScanVerdict.accepted, ticket: ticket, movement: Movement.entry, gateName: gate?.name, includes: includes);
}

/// Entradas de QR dinámico: solo valen con una prueba vigente. Devuelve el rechazo y su explicación, o null si pasa.
Future<(ScanVerdict, String)?> _checkDynamic(TicketLookup tickets, SessionMeta meta, TicketRow ticket, String raw, int nowMs) async {
  final dynamic = raw.startsWith('TK2.') ? parseDynamicPayload(raw) : null;
  final otp = dynamic == null ? parseManualWithOtp(raw) : null;

  if (dynamic != null) {
    // Un QR dinámico solo existe para entradas dinámicas.
    if (!ticket.qrDynamic) return (ScanVerdict.invalid, 'Esta entrada no es de QR dinámico.');
    final key = await tickets.keyFor(meta.sessionId, ticket.code);
    if (key == null) return (ScanVerdict.invalid, 'Falta la llave de esta entrada. Actualiza los datos con internet.');
    return switch (verifyDynamicPayload(key, dynamic, nowMs)) {
      DynamicVerdict.ok => null,
      DynamicVerdict.expired => (ScanVerdict.qrExpired, 'Es una captura o un QR viejo. Pídele que abra su entrada: el QR cambia cada $stepSeconds segundos.'),
      DynamicVerdict.invalid => (ScanVerdict.invalid, 'La prueba del QR no corresponde a esta entrada.'),
    };
  }
  if (otp != null) {
    if (!ticket.qrDynamic) return null; // el número sobra: es una entrada estática escrita a mano
    final key = await tickets.keyFor(meta.sessionId, ticket.code);
    if (key == null) return (ScanVerdict.invalid, 'Falta la llave de esta entrada. Actualiza los datos con internet.');
    return verifyDynamicOtp(key, ticket.code, otp.otp, nowMs) ? null : (ScanVerdict.invalid, 'El número de 6 dígitos no es el vigente.');
  }
  if (ticket.qrDynamic) {
    return (ScanVerdict.staticNotAllowed, 'Esta entrada es de QR dinámico: pídele que abra su entrada en el celular.');
  }
  return null;
}
