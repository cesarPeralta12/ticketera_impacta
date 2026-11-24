/// Códigos de entradas que ya existían fuera de iPass (vendidas por un tercero, con su propio QR o código impreso).
///
/// El teléfono no puede comparar el texto leído tal cual: depende de cómo vino en el Excel y de cómo lo imprimió el
/// tercero (guiones, mayúsculas, un enlace). Se limpia con la regla de cada lote y se compara la "clave" resultante.
/// Es copia exacta de `normalizeExternalCode` (packages/core/src/external-codes.ts): los casos de
/// `packages/core/src/external-codes.cases.json` los prueban los dos.
library;

/// Cómo se limpia un código del tercero. Llega con la descarga (`session.codeRules`), una por lote.
class ExternalCodeRule {
  const ExternalCodeRule({
    this.ignoreSeparators = true,
    this.fromUrl = true,
    this.prefix = '',
    this.suffix = '',
    this.ignoreLeadingZeros = false,
  });

  /// Ignorar guiones y espacios del medio: ABC-123 = ABC123.
  final bool ignoreSeparators;

  /// Si el QR trae un enlace, usar el parámetro code= (o parecido) o lo que sigue a la última barra.
  final bool fromUrl;

  /// Prefijo o sufijo fijo que se quita (TKT-). Vacío = ninguno.
  final String prefix;
  final String suffix;

  /// 00123 = 123. Por defecto no: son entradas distintas.
  final bool ignoreLeadingZeros;

  /// Una regla guardada (JSON de la descarga), con los valores por defecto donde falte algo.
  factory ExternalCodeRule.fromJson(Object? input) {
    final r = input is Map ? input : const {};
    bool flag(Object? v, bool fallback) => v is bool ? v : fallback;
    String text(Object? v) {
      final s = v is String ? v.trim() : '';
      return s.length > 20 ? s.substring(0, 20) : s;
    }

    return ExternalCodeRule(
      ignoreSeparators: flag(r['ignoreSeparators'], true),
      fromUrl: flag(r['fromUrl'], true),
      prefix: text(r['prefix']),
      suffix: text(r['suffix']),
      ignoreLeadingZeros: flag(r['ignoreLeadingZeros'], false),
    );
  }

  Map<String, dynamic> toJson() => {
        'ignoreSeparators': ignoreSeparators,
        'fromUrl': fromUrl,
        'prefix': prefix,
        'suffix': suffix,
        'ignoreLeadingZeros': ignoreLeadingZeros,
      };
}

/// Lo más largo que se acepta como código externo (un enlace completo puede ser largo; la clave no).
const maxExternalCodeLength = 200;
const _maxKeyLength = 100;

/// Parámetros de un enlace donde suele venir el código.
const _urlParams = ['code', 'codigo', 'ticket', 'c', 't', 'id'];

final _whitespace = RegExp(r'\s+');
final _separators = RegExp(r'[\s-]+');
final _isUrl = RegExp(r'^https?://', caseSensitive: false);

String _withoutSeparators(String text) => text.replaceAll(_separators, '');

/// Lo que trae un enlace: el parámetro code= (o parecido) o lo que sigue a la última barra.
String _fromUrl(String text) {
  if (!_isUrl.hasMatch(text)) return text;
  final url = Uri.tryParse(text);
  if (url == null || !url.hasAuthority) return text;
  for (final name in _urlParams) {
    final value = url.queryParameters[name]?.trim();
    if (value != null && value.isNotEmpty) return value;
  }
  final last = url.pathSegments.where((s) => s.isNotEmpty).lastOrNull;
  if (last == null) return text;
  try {
    return Uri.decodeComponent(last);
  } on ArgumentError {
    return text;
  }
}

/// La clave con la que se compara una lectura: sin espacios en los extremos, en mayúsculas y con las opciones de la
/// regla. null si no queda nada (o queda demasiado largo para ser un código).
String? normalizeExternalCode(String raw, [ExternalCodeRule rule = const ExternalCodeRule()]) {
  var text = raw.trim();
  if (text.isEmpty || text.length > maxExternalCodeLength) return null;
  if (rule.fromUrl) text = _fromUrl(text);
  text = text.trim().toUpperCase().replaceAll(_whitespace, ' ');
  String clean(String part) => rule.ignoreSeparators ? _withoutSeparators(part.toUpperCase()) : part.toUpperCase().trim();
  if (rule.ignoreSeparators) text = _withoutSeparators(text);
  final prefix = clean(rule.prefix);
  final suffix = clean(rule.suffix);
  if (prefix.isNotEmpty && text.startsWith(prefix) && text.length > prefix.length) text = text.substring(prefix.length);
  if (suffix.isNotEmpty && text.endsWith(suffix) && text.length > suffix.length) text = text.substring(0, text.length - suffix.length);
  if (rule.ignoreLeadingZeros) text = text.replaceFirst(RegExp(r'^0+(?=.)'), '');
  return text.isNotEmpty && text.length <= _maxKeyLength ? text : null;
}

/// Las claves posibles de una lectura con las reglas de los lotes de esa función (normalmente una o dos).
List<String> externalKeyCandidates(String raw, List<ExternalCodeRule> rules) {
  final keys = <String>[];
  for (final rule in rules) {
    final key = normalizeExternalCode(raw, rule);
    if (key != null && !keys.contains(key)) keys.add(key);
  }
  return keys;
}
