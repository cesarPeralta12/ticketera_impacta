/// Número de serie (UID) de una tarjeta o manilla NFC. La app de canje lo vincula a una entrada y la de puerta lo busca.
///
/// La regla de normalización es la misma del servidor (packages/core/src/nfc-uid.ts): los casos de nfc-uid.cases.json
/// los prueban los dos. No es una clave secreta: una tarjeta de fábrica no lo deja cambiar, pero existen tarjetas
/// «mágicas» que lo copian; por eso cada entrada vale una sola vez y cada paso queda registrado.
library;

import 'package:flutter/foundation.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_android.dart';
import 'package:nfc_manager/nfc_manager_ios.dart';

/// Largos válidos en bytes: 4 (ISO 14443 corto), 7 (Mifare Ultralight, NTAG), 8 (ISO 15693) y 10.
const _validBytes = {4, 7, 8, 10};

/// Hexadecimal en mayúsculas y sin separadores, o null si no sirve como identificador: largo raro, no hexadecimal, todo
/// ceros o unos, o un UID aleatorio (4 bytes que empiezan en 08: lo emiten teléfonos y tarjetas virtuales y cambia en cada
/// lectura).
String? normalizeNfcUid(String raw) {
  final hex = raw.replaceAll(RegExp(r'[\s:.\-]'), '').toUpperCase();
  if (hex.isEmpty || hex.length.isOdd || !RegExp(r'^[0-9A-F]+$').hasMatch(hex)) return null;
  final bytes = hex.length ~/ 2;
  if (!_validBytes.contains(bytes)) return null;
  if (RegExp(r'^0+$').hasMatch(hex) || RegExp(r'^F+$').hasMatch(hex)) return null;
  if (bytes == 4 && hex.startsWith('08')) return null;
  return hex;
}

String hexOf(List<int> bytes) => [for (final b in bytes) b.toRadixString(16).padLeft(2, '0').toUpperCase()].join();

/// Bytes del número de serie según la plataforma, o null si la etiqueta no lo da.
Uint8List? uidBytesOf(NfcTag tag) {
  try {
    if (defaultTargetPlatform == TargetPlatform.android) return NfcTagAndroid.from(tag)?.id;
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      return MiFareIos.from(tag)?.identifier ??
          Iso15693Ios.from(tag)?.identifier ??
          Iso7816Ios.from(tag)?.identifier ??
          FeliCaIos.from(tag)?.currentIDm;
    }
  } catch (_) {
    // Una etiqueta de otra tecnología: no hay número de serie que leer.
  }
  return null;
}

/// Número de serie normalizado de la tarjeta, o null si no se pudo leer o no identifica (ver [normalizeNfcUid]).
String? uidOf(NfcTag tag) {
  final bytes = uidBytesOf(tag);
  return bytes == null ? null : normalizeNfcUid(hexOf(bytes));
}
