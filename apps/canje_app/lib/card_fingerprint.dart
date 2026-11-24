/// Huella de una tarjeta o manilla NFC tal como la lee el teléfono: su número de serie y lo que se sabe de la etiqueta
/// (tipo, modelo, tecnologías). Es lo que la app de canje sube al servidor; solo el número de serie identifica, lo
/// demás sirve para revisar que la tarjeta sea del modelo esperado.
library;

import 'package:flutter/foundation.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_android.dart';
import 'package:nfc_manager/nfc_manager_ios.dart';

import 'nfc_uid.dart';

class CardFingerprint {
  const CardFingerprint({required this.uid, this.type, this.model, this.tech = const [], this.atqa, this.sak});

  /// Número de serie normalizado (ver nfc_uid.dart).
  final String uid;

  /// «ISO 14443-3A», «ISO 15693»…
  final String? type;

  /// «Mifare Ultralight», «Mifare Classic»… cuando el teléfono lo sabe.
  final String? model;

  /// Tecnologías que ofrece la etiqueta (NfcA, MifareUltralight, Ndef…).
  final List<String> tech;
  final String? atqa;
  final String? sak;

  /// El JSON que se sube al servidor (el servidor lo vuelve a limpiar).
  Map<String, dynamic> toJson() => {
        'uid': uid,
        if (type != null) 'type': type,
        if (model != null) 'model': model,
        if (tech.isNotEmpty) 'tech': tech,
        if (atqa != null) 'atqa': atqa,
        if (sak != null) 'sak': sak,
      };

  /// El número de serie como lo muestran las apps de NFC: «04:7F:8C:52:0F:7A:80».
  String get uidLabel => formatUid(uid);
}

/// «047F8C520F7A80» → «04:7F:8C:52:0F:7A:80».
String formatUid(String uid) => [for (var i = 0; i + 1 < uid.length; i += 2) uid.substring(i, i + 2)].join(':');

/// Tecnología sin el prefijo de Android («android.nfc.tech.NfcA» → «NfcA»).
String shortTech(String name) => name.split('.').last;

/// Tipo de etiqueta a partir de las tecnologías que ofrece (Android).
String? typeFromTech(List<String> tech) {
  if (tech.contains('NfcA')) return 'ISO 14443-3A';
  if (tech.contains('NfcB')) return 'ISO 14443-3B';
  if (tech.contains('NfcV')) return 'ISO 15693';
  if (tech.contains('NfcF')) return 'FeliCa';
  return null;
}

/// Huella de la tarjeta, o null si no tiene un número de serie que identifique (ver [normalizeNfcUid]).
CardFingerprint? fingerprintOf(NfcTag tag) {
  final uid = uidOf(tag);
  if (uid == null) return null;
  try {
    if (defaultTargetPlatform == TargetPlatform.android) {
      final android = NfcTagAndroid.from(tag);
      final tech = [for (final t in android?.techList ?? const <String>[]) shortTech(t)];
      final nfcA = NfcAAndroid.from(tag);
      final ultralight = MifareUltralightAndroid.from(tag);
      final model = switch (ultralight?.type) {
        MifareUltralightTypeAndroid.ultralight => 'Mifare Ultralight',
        MifareUltralightTypeAndroid.ultralightC => 'Mifare Ultralight C',
        _ => tech.contains('MifareClassic') ? 'Mifare Classic' : null,
      };
      return CardFingerprint(
        uid: uid,
        type: typeFromTech(tech),
        model: model,
        tech: tech,
        atqa: nfcA == null ? null : hexOf(nfcA.atqa),
        sak: nfcA == null ? null : hexOf([nfcA.sak]),
      );
    }
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      final mifare = MiFareIos.from(tag);
      if (mifare != null) {
        final model = switch (mifare.mifareFamily) {
          MiFareFamilyIos.ultralight => 'Mifare Ultralight',
          MiFareFamilyIos.plus => 'Mifare Plus',
          MiFareFamilyIos.desfire => 'Mifare DESFire',
          _ => null,
        };
        return CardFingerprint(uid: uid, type: 'ISO 14443-3A', model: model, tech: const ['MiFare']);
      }
      if (Iso15693Ios.from(tag) != null) return CardFingerprint(uid: uid, type: 'ISO 15693', tech: const ['Iso15693']);
      if (Iso7816Ios.from(tag) != null) return CardFingerprint(uid: uid, type: 'ISO 14443-4', tech: const ['Iso7816']);
      if (FeliCaIos.from(tag) != null) return CardFingerprint(uid: uid, type: 'FeliCa', tech: const ['FeliCa']);
    }
  } catch (_) {
    // Lo que no se pudo leer de la etiqueta queda vacío: el número de serie basta para vincularla.
  }
  return CardFingerprint(uid: uid);
}
