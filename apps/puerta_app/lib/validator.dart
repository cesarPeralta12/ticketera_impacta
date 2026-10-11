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

  switch (ticket.status) {
    case TicketStatus.cancelled:
      return ScanOutcome(verdict: ScanVerdict.cancelled, ticket: ticket);
    case TicketStatus.used:
      final at = ticket.usedAt;
      return ScanOutcome(
        verdict: ScanVerdict.alreadyUsed,
        ticket: ticket,
        detail: at == null ? 'Ya ingresó antes.' : 'Ingresó a las ${_hhmm(at)}',
      );
    case TicketStatus.valid:
      return ScanOutcome(verdict: ScanVerdict.accepted, ticket: ticket);
  }
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
