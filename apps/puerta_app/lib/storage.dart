/// Almacenamiento del teléfono: la sesión (cifrada) y la lista de entradas descargada (SQLite).
library;

import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import 'dynamic_qr.dart' show keyFromBase64, keyToBase64;
import 'bar.dart';
import 'models.dart';
import 'validator.dart';

/// Sesión del portero: servidor, token del teléfono y datos para mostrar. Todo en almacenamiento cifrado.
class SessionStore {
  SessionStore([FlutterSecureStorage? storage]) : _s = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _s;

  Future<String?> get token => _s.read(key: 'token');
  Future<String?> get refreshToken => _s.read(key: 'refreshToken');
  Future<String?> get serverUrl => _s.read(key: 'server');
  Future<String?> get email => _s.read(key: 'email');
  Future<String?> get name => _s.read(key: 'name');

  /// Rol de la cuenta (OWNER, ADMIN, OPERATOR): decide si ve el grabador de pulseras.
  Future<String?> get role => _s.read(key: 'role');

  Future<void> save({
    required String server,
    required String token,
    required String refreshToken,
    required String email,
    required String name,
    String? role,
  }) async {
    await _s.write(key: 'server', value: server);
    await _s.write(key: 'token', value: token);
    await _s.write(key: 'refreshToken', value: refreshToken);
    await _s.write(key: 'email', value: email);
    await _s.write(key: 'name', value: name);
    if (role != null) await _s.write(key: 'role', value: role);
  }

  /// Guarda el par nuevo tras renovar la sesión.
  Future<void> saveTokens(String token, String refreshToken) async {
    await _s.write(key: 'token', value: token);
    await _s.write(key: 'refreshToken', value: refreshToken);
  }

  Future<void> saveServer(String server) => _s.write(key: 'server', value: server);

  /// Cierra la sesión pero recuerda el servidor y el email para el próximo ingreso.
  Future<void> clearSession() async {
    await _s.delete(key: 'token');
    await _s.delete(key: 'refreshToken');
    await _s.delete(key: 'name');
    await _s.delete(key: 'role');
  }

  /// Clave con la que se cifran las llaves de las entradas dinámicas en la base local. Vive en el almacenamiento
  /// seguro del teléfono (Android Keystore) y se renueva al cerrar sesión: sin ella, lo guardado no sirve.
  Future<Uint8List> get dbKey async {
    final existing = await _s.read(key: 'dbKey');
    if (existing != null) return keyFromBase64(existing);
    return resetDbKey();
  }

  Future<Uint8List> resetDbKey() async {
    final rnd = Random.secure();
    final key = Uint8List.fromList(List.generate(32, (_) => rnd.nextInt(256)));
    await _s.write(key: 'dbKey', value: keyToBase64(key));
    return key;
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
class DoorDb implements TicketLookup, VoucherLookup {
  DoorDb._(this._db, this._key);

  final Database _db;

  /// Clave de cifrado de las llaves del QR dinámico (ver [SessionStore.dbKey]).
  Uint8List _key;

  /// Cambia la clave (al cerrar sesión, después de borrar todo).
  void useKey(Uint8List key) => _key = key;

  static Future<DoorDb> open(Uint8List key) async {
    final db = await openDatabase(
      p.join(await getDatabasesPath(), 'puerta.db'),
      version: 5,
      onUpgrade: (db, oldVersion, _) async {
        if (oldVersion < 2) await db.execute('ALTER TABLE tickets ADD COLUMN document TEXT');
        if (oldVersion < 3) {
          await db.execute('ALTER TABLE tickets ADD COLUMN qr_dynamic INTEGER NOT NULL DEFAULT 0');
          await db.execute('ALTER TABLE tickets ADD COLUMN qr_key TEXT');
        }
        if (oldVersion < 4) {
          // Presencia: adentro o afuera, cuántas veces entró, cuántas puede, qué zonas abre y en cuál quedó.
          await db.execute('ALTER TABLE tickets ADD COLUMN inside INTEGER');
          await db.execute('ALTER TABLE tickets ADD COLUMN entries INTEGER');
          await db.execute('ALTER TABLE tickets ADD COLUMN max_entries INTEGER NOT NULL DEFAULT 1');
          await db.execute("ALTER TABLE tickets ADD COLUMN zone_ids TEXT NOT NULL DEFAULT ''");
          await db.execute('ALTER TABLE tickets ADD COLUMN zone_id TEXT');
          await db.execute('ALTER TABLE scans ADD COLUMN movement TEXT');
          await db.execute('ALTER TABLE scans ADD COLUMN zone_id TEXT');
        }
        if (oldVersion < 5) {
          // Modo Barra: los QR de consumo descargados y las lecturas pendientes de subir.
          await db.execute('''
            CREATE TABLE vouchers (
            session_id TEXT NOT NULL, code TEXT NOT NULL, label TEXT NOT NULL, people INTEGER NOT NULL DEFAULT 1,
            buyer TEXT NOT NULL DEFAULT '', order_code TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'BOB',
            cancelled INTEGER NOT NULL DEFAULT 0, redeemed_at INTEGER, redeemed_by TEXT, note TEXT,
            PRIMARY KEY (session_id, code)
          )''');
          await db.execute('''
            CREATE TABLE voucher_reads (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL, code TEXT NOT NULL, read_at INTEGER NOT NULL, note TEXT,
            synced INTEGER NOT NULL DEFAULT 0, server_result TEXT
          )''');
        }
      },
      onCreate: (db, _) async {
        await db.execute('''
          CREATE TABLE tickets (
            session_id TEXT NOT NULL, code TEXT NOT NULL, status TEXT NOT NULL, section_id TEXT,
            mine INTEGER NOT NULL, holder TEXT, document TEXT, type TEXT, seat TEXT, methods TEXT NOT NULL DEFAULT '',
            used_at INTEGER, qr_dynamic INTEGER NOT NULL DEFAULT 0, qr_key TEXT,
            inside INTEGER, entries INTEGER, max_entries INTEGER NOT NULL DEFAULT 1, zone_ids TEXT NOT NULL DEFAULT '', zone_id TEXT,
            PRIMARY KEY (session_id, code)
          )''');
        await db.execute('''
          CREATE TABLE scans (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL, gate_id TEXT, code TEXT, raw TEXT NOT NULL,
            method TEXT NOT NULL, scanned_at INTEGER NOT NULL, verdict TEXT NOT NULL,
            synced INTEGER NOT NULL DEFAULT 0, server_result TEXT, movement TEXT, zone_id TEXT
          )''');
        await db.execute('CREATE INDEX scans_pending ON scans (synced, scanned_at)');
        await db.execute('CREATE TABLE meta (session_id TEXT PRIMARY KEY, json TEXT NOT NULL)');
        await db.execute('''
          CREATE TABLE vouchers (
            session_id TEXT NOT NULL, code TEXT NOT NULL, label TEXT NOT NULL, people INTEGER NOT NULL DEFAULT 1,
            buyer TEXT NOT NULL DEFAULT '', order_code TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'BOB',
            cancelled INTEGER NOT NULL DEFAULT 0, redeemed_at INTEGER, redeemed_by TEXT, note TEXT,
            PRIMARY KEY (session_id, code)
          )''');
        await db.execute('''
          CREATE TABLE voucher_reads (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL, code TEXT NOT NULL, read_at INTEGER NOT NULL, note TEXT,
            synced INTEGER NOT NULL DEFAULT 0, server_result TEXT
          )''');
      },
    );
    return DoorDb._(db, key);
  }

  /// Cifra o descifra la llave de una entrada: se le suma un flujo de bytes derivado (HMAC-SHA256) de la clave
  /// del teléfono y de la entrada. Es el mismo cálculo en los dos sentidos.
  Uint8List _xorKey(String sessionId, String code, List<int> data) {
    final stream = Hmac(sha256, _key).convert(utf8.encode('qrkey|$sessionId|$code')).bytes;
    return Uint8List.fromList([for (var i = 0; i < data.length; i++) data[i] ^ stream[i % stream.length]]);
  }

  Map<String, Object?> _row(String sessionId, TicketRow t) => {
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
        'qr_dynamic': t.qrDynamic ? 1 : 0,
        'qr_key': t.key == null ? null : base64Url.encode(_xorKey(sessionId, t.code, keyFromBase64(t.key!))),
        'inside': t.inside == null ? null : (t.inside! ? 1 : 0),
        'entries': t.entries,
        'max_entries': t.maxEntries,
        'zone_ids': t.zoneIds.join(','),
        'zone_id': t.zoneId,
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
        qrDynamic: (r['qr_dynamic'] as int? ?? 0) == 1,
        inside: r['inside'] == null ? null : (r['inside'] as int) == 1,
        entries: r['entries'] as int?,
        maxEntries: r['max_entries'] as int? ?? 1,
        zoneIds: (r['zone_ids'] as String? ?? '').isEmpty ? const [] : (r['zone_ids'] as String).split(','),
        zoneId: r['zone_id'] as String?,
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

  /// Las lecturas aceptadas aquí y aún sin subir mandan sobre lo que diga la descarga: se vuelven a aplicar en orden
  /// (ingreso, salida, reingreso, cambio de zona) para que el estado local sea el real.
  Future<void> _reapplyPending(DatabaseExecutor db, String sessionId) async {
    final rows = await db.query(
      'scans',
      where: "session_id = ? AND synced = 0 AND verdict = 'ACCEPTED' AND code IS NOT NULL",
      whereArgs: [sessionId],
      orderBy: 'scanned_at ASC',
    );
    for (final r in rows) {
      await _applyMovement(
        db,
        sessionId,
        r['code'] as String,
        Movement.fromApi(r['movement'] as String?) ?? Movement.entry,
        DateTime.fromMillisecondsSinceEpoch(r['scanned_at'] as int),
        r['zone_id'] as String?,
      );
    }
  }

  @override
  Future<TicketRow?> find(String sessionId, String code) async {
    final rows = await _db.query('tickets', where: 'session_id = ? AND code = ?', whereArgs: [sessionId, code]);
    return rows.isEmpty ? null : _fromRow(rows.first);
  }

  @override
  Future<Uint8List?> keyFor(String sessionId, String code) async {
    final rows = await _db.query('tickets', columns: ['qr_key'], where: 'session_id = ? AND code = ?', whereArgs: [sessionId, code]);
    final stored = rows.isEmpty ? null : rows.first['qr_key'] as String?;
    return stored == null ? null : _xorKey(sessionId, code, keyFromBase64(stored));
  }

  /// Entradas válidas de esta puerta cuyo tipo admite NFC, filtradas por nombre, carnet o código (para grabar pulseras).
  Future<List<TicketRow>> searchNfcCandidates(String sessionId, String query, {int limit = 60}) async {
    final q = query.trim();
    final code = q.replaceAll('-', '').toUpperCase();
    final rows = await _db.query(
      'tickets',
      where: "session_id = ? AND mine = 1 AND status = 'V' AND (',' || methods || ',') LIKE '%,NFC,%'"
          "${q.isEmpty ? '' : ' AND (holder LIKE ? OR document LIKE ? OR code LIKE ?)'}",
      whereArgs: [sessionId, if (q.isNotEmpty) ...['%$q%', '%$q%', '%$code%']],
      orderBy: 'holder COLLATE NOCASE ASC, code ASC',
      limit: limit,
    );
    return [for (final r in rows) _fromRow(r)];
  }

  /// Aplica a una entrada lo que pasó con ella en este teléfono: entró, salió, reingresó o cambió de zona.
  Future<void> applyMovement(String sessionId, String code, Movement movement, DateTime at, {String? zoneId}) =>
      _applyMovement(_db, sessionId, code, movement, at, zoneId);

  Future<void> _applyMovement(DatabaseExecutor db, String sessionId, String code, Movement movement, DateTime at, String? zoneId) async {
    final rows = await db.query('tickets', where: 'session_id = ? AND code = ?', whereArgs: [sessionId, code]);
    if (rows.isEmpty) return;
    final t = _fromRow(rows.first);
    final values = <String, Object?>{};
    switch (movement) {
      case Movement.entry:
      case Movement.reentry:
        values.addAll({
          'status': TicketStatus.used.code,
          'inside': 1,
          'entries': t.entryCount + 1,
          'zone_id': zoneId,
          'used_at': t.usedAt?.millisecondsSinceEpoch ?? at.millisecondsSinceEpoch,
        });
      case Movement.exit:
        values.addAll({'status': TicketStatus.used.code, 'inside': 0, 'zone_id': null});
      case Movement.zoneChange:
        values['zone_id'] = zoneId;
    }
    await db.update('tickets', values, where: 'session_id = ? AND code = ?', whereArgs: [sessionId, code]);
  }

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
        'movement': scan.movement?.api,
        'zone_id': scan.zoneId,
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
          movement: Movement.fromApi(r['movement'] as String?),
          zoneId: r['zone_id'] as String?,
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

  /// Entradas de esta puerta: cuántas hay, cuántas ya entraron alguna vez y cuántas están adentro ahora.
  Future<({int total, int used, int inside})> gateCounts(String sessionId) async {
    Future<int> count(String where) async =>
        Sqflite.firstIntValue(await _db.rawQuery('SELECT COUNT(*) FROM tickets WHERE session_id = ? AND mine = 1 AND $where', [sessionId])) ?? 0;
    final total = await count("status != 'C'");
    final used = await count("(status = 'U' OR COALESCE(entries, 0) > 0)");
    final inside = await count("status != 'C' AND COALESCE(inside, CASE WHEN status = 'U' THEN 1 ELSE 0 END) = 1");
    return (total: total, used: used, inside: inside);
  }

  /// Últimas lecturas de esta función (para la lista de la pantalla de lectura).
  Future<List<RecentScan>> recentScans(String sessionId, {int limit = 30}) async {
    final rows = await _db.rawQuery('''
      SELECT s.scanned_at, s.verdict, s.movement, s.code, t.holder, t.type
      FROM scans s LEFT JOIN tickets t ON t.session_id = s.session_id AND t.code = s.code
      WHERE s.session_id = ? ORDER BY s.scanned_at DESC LIMIT ?''', [sessionId, limit]);
    return [
      for (final r in rows)
        RecentScan(
          at: DateTime.fromMillisecondsSinceEpoch(r['scanned_at'] as int),
          verdict: ScanVerdict.fromApi(r['verdict'] as String) ?? ScanVerdict.invalid,
          movement: Movement.fromApi(r['movement'] as String?),
          holder: r['holder'] as String?,
          type: r['type'] as String?,
          code: r['code'] as String?,
        ),
    ];
  }

  /// Borra todo lo descargado (al cerrar sesión o terminar el evento).
  Future<void> clearAll() async {
    await _db.delete('tickets');
    await _db.delete('scans');
    await _db.delete('meta');
    await _db.delete('vouchers');
    await _db.delete('voucher_reads');
  }

  // ── Modo Barra: QR de consumo ──

  static Voucher _voucherFrom(Map<String, Object?> r) => Voucher(
        code: r['code'] as String,
        label: r['label'] as String,
        people: r['people'] as int? ?? 1,
        buyer: r['buyer'] as String? ?? '',
        orderCode: r['order_code'] as String? ?? '',
        amount: r['amount'] as int,
        currency: r['currency'] as String? ?? 'BOB',
        cancelled: (r['cancelled'] as int? ?? 0) == 1,
        redeemedAt: r['redeemed_at'] == null ? null : DateTime.fromMillisecondsSinceEpoch(r['redeemed_at'] as int),
        redeemedBy: r['redeemed_by'] as String?,
        note: r['note'] as String?,
      );

  @override
  Future<Voucher?> findVoucher(String sessionId, String code) async {
    final rows = await _db.query('vouchers', where: 'session_id = ? AND code = ?', whereArgs: [sessionId, code], limit: 1);
    return rows.isEmpty ? null : _voucherFrom(rows.first);
  }

  /// Descarga completa de la noche: reemplaza la lista. Lo leído aquí y todavía sin subir manda sobre la descarga
  /// (se vuelve a marcar), para que un vale ya leído en este teléfono no figure como disponible.
  Future<void> saveVouchers(String sessionId, List<Voucher> vouchers) async {
    await _db.transaction((txn) async {
      await txn.delete('vouchers', where: 'session_id = ?', whereArgs: [sessionId]);
      const chunk = 500;
      for (var i = 0; i < vouchers.length; i += chunk) {
        final batch = txn.batch();
        for (final v in vouchers.skip(i).take(chunk)) {
          batch.insert('vouchers', {
            'session_id': sessionId,
            'code': v.code,
            'label': v.label,
            'people': v.people,
            'buyer': v.buyer,
            'order_code': v.orderCode,
            'amount': v.amount,
            'currency': v.currency,
            'cancelled': v.cancelled ? 1 : 0,
            'redeemed_at': v.redeemedAt?.millisecondsSinceEpoch,
            'redeemed_by': v.redeemedBy,
            'note': v.note,
          });
        }
        await batch.commit(noResult: true);
      }
      final pending = await txn.query('voucher_reads', where: 'session_id = ? AND synced = 0', whereArgs: [sessionId], orderBy: 'read_at ASC');
      for (final r in pending) {
        await txn.update(
          'vouchers',
          {'redeemed_at': r['read_at'], 'redeemed_by': null, 'note': r['note']},
          where: 'session_id = ? AND code = ? AND redeemed_at IS NULL',
          whereArgs: [sessionId, r['code']],
        );
      }
    });
  }

  /// Marca el vale como leído en este teléfono y deja la lectura lista para subir.
  Future<void> markVoucherRead({required String id, required String sessionId, required String code, required DateTime at, String? note}) async {
    await _db.transaction((txn) async {
      await txn.update(
        'vouchers',
        {'redeemed_at': at.millisecondsSinceEpoch, 'redeemed_by': null, 'note': note},
        where: 'session_id = ? AND code = ?',
        whereArgs: [sessionId, code],
      );
      await txn.insert('voucher_reads', {'id': id, 'session_id': sessionId, 'code': code, 'read_at': at.millisecondsSinceEpoch, 'note': note, 'synced': 0});
    });
  }

  Future<List<({String id, String code, DateTime readAt, String? note})>> pendingVoucherReads(String sessionId, {int limit = 200}) async {
    final rows = await _db.query('voucher_reads', where: 'session_id = ? AND synced = 0', whereArgs: [sessionId], orderBy: 'read_at ASC', limit: limit);
    return [
      for (final r in rows) (id: r['id'] as String, code: r['code'] as String, readAt: DateTime.fromMillisecondsSinceEpoch(r['read_at'] as int), note: r['note'] as String?),
    ];
  }

  Future<int> pendingVoucherCount(String sessionId) async =>
      Sqflite.firstIntValue(await _db.rawQuery('SELECT COUNT(*) FROM voucher_reads WHERE session_id = ? AND synced = 0', [sessionId])) ?? 0;

  /// Anota lo que respondió el servidor a cada lectura subida. Si el vale ya lo había leído otro teléfono, queda con sus
  /// datos (quién y cuándo) y la lectura se cuenta como conflicto.
  Future<void> applyVoucherResults(String sessionId, Map<String, ({String result, Voucher? voucher})> results) async {
    await _db.transaction((txn) async {
      for (final entry in results.entries) {
        await txn.update('voucher_reads', {'synced': 1, 'server_result': entry.value.result}, where: 'id = ?', whereArgs: [entry.key]);
        final v = entry.value.voucher;
        if (v != null) {
          await txn.update(
            'vouchers',
            {'redeemed_at': v.redeemedAt?.millisecondsSinceEpoch, 'redeemed_by': v.redeemedBy, 'note': v.note, 'cancelled': v.cancelled ? 1 : 0},
            where: 'session_id = ? AND code = ?',
            whereArgs: [sessionId, v.code],
          );
        }
      }
    });
  }

  /// Lecturas de este teléfono que el servidor rechazó porque otro teléfono ya había leído ese vale.
  Future<int> voucherConflictCount(String sessionId) async =>
      Sqflite.firstIntValue(await _db.rawQuery("SELECT COUNT(*) FROM voucher_reads WHERE session_id = ? AND server_result = 'ALREADY_REDEEMED'", [sessionId])) ?? 0;

  Future<({int total, int read})> voucherCounts(String sessionId) async {
    final total = Sqflite.firstIntValue(await _db.rawQuery('SELECT COUNT(*) FROM vouchers WHERE session_id = ?', [sessionId])) ?? 0;
    final read = Sqflite.firstIntValue(await _db.rawQuery('SELECT COUNT(*) FROM vouchers WHERE session_id = ? AND redeemed_at IS NOT NULL', [sessionId])) ?? 0;
    return (total: total, read: read);
  }

  Future<List<Voucher>> recentVoucherReads(String sessionId, {int limit = 30}) async {
    final rows = await _db.query('vouchers', where: 'session_id = ? AND redeemed_at IS NOT NULL', whereArgs: [sessionId], orderBy: 'redeemed_at DESC', limit: limit);
    return [for (final r in rows) _voucherFrom(r)];
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
