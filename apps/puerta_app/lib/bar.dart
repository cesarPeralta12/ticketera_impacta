/// Modo Barra: QR de consumo (vale de un solo uso). Lógica pura, sin Flutter ni base de datos, para poder probarla.
///
/// El personal de barra lee el QR de una mesa o de una entrada con trago, ve de quién es y cuánto consumo tiene, y lo
/// marca como leído. Es de un solo uso: la próxima lectura dice "ya fue leído". Funciona sin internet con la lista
/// descargada; al sincronizar, si otro teléfono ya lo había leído, el servidor lo avisa.
library;

/// Alfabeto de los códigos (sin 0/O, 1/I/L), igual que el servidor.
const _alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const voucherCodeLength = 10;

bool _isValidCode(String code) => code.length == voucherCodeLength && code.split('').every(_alphabet.contains);

/// Código del vale a partir de lo leído: el QR `CV1.<código>.<firma>` o el código escrito (con o sin guion).
/// No verifica la firma (el teléfono no lleva el secreto): comprueba que el código exista en la lista descargada.
/// El QR de una entrada (`TK1…`) no vale aquí.
String? extractVoucherCode(String raw) {
  final input = raw.trim();
  if (input.startsWith('CV1.')) {
    final parts = input.split('.');
    return parts.length == 3 && _isValidCode(parts[1]) && parts[2].isNotEmpty ? parts[1] : null;
  }
  if (input.contains('.')) return null;
  final manual = input.replaceAll('-', '').toUpperCase();
  return _isValidCode(manual) ? manual : null;
}

/// Una noche con consumo que esta cuenta puede atender.
class BarNight {
  const BarNight({required this.sessionId, required this.title, required this.startsAt, required this.venue, required this.timezone, required this.vouchers, required this.read});

  final String sessionId;
  final String title;
  final DateTime startsAt;
  final String venue;
  final String timezone;

  /// Cuántos QR de consumo hay y cuántos ya se leyeron (según el servidor).
  final int vouchers;
  final int read;

  factory BarNight.fromJson(Map<String, dynamic> json) => BarNight(
        sessionId: json['sessionId'] as String,
        title: json['title'] as String,
        startsAt: DateTime.parse(json['startsAt'] as String),
        venue: json['venue'] as String,
        timezone: json['timezone'] as String? ?? 'America/La_Paz',
        vouchers: (json['vouchers'] as num?)?.toInt() ?? 0,
        read: (json['read'] as num?)?.toInt() ?? 0,
      );

  Map<String, dynamic> toJson() => {
        'sessionId': sessionId,
        'title': title,
        'startsAt': startsAt.toUtc().toIso8601String(),
        'venue': venue,
        'timezone': timezone,
        'vouchers': vouchers,
        'read': read,
      };
}

/// El vale de una mesa o de una entrada con trago.
class Voucher {
  const Voucher({
    required this.code,
    required this.label,
    required this.people,
    required this.buyer,
    required this.orderCode,
    required this.amount,
    required this.currency,
    this.cancelled = false,
    this.redeemedAt,
    this.redeemedBy,
    this.note,
  });

  final String code;

  /// "Mesa VIP N° 4" o el nombre de la entrada con trago.
  final String label;
  final int people;
  final String buyer;
  final String orderCode;

  /// Consumo en centavos.
  final int amount;
  final String currency;

  /// La compra se anuló: el vale no vale.
  final bool cancelled;

  /// Cuándo se leyó (hora local de este teléfono o del servidor), por quién y la nota.
  final DateTime? redeemedAt;
  final String? redeemedBy;
  final String? note;

  bool get isRead => redeemedAt != null;

  factory Voucher.fromJson(Map<String, dynamic> json) => Voucher(
        code: json['code'] as String,
        label: json['label'] as String,
        people: (json['people'] as num?)?.toInt() ?? 1,
        buyer: json['buyer'] as String? ?? '',
        orderCode: json['orderCode'] as String? ?? '',
        amount: (json['amount'] as num).toInt(),
        currency: json['currency'] as String? ?? 'BOB',
        cancelled: json['cancelled'] as bool? ?? false,
        redeemedAt: json['redeemedAt'] == null ? null : DateTime.parse(json['redeemedAt'] as String).toLocal(),
        redeemedBy: json['redeemedBy'] as String?,
        note: json['note'] as String?,
      );

  Voucher copyWith({DateTime? redeemedAt, String? redeemedBy, String? note, bool? cancelled}) => Voucher(
        code: code,
        label: label,
        people: people,
        buyer: buyer,
        orderCode: orderCode,
        amount: amount,
        currency: currency,
        cancelled: cancelled ?? this.cancelled,
        redeemedAt: redeemedAt ?? this.redeemedAt,
        redeemedBy: redeemedBy ?? this.redeemedBy,
        note: note ?? this.note,
      );
}

/// "Bs 1.000,00" (o "1.000,00 USD" para otra moneda).
String formatVoucherAmount(int cents, String currency) {
  final whole = cents ~/ 100;
  final fraction = (cents % 100).toString().padLeft(2, '0');
  final digits = whole.toString();
  final grouped = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) grouped.write('.');
    grouped.write(digits[i]);
  }
  final number = '$grouped,$fraction';
  return currency == 'BOB' ? 'Bs $number' : '$number $currency';
}

/// Qué resultado tiene una lectura en la barra.
enum VoucherVerdict {
  /// Hay consumo y todavía no se leyó: se puede marcar.
  available,

  /// Ya se había leído: no se puede usar de nuevo.
  alreadyRead,

  /// La compra se anuló.
  cancelled,

  /// No es un QR de consumo (o no es de esta noche).
  invalid,
  notFound,
}

class VoucherOutcome {
  const VoucherOutcome({required this.verdict, this.voucher, this.detail});

  final VoucherVerdict verdict;
  final Voucher? voucher;
  final String? detail;

  String get title => switch (verdict) {
        VoucherVerdict.available => 'CONSUMO DISPONIBLE',
        VoucherVerdict.alreadyRead => 'YA FUE LEÍDO',
        VoucherVerdict.cancelled => 'COMPRA ANULADA',
        VoucherVerdict.invalid => 'QR NO VÁLIDO',
        VoucherVerdict.notFound => 'NO EXISTE EN ESTA NOCHE',
      };
}

/// Acceso a la lista descargada.
abstract class VoucherLookup {
  Future<Voucher?> findVoucher(String sessionId, String code);
}

/// Decide qué es lo leído, sin marcar nada.
Future<VoucherOutcome> inspectVoucher({required VoucherLookup vouchers, required String sessionId, required String raw}) async {
  if (raw.trim().startsWith('TK1.') || raw.trim().startsWith('TK2.')) {
    return const VoucherOutcome(verdict: VoucherVerdict.invalid, detail: 'Ese es el QR de una entrada. Pide el QR de consumo (el que dice «QR de consumo»).');
  }
  final code = extractVoucherCode(raw);
  if (code == null) return const VoucherOutcome(verdict: VoucherVerdict.invalid, detail: 'No parece un QR de consumo.');
  final voucher = await vouchers.findVoucher(sessionId, code);
  if (voucher == null) {
    return const VoucherOutcome(verdict: VoucherVerdict.notFound, detail: 'No está en la lista descargada. Actualiza los datos si se compró hace poco.');
  }
  if (voucher.cancelled) return VoucherOutcome(verdict: VoucherVerdict.cancelled, voucher: voucher, detail: 'Esa compra se anuló: su consumo no vale.');
  if (voucher.isRead) {
    final at = voucher.redeemedAt!;
    final time = '${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}';
    final by = voucher.redeemedBy;
    return VoucherOutcome(
      verdict: VoucherVerdict.alreadyRead,
      voucher: voucher,
      detail: 'Se leyó a las $time${by == null ? '' : ' por $by'}${voucher.note == null ? '' : ' · ${voucher.note}'}. No se puede usar de nuevo.',
    );
  }
  return VoucherOutcome(verdict: VoucherVerdict.available, voucher: voucher);
}
