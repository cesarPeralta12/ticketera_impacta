/// Lectura de entradas por NFC: el código viaja en un mensaje NDEF (texto o enlace) de la pulsera o tarjeta.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:nfc_manager/ndef_record.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager_ndef/nfc_manager_ndef.dart';

import 'validator.dart';

/// Texto de un registro NDEF: registros de texto (T), de enlace (U) o datos sueltos.
String? ndefRecordText(NdefRecord record) {
  final payload = record.payload;
  if (payload.isEmpty) return null;
  final type = String.fromCharCodes(record.type);
  try {
    if (record.typeNameFormat == TypeNameFormat.wellKnown && type == 'T') {
      final langLength = payload[0] & 0x3F;
      return utf8.decode(Uint8List.sublistView(payload, 1 + langLength));
    }
    if (record.typeNameFormat == TypeNameFormat.wellKnown && type == 'U') {
      return utf8.decode(Uint8List.sublistView(payload, 1)); // el prefijo del enlace no importa
    }
    return utf8.decode(payload, allowMalformed: true);
  } catch (_) {
    return null;
  }
}

/// Código de entrada dentro de una etiqueta NFC, o null si no tiene uno (etiqueta ajena o vacía).
String? codeFromTag(NfcTag tag) {
  final message = Ndef.from(tag)?.cachedMessage;
  if (message == null) return null;
  for (final record in message.records) {
    final text = ndefRecordText(record);
    final code = text == null ? null : extractCodeFromNfcText(text);
    if (code != null) return code;
  }
  return null;
}
