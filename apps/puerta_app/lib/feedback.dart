/// Sonido y vibración de la app: cada resultado suena y vibra distinto, para que el portero lo sepa sin mirar.
library;

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/services.dart';

import 'models.dart';
import 'settings.dart';

/// Los sonidos están en assets/sounds (sintetizados para la app). Cada uno es corto y de baja latencia.
enum Sfx {
  scan('scan'),
  ok('ok'),
  reentry('reentry'),
  exit('exit'),
  zone('zone'),
  warn('warn'),
  error('error'),
  done('done');

  const Sfx(this.file);
  final String file;
}

class DoorFeedback {
  DoorFeedback(this.settings);

  /// Sin sonido ni vibración (pruebas).
  DoorFeedback.silent() : settings = AppSettings.memory(sound: false, haptics: false);

  final AppSettings settings;
  final Map<Sfx, AudioPlayer> _players = {};
  bool _ready = false;

  Future<void> _init() async {
    if (_ready) return;
    _ready = true;
    try {
      // Que el sonido de la puerta no corte la música ni otras apps de audio.
      await AudioPlayer.global.setAudioContext(
        AudioContextConfig(focus: AudioContextConfigFocus.mixWithOthers, route: AudioContextConfigRoute.speaker).build(),
      );
    } catch (_) {}
  }

  Future<void> play(Sfx sfx) async {
    if (!settings.sound) return;
    try {
      await _init();
      final player = _players.putIfAbsent(sfx, () => AudioPlayer()..setPlayerMode(PlayerMode.lowLatency));
      await player.stop();
      await player.play(AssetSource('sounds/${sfx.file}.wav'));
    } catch (_) {
      // Sin audio disponible (o en pruebas): la app sigue igual.
    }
  }

  void _haptic(Future<void> Function() fn) {
    if (settings.haptics) fn();
  }

  /// Se detectó un código (antes de decidir qué hacer con él).
  void detected() {
    play(Sfx.scan);
    _haptic(HapticFeedback.selectionClick);
  }

  /// Resultado de una lectura: sonido y vibración según lo que pasó.
  void outcome(ScanOutcome o) {
    if (o.verdict.ok) {
      switch (o.movement ?? Movement.entry) {
        case Movement.entry:
          play(Sfx.ok);
          _haptic(HapticFeedback.mediumImpact);
        case Movement.reentry:
          play(Sfx.reentry);
          _haptic(HapticFeedback.mediumImpact);
        case Movement.exit:
          play(Sfx.exit);
          _haptic(HapticFeedback.lightImpact);
        case Movement.zoneChange:
          play(Sfx.zone);
          _haptic(HapticFeedback.mediumImpact);
      }
    } else if (o.verdict.isWarning) {
      play(Sfx.warn);
      _haptic(() async {
        await HapticFeedback.heavyImpact();
        await Future<void>.delayed(const Duration(milliseconds: 140));
        await HapticFeedback.heavyImpact();
      });
    } else {
      play(Sfx.error);
      _haptic(HapticFeedback.vibrate);
    }
  }

  /// Un error de pantalla (contraseña mal puesta).
  void fail() {
    play(Sfx.error);
    _haptic(HapticFeedback.vibrate);
  }

  /// Una acción que salió bien (pulsera grabada, datos descargados).
  void done() {
    play(Sfx.done);
    _haptic(HapticFeedback.lightImpact);
  }

  void tap() => _haptic(HapticFeedback.selectionClick);

  Future<void> dispose() async {
    for (final p in _players.values) {
      await p.dispose();
    }
    _players.clear();
  }
}
