/// Grabado de pulseras y tarjetas NFC: escribe el código de la entrada como un registro NDEF de texto, que es lo
/// que la lectura (nfc_reader.dart) entiende. Lo que se graba es SOLO el código (10 caracteres): la entrada vale
/// o no según la lista del servidor; la pulsera no guarda nada más.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:nfc_manager/ndef_record.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager_ndef/nfc_manager_ndef.dart';

import 'nfc_reader.dart' show ndefRecordText;
import 'validator.dart';

/// El texto que se graba: el código sin guion y en mayúsculas, o null si no es un código de entrada.
String? braceletText(String code) {
  final clean = code.replaceAll('-', '').toUpperCase();
  return isValidCode(clean) ? clean : null;
}

/// Registro NDEF de texto (tipo "T"): byte de estado (idioma) + idioma + texto en UTF-8.
NdefRecord textRecord(String text, {String language = 'es'}) {
  final lang = utf8.encode(language);
  return NdefRecord(
    typeNameFormat: TypeNameFormat.wellKnown,
    type: Uint8List.fromList([0x54]), // 'T'
    identifier: Uint8List(0),
    payload: Uint8List.fromList([lang.length, ...lang, ...utf8.encode(text)]),
  );
}

/// El mensaje completo de una pulsera: un único registro de texto con el código.
NdefMessage braceletMessage(String code) {
  final text = braceletText(code);
  if (text == null) throw ArgumentError('No es un código de entrada: $code');
  return NdefMessage(records: [textRecord(text)]);
}

/// Bytes que ocupa el mensaje (una etiqueta NTAG213 tiene 144; este usa menos de 30).
int messageBytes(NdefMessage message) => message.records.fold(0, (sum, r) => sum + r.byteLength);

/// ¿Este mensaje (leído de una etiqueta) contiene el código esperado?
bool messageHasCode(NdefMessage? message, String code) {
  final expected = braceletText(code);
  if (message == null || expected == null) return false;
  for (final record in message.records) {
    final text = ndefRecordText(record);
    if (text != null && extractTicketCode(text) == expected) return true;
  }
  return false;
}

enum BraceletResult {
  /// Grabada y comprobada leyéndola de nuevo.
  written,

  /// La etiqueta no es NDEF (otra tecnología o virgen sin formato).
  notNdef,

  /// La etiqueta está bloqueada: no se puede escribir.
  readOnly,

  /// No cabe el código en la etiqueta.
  tooSmall,

  /// Se escribió pero al leerla no coincide: hay que reintentar.
  verifyFailed,

  /// Se alejó la pulsera o falló la escritura.
  failed,
}

extension BraceletResultText on BraceletResult {
  bool get ok => this == BraceletResult.written;

  String get message => switch (this) {
        BraceletResult.written => 'Pulsera lista',
        BraceletResult.notNdef => 'Esta etiqueta no es compatible (necesita ser NDEF, por ejemplo NTAG213/215/216).',
        BraceletResult.readOnly => 'Esta pulsera está bloqueada y no se puede escribir.',
        BraceletResult.tooSmall => 'El código no cabe en esta etiqueta.',
        BraceletResult.verifyFailed => 'No se pudo comprobar lo grabado. Acércala de nuevo e inténtalo otra vez.',
        BraceletResult.failed => 'No se pudo escribir. Mantén la pulsera quieta contra el teléfono e inténtalo otra vez.',
      };
}

/// Escribe el código en la etiqueta detectada, lo vuelve a leer para comprobarlo y, si se pide, la bloquea para siempre.
Future<BraceletResult> writeBracelet(NfcTag tag, String code, {bool lock = false}) async {
  final text = braceletText(code);
  if (text == null) return BraceletResult.failed;
  final ndef = Ndef.from(tag);
  if (ndef == null) return BraceletResult.notNdef;
  if (!ndef.isWritable) return BraceletResult.readOnly;
  final message = braceletMessage(text);
  if (messageBytes(message) > ndef.maxSize) return BraceletResult.tooSmall;
  try {
    await ndef.write(message: message);
    final back = await ndef.read();
    if (!messageHasCode(back, text)) return BraceletResult.verifyFailed;
    if (lock) await ndef.writeLock();
    return BraceletResult.written;
  } catch (_) {
    return BraceletResult.failed;
  }
}
