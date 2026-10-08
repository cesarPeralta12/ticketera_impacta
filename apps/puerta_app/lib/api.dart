/// Cliente de la API de puerta (`/api/v1`) del panel de Impacta.
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'models.dart';

/// Error de la API con un mensaje que se puede mostrar al portero.
class ApiException implements Exception {
  const ApiException(this.message, {this.status, this.offline = false, this.code});

  final String message;
  final int? status;

  /// Código de la API, por ejemplo PASSWORD_CHANGE_REQUIRED.
  final String? code;

  bool get passwordChangeRequired => code == 'PASSWORD_CHANGE_REQUIRED';

  /// No se pudo llegar al servidor (sin internet, servidor caído).
  final bool offline;

  /// La sesión del teléfono ya no es válida: hay que volver a iniciar sesión.
  bool get unauthorized => status == 401;

  @override
  String toString() => message;
}

class LoginResult {
  const LoginResult({required this.token, required this.name, required this.role, this.mustChangePassword = false});

  final String token;
  final String name;
  final String role;

  /// Cuenta con contraseña temporal: debe cambiarla antes de usar la app.
  final bool mustChangePassword;
}

/// Resultado oficial de una lectura subida al servidor.
class ServerScanResult {
  const ServerScanResult({required this.id, required this.result, this.ticket});

  final String id;
  final String result;
  final TicketRow? ticket;
}

/// Decodifica la lista de entradas fuera del hilo de la interfaz (pueden ser decenas de miles).
DownloadResult _parseDownload(String body) => DownloadResult.fromJson(jsonDecode(body) as Map<String, dynamic>);

class ApiClient {
  ApiClient({required this.baseUrl, this.token, http.Client? client}) : _http = client ?? http.Client();

  final String baseUrl;
  final String? token;
  final http.Client _http;

  Uri _uri(String path, [Map<String, String>? query]) {
    final base = baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl;
    return Uri.parse('$base/api/v1$path').replace(queryParameters: query);
  }

  Map<String, String> get _headers => {
        'content-type': 'application/json',
        if (token != null) 'authorization': 'Bearer $token',
      };

  Future<http.Response> _send(Future<http.Response> Function() request, {Duration timeout = const Duration(seconds: 20)}) async {
    try {
      final response = await request().timeout(timeout);
      if (response.statusCode >= 400) {
        String message = 'Error del servidor (${response.statusCode}).';
        String? code;
        try {
          final body = jsonDecode(utf8.decode(response.bodyBytes));
          if (body is Map && body['error'] is String) message = body['error'] as String;
          if (body is Map && body['code'] is String) code = body['code'] as String;
        } catch (_) {}
        throw ApiException(message, status: response.statusCode, code: code);
      }
      return response;
    } on TimeoutException {
      throw const ApiException('El servidor no responde.', offline: true);
    } on http.ClientException {
      throw const ApiException('Sin conexión con el servidor.', offline: true);
    }
  }

  Future<LoginResult> login({
    required String email,
    required String password,
    required String deviceId,
    required String deviceName,
  }) async {
    final response = await _send(
      () => _http.post(
        _uri('/auth/login'),
        headers: _headers,
        body: jsonEncode({'email': email, 'password': password, 'deviceId': deviceId, 'deviceName': deviceName}),
      ),
    );
    final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    final staff = body['staff'] as Map<String, dynamic>;
    return LoginResult(
      token: body['token'] as String,
      name: staff['name'] as String,
      role: staff['role'] as String,
      mustChangePassword: staff['mustChangePassword'] as bool? ?? false,
    );
  }

  Future<void> changePassword({required String current, required String next}) async {
    await _send(() => _http.post(_uri('/auth/password'), headers: _headers, body: jsonEncode({'current': current, 'next': next})));
  }

  Future<void> logout() async {
    try {
      await _send(() => _http.post(_uri('/auth/logout'), headers: _headers), timeout: const Duration(seconds: 5));
    } on ApiException {
      // Si no hay red, igual se cierra la sesión en el teléfono.
    }
  }

  Future<List<Assignment>> assignments() async {
    final response = await _send(() => _http.get(_uri('/assignments'), headers: _headers));
    final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    return [for (final s in body['sessions'] as List) Assignment.fromJson(s as Map<String, dynamic>)];
  }

  /// Lista de entradas de la función para validar sin internet. Con `since`, solo los cambios.
  Future<DownloadResult> download(String sessionId, {String? gateId, String? since}) async {
    final response = await _send(
      () => _http.get(
        _uri('/sessions/$sessionId/download', {
          'gate': ?gateId,
          'since': ?since,
        }),
        headers: _headers,
      ),
      timeout: const Duration(minutes: 2),
    );
    return compute(_parseDownload, utf8.decode(response.bodyBytes));
  }

  /// Sube lecturas. `offline: true` = ya las decidió el teléfono; `false` = el servidor decide en el momento.
  Future<List<ServerScanResult>> postScans(String sessionId, List<Map<String, dynamic>> scans) async {
    final response = await _send(
      () => _http.post(_uri('/scans'), headers: _headers, body: jsonEncode({'sessionId': sessionId, 'scans': scans})),
    );
    final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    return [
      for (final r in body['results'] as List)
        ServerScanResult(
          id: (r as Map<String, dynamic>)['id'] as String,
          result: r['result'] as String,
          ticket: r['ticket'] == null
              ? null
              : TicketRow(
                  code: (r['ticket'] as Map<String, dynamic>)['code'] as String,
                  status: TicketStatus.used,
                  sectionId: null,
                  mine: true,
                  holder: r['ticket']['holderName'] as String?,
                  type: r['ticket']['ticketType'] as String?,
                  seat: r['ticket']['seat'] as String?,
                ),
        ),
    ];
  }
}
