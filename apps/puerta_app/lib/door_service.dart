/// Lógica de la app: sesión, descarga, validación local, cola de lecturas y sincronización.
library;

import 'dart:convert';
import 'dart:math';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';

import 'api.dart';
import 'models.dart';
import 'storage.dart';
import 'validator.dart';

const defaultServerUrl = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:3001');

String _scanId() {
  final rnd = Random.secure();
  return List.generate(16, (_) => rnd.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
}

class DoorService extends ChangeNotifier {
  DoorService({required this.sessionStore, required this.db});

  final SessionStore sessionStore;
  final DoorDb db;

  ApiClient? _api;
  String? staffName;
  String serverUrl = defaultServerUrl;

  /// Funciones del portero (las del servidor, o las últimas conocidas si no hay internet).
  List<Assignment> assignments = const [];

  bool get loggedIn => _api?.token != null;

  /// Cuántas lecturas esperan subirse (para mostrarlo en pantalla).
  int pendingCount = 0;
  int conflictCount = 0;

  /// Se llama cuando el servidor dice que la sesión ya no vale: la pantalla vuelve al login.
  VoidCallback? onSessionExpired;

  Future<void> restore() async {
    serverUrl = await sessionStore.serverUrl ?? defaultServerUrl;
    final token = await sessionStore.token;
    staffName = await sessionStore.name;
    _api = ApiClient(baseUrl: serverUrl, token: token);
    notifyListeners();
  }

  Future<String> _deviceName() async {
    try {
      final info = DeviceInfoPlugin();
      if (defaultTargetPlatform == TargetPlatform.android) {
        final a = await info.androidInfo;
        return '${a.manufacturer} ${a.model}';
      }
      if (defaultTargetPlatform == TargetPlatform.iOS) return (await info.iosInfo).name;
    } catch (_) {}
    return 'Teléfono';
  }

  Future<void> login({required String server, required String email, required String password}) async {
    final url = server.trim().isEmpty ? defaultServerUrl : server.trim();
    final api = ApiClient(baseUrl: url);
    final result = await api.login(
      email: email.trim(),
      password: password,
      deviceId: await sessionStore.deviceId,
      deviceName: await _deviceName(),
    );
    await sessionStore.save(server: url, token: result.token, email: email.trim(), name: result.name);
    serverUrl = url;
    staffName = result.name;
    _api = ApiClient(baseUrl: url, token: result.token);
    notifyListeners();
  }

  /// Cierra la sesión. Se borran las entradas descargadas: no deben quedar en un teléfono sin sesión.
  Future<void> logout() async {
    await _api?.logout();
    await sessionStore.clearSession();
    await db.clearAll();
    _api = ApiClient(baseUrl: serverUrl);
    assignments = const [];
    pendingCount = 0;
    notifyListeners();
  }

  Future<T> _guard<T>(Future<T> Function(ApiClient api) call) async {
    final api = _api;
    if (api == null || api.token == null) throw const ApiException('Inicia sesión.', status: 401);
    try {
      return await call(api);
    } on ApiException catch (e) {
      if (e.unauthorized) {
        await sessionStore.clearSession();
        _api = ApiClient(baseUrl: serverUrl);
        onSessionExpired?.call();
        notifyListeners();
      }
      rethrow;
    }
  }

  /// Funciones asignadas. Sin internet, usa la última lista guardada.
  Future<void> loadAssignments() async {
    try {
      assignments = await _guard((api) => api.assignments());
      await db.putKv('assignments', jsonEncode([for (final a in assignments) a.toJson()]));
    } on ApiException catch (e) {
      if (!e.offline) rethrow;
      final cached = await db.getKv('assignments');
      if (cached == null) rethrow;
      assignments = [for (final a in jsonDecode(cached) as List) Assignment.fromJson(a as Map<String, dynamic>)];
    }
    notifyListeners();
  }

  Future<SessionMeta?> meta(String sessionId) => db.meta(sessionId);

  /// Descarga completa de la función para la puerta elegida (reemplaza lo descargado antes).
  Future<SessionMeta> download(Assignment a, Gate? gate) async {
    final data = await _guard((api) => api.download(a.sessionId, gateId: gate?.id));
    await db.saveFull(data);
    await refreshCounters(a.sessionId);
    return (await db.meta(a.sessionId))!;
  }

  /// Sube lo pendiente y baja los cambios. Sin internet no hace nada (se reintenta luego).
  /// Devuelve false si no se pudo llegar al servidor.
  Future<bool> sync(String sessionId) async {
    final meta = await db.meta(sessionId);
    if (meta == null) return true;
    try {
      while (true) {
        final batch = await db.pending(sessionId);
        if (batch.isEmpty) break;
        final results = await _guard((api) => api.postScans(sessionId, [for (final s in batch) s.toApi()]));
        await db.markSynced({for (final r in results) r.id: r.result});
        if (batch.length < 200) break;
      }
      // Solape de unos segundos: mejor repetir un cambio que perderlo.
      final since = DateTime.parse(meta.syncedAt).subtract(const Duration(seconds: 10)).toUtc().toIso8601String();
      final delta = await _guard((api) => api.download(sessionId, gateId: meta.gateId, since: since));
      await db.applyDelta(delta);
      await refreshCounters(sessionId);
      return true;
    } on ApiException catch (e) {
      if (e.offline) {
        await refreshCounters(sessionId);
        return false;
      }
      rethrow;
    }
  }

  Future<void> refreshCounters(String sessionId) async {
    pendingCount = await db.pendingCount(sessionId);
    conflictCount = await db.conflictCount(sessionId);
    notifyListeners();
  }

  Future<({int total, int used})> gateCounts(String sessionId) => db.gateCounts(sessionId);

  /// Valida una lectura en el teléfono y la deja guardada para subirla.
  ///
  /// Si el código no está en la lista descargada y hay internet, le pregunta al servidor:
  /// puede ser una entrada vendida después de la descarga.
  Future<ScanOutcome> scan(SessionMeta meta, String raw, AccessMethod? method) async {
    var outcome = await validateScan(tickets: db, meta: meta, raw: raw, method: method);
    final code = extractTicketCode(raw);
    final id = _scanId();
    final now = DateTime.now();
    final methodApi = scanMethodApi(method);

    if (outcome.verdict == ScanVerdict.notFound) {
      final live = await _askServer(meta, id, raw, methodApi, now);
      if (live != null) outcome = live;
    }

    final scan = PendingScan(
      id: id,
      sessionId: meta.sessionId,
      gateId: meta.gateId,
      raw: raw,
      method: methodApi,
      scannedAt: now,
      verdict: outcome.verdict,
    );
    if (outcome.verdict.ok && code != null) {
      await db.markUsed(meta.sessionId, code, now);
    }
    // Lo confirmado en vivo por el servidor ya quedó registrado allá: no se vuelve a subir.
    if (!_confirmedLive.remove(id)) {
      await db.addScan(scan, code: code);
    } else if (outcome.verdict.ok && outcome.ticket != null) {
      await db.upsertTicket(meta.sessionId, outcome.ticket!.copyWith(status: TicketStatus.used, usedAt: now));
    }
    await refreshCounters(meta.sessionId);
    return outcome;
  }

  final Set<String> _confirmedLive = {};

  Future<ScanOutcome?> _askServer(SessionMeta meta, String id, String raw, String method, DateTime at) async {
    try {
      final results = await _guard(
        (api) => api.postScans(meta.sessionId, [
          {
            'id': id,
            'raw': raw,
            'method': method,
            'scannedAt': at.toUtc().toIso8601String(),
            'offline': false,
            'accessPointId': ?meta.gateId,
          },
        ]),
      );
      final r = results.first;
      _confirmedLive.add(id);
      final verdict = ScanVerdict.values.firstWhere((v) => v.api == r.result, orElse: () => ScanVerdict.invalid);
      return ScanOutcome(
        verdict: verdict,
        ticket: r.ticket,
        detail: verdict.ok ? null : 'Confirmado por el servidor.',
      );
    } on ApiException {
      return null; // sin internet: se queda el "no existe" local
    }
  }
}
