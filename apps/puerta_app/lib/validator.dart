/// Validación de una entrada en el teléfono, sin internet. Lógica pura (sin Flutter ni base de datos)
/// para poder probarla: refleja las reglas de `scanTicket` del servidor.
library;

import 'models.dart';

/// Alfabeto de los códigos de entrada (sin 0/O, 1/I/L), igual que el servidor.
const _alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const codeLength = 10;

bool isValidCode(String code) =>
    code.length == codeLength && code.split('').every(_alphabet.contains);

String _clean(String s) => s.replaceAll('-', '').toUpperCase();

/// Código de entrada a partir de lo leído: el QR completo `TK1.<código>.<firma>`, el código de barras
/// (el código a secas) o lo escrito a mano (con o sin guion). null si no parece una entrada.
///
/// No verifica la firma: el teléfono no lleva el secreto. Valida que el código exista en la lista
/// descargada (son aleatorios, no se pueden adivinar).
String? extractTicketCode(String raw) {
  final input = raw.trim();
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
  final qr = RegExp(r'TK1\.[A-Za-z0-9]{10}\.[A-Za-z0-9_-]+').firstMatch(text);
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
}

String _hhmm(DateTime t) {
  final l = t.toLocal();
  return '${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
}

/// Decide qué pasa con una lectura, en este orden (como el servidor):
/// ¿es un código válido? ¿existe? ¿es de otra puerta? ¿se puede leer con este método?
/// ¿está anulada? ¿ya entró?
Future<ScanOutcome> validateScan({
  required TicketLookup tickets,
  required SessionMeta meta,
  required String raw,
  required AccessMethod? method,
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
