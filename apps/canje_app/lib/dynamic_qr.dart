/// QR dinámico: verificación de la prueba en el teléfono, sin internet. Es la misma cuenta que
/// `packages/core/src/dynamic-qr.ts` (el servidor): los vectores de prueba de los dos lados deben coincidir.
///
///   prueba = HMAC-SHA256(llave, "TK2|" + código + "|" + paso)[0..8] en base64url (11 caracteres)
///   QR     = "TK2." + código + "." + paso(base36) + "." + prueba
///   OTP    = 6 dígitos del HMAC con la etiqueta "OTP|" (truncado dinámico, como un TOTP)
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

/// Cada cuántos segundos cambia el QR.
const stepSeconds = 30;

/// Pasos que se aceptan antes y después del actual (relojes desajustados).
const stepWindow = 1;

/// Alfabeto de los códigos de entrada (sin 0/O, 1/I/L), igual que el servidor.
const _alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

bool _validCode(String code) => code.length == 10 && code.split('').every(_alphabet.contains);

/// Paso de tiempo al que pertenece un instante (milisegundos desde 1970).
int stepAt(int timeMs) => timeMs ~/ (stepSeconds * 1000);

List<int> _hmac(List<int> key, String message) => Hmac(sha256, key).convert(utf8.encode(message)).bytes;

String _b64(List<int> bytes) => base64Url.encode(bytes).replaceAll('=', '');

/// Llave de una entrada tal como la manda el servidor (base64url, 16 bytes).
Uint8List keyFromBase64(String text) => Uint8List.fromList(base64Url.decode(base64Url.normalize(text)));

String keyToBase64(List<int> key) => _b64(key);

/// Prueba de un paso (11 caracteres).
String dynamicProof(List<int> key, String code, int step) => _b64(_hmac(key, 'TK2|$code|$step').sublist(0, 8));

/// OTP de 6 dígitos de un paso.
String dynamicOtp(List<int> key, String code, int step) {
  final mac = _hmac(key, 'OTP|$code|$step');
  final offset = mac.last & 0x0f;
  final value = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return (value % 1000000).toString().padLeft(6, '0');
}

/// Contenido del QR dinámico para un instante (lo usan las pruebas y el modo demostración).
String signDynamicPayload(List<int> key, String code, int timeMs) {
  final step = stepAt(timeMs);
  return 'TK2.$code.${step.toRadixString(36)}.${dynamicProof(key, code, step)}';
}

class DynamicPayload {
  const DynamicPayload({required this.code, required this.step, required this.proof});

  final String code;
  final int step;
  final String proof;
}

/// Formato del QR dinámico (no verifica la prueba). null si no es un `TK2` bien formado.
DynamicPayload? parseDynamicPayload(String raw) {
  final parts = raw.trim().split('.');
  if (parts.length != 4 || parts[0] != 'TK2') return null;
  final code = parts[1];
  if (!_validCode(code)) return null;
  if (!RegExp(r'^[0-9a-z]{1,10}$').hasMatch(parts[2]) || !RegExp(r'^[A-Za-z0-9_-]{11}$').hasMatch(parts[3])) return null;
  final step = int.tryParse(parts[2], radix: 36);
  return step == null ? null : DynamicPayload(code: code, step: step, proof: parts[3]);
}

/// "CÓDIGO 123456" escrito a mano (el código con o sin guion). null si no tiene esa forma.
({String code, String otp})? parseManualWithOtp(String raw) {
  final m = RegExp(r'^\s*([A-Za-z0-9-]{10,11})\s+(\d{6})\s*$').firstMatch(raw);
  if (m == null) return null;
  final code = m.group(1)!.replaceAll('-', '').toUpperCase();
  return _validCode(code) ? (code: code, otp: m.group(2)!) : null;
}

enum DynamicVerdict { ok, expired, invalid }

bool _sameText(String a, String b) {
  if (a.length != b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.codeUnitAt(i) ^ b.codeUnitAt(i);
  }
  return diff == 0;
}

/// invalid: la prueba no corresponde a esta entrada. expired: auténtica pero de otro paso (captura vieja).
DynamicVerdict verifyDynamicPayload(List<int> key, DynamicPayload payload, int nowMs, {int window = stepWindow}) {
  if (!_sameText(payload.proof, dynamicProof(key, payload.code, payload.step))) return DynamicVerdict.invalid;
  return (payload.step - stepAt(nowMs)).abs() <= window ? DynamicVerdict.ok : DynamicVerdict.expired;
}

/// El OTP escrito a mano vale si es el de algún paso de la ventana.
bool verifyDynamicOtp(List<int> key, String code, String otp, int nowMs, {int window = stepWindow}) {
  final now = stepAt(nowMs);
  for (var step = now - window; step <= now + window; step++) {
    if (_sameText(otp, dynamicOtp(key, code, step))) return true;
  }
  return false;
}
