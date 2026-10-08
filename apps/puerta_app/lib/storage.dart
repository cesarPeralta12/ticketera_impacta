/// Almacenamiento del teléfono: la sesión (cifrada) y la lista de entradas descargada (SQLite).
library;

import 'dart:convert';
import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import 'models.dart';
import 'validator.dart';

/// Sesión del portero: servidor, token del teléfono y datos para mostrar. Todo en almacenamiento cifrado.
class SessionStore {
  SessionStore([FlutterSecureStorage? storage]) : _s = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _s;

  Future<String?> get token => _s.read(key: 'token');
  Future<String?> get serverUrl => _s.read(key: 'server');
  Future<String?> get email => _s.read(key: 'email');
  Future<String?> get name => _s.read(key: 'name');

  Future<void> save({required String server, required String token, required String email, required String name}) async {
    await _s.write(key: 'server', value: server);
    await _s.write(key: 'token', value: token);
    await _s.write(key: 'email', value: email);
    await _s.write(key: 'name', value: name);
  }

  Future<void> saveServer(String server) => _s.write(key: 'server', value: server);

  /// Cierra la sesión pero recuerda el servidor y el email para el próximo ingreso.
  Future<void> clearSession() async {
    await _s.delete(key: 'token');
    await _s.delete(key: 'name');
  }

  /// Identificador estable de este teléfono (el panel lo muestra y lo puede revocar).
  Future<String> get deviceId async {
    final existing = await _s.read(key: 'deviceId');
    if (existing != null) return existing;
    final rnd = Random.secure();
    final id = List.generate(16, (_) => rnd.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
    await _s.write(key: 'deviceId', value: id);
    return id;
  }
}

/// Base local: entradas de las funciones descargadas y lecturas pendientes de subir.
class DoorDb implements TicketLookup {
  DoorDb._(this._db);

  final Database _db;

  static Future<DoorDb> open() async {
    final db = await openDatabase(
      p.join(await getDatabasesPath(), 'puerta.db'),
      version: 2,
      onUpgrade: (db, oldVersion, _) async {
        if (oldVersion < 2) await db.execute('ALTER TABLE tickets ADD COLUMN document TEXT');
      },
      onCreate: (db, _) async {
        await db.execute('''
          CREATE TABLE tickets (
            session_id TEXT NOT NULL, code TEXT NOT NULL, status TEXT NOT NULL, section_id TEXT,
            mine INTEGER NOT NULL, holder TEXT, document TEXT, type TEXT, seat TEXT, methods TEXT NOT NULL DEFAULT '',
            used_at INTEGER, PRIMARY KEY (session_id, code)
          )''');
        await db.execute('''
          CREATE TABLE scans (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL, gate_id TEXT, code TEXT, raw TEXT NOT NULL,
            method TEXT NOT NULL, scanned_at INTEGER NOT NULL, verdict TEXT NOT NULL,
            synced INTEGER NOT NULL DEFAULT 0, server_result TEXT
          )''');
        await db.execute('CREATE INDEX scans_pending ON scans (synced, scanned_at)');
        await db.execute('CREATE TABLE meta (session_id TEXT PRIMARY KEY, json TEXT NOT NULL)');
      },
    );
    return DoorDb._(db);
  }

  static Map<String, Object?> _row(String sessionId, TicketRow t) => {
        'session_id': sessionId,
        'code': t.code,
        'status': t.status.code,
        'section_id': t.sectionId,
        'mine': t.mine ? 1 : 0,
        'holder': t.holder,
        'document': t.document,
        'type': t.type,
        'seat': t.seat,
        'methods': t.methods.join(','),
        'used_at': t.usedAt?.millisecondsSinceEpoch,
      };

  static TicketRow _fromRow(Map<String, Object?> r) => TicketRow(
        code: r['code'] as String,
        status: TicketStatus.fromCode(r['status'] as String),
        sectionId: r['section_id'] as String?,
        mine: (r['mine'] as int) == 1,
        holder: r['holder'] as String?,
        document: r['document'] as String?,
        type: r['type'] as String?,
        seat: r['seat'] as String?,
        methods: (r['methods'] as String).isEmpty ? const [] : (r['methods'] as String).split(','),
        usedAt: r['used_at'] == null ? null : DateTime.fromMillisecondsSinceEpoch(r['used_at'] as int),
      );

  // ── Datos sueltos (por ejemplo, la última lista de funciones, para abrir la app sin internet) ──

  Future<String?> getKv(String key) async {
    final rows = await _db.query('meta', where: 'session_id = ?', whereArgs: ['_kv_$key']);
    return rows.isEmpty ? null : rows.first['json'] as String;
  }

  Future<void> putKv(String key, String json) =>
      _db.insert('meta', {'session_id': '_kv_$key', 'json': json}, conflictAlgorithm: ConflictAlgorithm.replace);

  // ── Funciones descargadas ──

  Future<SessionMeta?> meta(String sessionId) async {
    final rows = await _db.query('meta', where: 'session_id = ?', whereArgs: [sessionId]);
    if (rows.isEmpty) return null;
    return SessionMeta.fromJson(jsonDecode(rows.first['json'] as String) as Map<String, dynamic>);
  }

  Future<void> _putMeta(DatabaseExecutor db, SessionMeta meta) =>
      db.insert('meta', {'session_id': meta.sessionId, 'json': jsonEncode(meta.toJson())}, conflictAlgorithm: ConflictAlgorithm.replace);

  /// Descarga completa: reemplaza la lista de la función. Las lecturas pendientes se conservan
  /// y se vuelven a aplicar, para que una entrada ya leída aquí no vuelva a figurar como válida.
  Future<void> saveFull(DownloadResult data) async {
    await _db.transaction((txn) async {
      await txn.delete('tickets', where: 'session_id = ?', whereArgs: [data.meta.sessionId]);
      await _insertTickets(txn, data.meta.sessionId, data.tickets);
      await _reapplyPending(txn, data.meta.sessionId);
      await _putMeta(txn, data.meta.copyWithCount(await _count(txn, data.meta.sessionId)));
    });
  }

  /// Solo los cambios desde la última descarga (ventas nuevas, entradas usadas o anuladas en otros lados).
  Future<void> applyDelta(DownloadResult data) async {
    await _db.transaction((txn) async {
      // Entradas transferidas: el código viejo deja de valer y el nuevo llega en la lista de cambios.
      for (final code in data.revoked) {
        await txn.delete('tickets', where: 'session_id = ? AND code = ?', whereArgs: [data.meta.sessionId, code]);
      }
      await _insertTickets(txn, data.meta.sessionId, data.tickets);
      await _reapplyPending(txn, data.meta.sessionId);
      await _putMeta(txn, data.meta.copyWithCount(await _count(txn, data.meta.sessionId)));
    });
  }

  Future<int> _count(DatabaseExecutor db, String sessionId) async =>
      Sqflite.firstIntValue(await db.rawQuery('SELECT COUNT(*) FROM tickets WHERE session_id = ?', [sessionId])) ?? 0;

  Future<void> _insertTickets(DatabaseExecutor db, String sessionId, List<TicketRow> tickets) async {
    const chunk = 1000;
    for (var i = 0; i < tickets.length; i += chunk) {
      final batch = db.batch();
      for (final t in tickets.skip(i).take(chunk)) {
        batch.insert('tickets', _row(sessionId, t), conflictAlgorithm: ConflictAlgorithm.replace);
      }
      await batch.commit(noResult: true);
    }
  }

  /// Una lectura aceptada aquí y aún sin subir manda sobre lo que diga la descarga.
  Future<void> _reapplyPending(DatabaseExecutor db, String sessionId) => db.rawUpdate('''
    UPDATE tickets SET status = 'U',
      used_at = (SELECT MIN(scanned_at) FROM scans s WHERE s.session_id = tickets.session_id AND s.code = tickets.code AND s.verdict = 'ACCEPTED')
    WHERE session_id = ? AND status = 'V' AND EXISTS (
      SELECT 1 FROM scans s WHERE s.session_id = tickets.session_id AND s.code = tickets.code AND s.verdict = 'ACCEPTED')''', [sessionId]);

  @override
  Future<TicketRow?> find(String sessionId, String code) async {
    final rows = await _db.query('tickets', where: 'session_id = ? AND code = ?', whereArgs: [sessionId, code]);
    return rows.isEmpty ? null : _fromRow(rows.first);
  }

  Future<void> markUsed(String sessionId, String code, DateTime at) => _db.update(
        'tickets',
        {'status': TicketStatus.used.code, 'used_at': at.millisecondsSinceEpoch},
        where: 'session_id = ? AND code = ?',
        whereArgs: [sessionId, code],
      );

  Future<void> upsertTicket(String sessionId, TicketRow t) =>
      _db.insert('tickets', _row(sessionId, t), conflictAlgorithm: ConflictAlgorithm.replace);

  // ── Lecturas ──

  Future<void> addScan(PendingScan scan, {String? code}) => _db.insert('scans', {
        'id': scan.id,
        'session_id': scan.sessionId,
        'gate_id': scan.gateId,
        'code': code,
        'raw': scan.raw,
        'method': scan.method,
        'scanned_at': scan.scannedAt.millisecondsSinceEpoch,
        'verdict': scan.verdict.api,
      });

  Future<List<PendingScan>> pending(String sessionId, {int limit = 200}) async {
    final rows = await _db.query(
      'scans',
      where: 'session_id = ? AND synced = 0',
      whereArgs: [sessionId],
      orderBy: 'scanned_at ASC',
      limit: limit,
    );
    return [
      for (final r in rows)
        PendingScan(
          id: r['id'] as String,
          sessionId: r['session_id'] as String,
          gateId: r['gate_id'] as String?,
          raw: r['raw'] as String,
          method: r['method'] as String,
          scannedAt: DateTime.fromMillisecondsSinceEpoch(r['scanned_at'] as int, isUtc: true),
          verdict: ScanVerdict.values.firstWhere((v) => v.api == r['verdict'], orElse: () => ScanVerdict.invalid),
        ),
    ];
  }

  Future<void> markSynced(Map<String, String> serverResultById) async {
    final batch = _db.batch();
    serverResultById.forEach((id, result) {
      batch.update('scans', {'synced': 1, 'server_result': result}, where: 'id = ?', whereArgs: [id]);
    });
    await batch.commit(noResult: true);
  }

  Future<int> pendingCount(String sessionId) async =>
      Sqflite.firstIntValue(await _db.rawQuery('SELECT COUNT(*) FROM scans WHERE session_id = ? AND synced = 0', [sessionId])) ?? 0;

  /// Entradas aceptadas aquí que el servidor ya tenía como usadas (doble ingreso entre lectores sin conexión).
  Future<int> conflictCount(String sessionId) async =>
      Sqflite.firstIntValue(await _db.rawQuery(
        "SELECT COUNT(*) FROM scans WHERE session_id = ? AND verdict = 'ACCEPTED' AND synced = 1 AND server_result IS NOT NULL AND server_result != 'ACCEPTED'",
        [sessionId],
      )) ??
      0;

  /// Entradas de esta puerta: cuántas hay y cuántas ya entraron.
  Future<({int total, int used})> gateCounts(String sessionId) async {
    final total = Sqflite.firstIntValue(await _db.rawQuery(
          "SELECT COUNT(*) FROM tickets WHERE session_id = ? AND mine = 1 AND status != 'C'",
          [sessionId],
        )) ??
        0;
    final used = Sqflite.firstIntValue(await _db.rawQuery(
          "SELECT COUNT(*) FROM tickets WHERE session_id = ? AND mine = 1 AND status = 'U'",
          [sessionId],
        )) ??
        0;
    return (total: total, used: used);
  }

  /// Borra todo lo descargado (al cerrar sesión o terminar el evento).
  Future<void> clearAll() async {
    await _db.delete('tickets');
    await _db.delete('scans');
    await _db.delete('meta');
  }
}

extension on SessionMeta {
  SessionMeta copyWithCount(int count) => SessionMeta(
        sessionId: sessionId,
        title: title,
        gateId: gateId,
        gates: gates,
        sections: sections,
        syncedAt: syncedAt,
        ticketCount: count,
      );
}
