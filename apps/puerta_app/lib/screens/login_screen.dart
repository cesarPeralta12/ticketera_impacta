import 'package:flutter/material.dart';

import '../api.dart';
import '../door_service.dart';

/// Inicio de sesión con la cuenta de portero.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.service});

  final DoorService service;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  late final _server = TextEditingController(text: widget.service.serverUrl);
  bool _busy = false;
  bool _showServer = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    widget.service.sessionStore.email.then((v) {
      if (v != null && mounted) _email.text = v;
    });
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _server.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_email.text.trim().isEmpty || _password.text.isEmpty) {
      setState(() => _error = 'Ingresa tu email y contraseña.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.service.login(server: _server.text, email: _email.text, password: _password.text);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Icon(Icons.qr_code_scanner, size: 56, color: scheme.primary),
                    const SizedBox(height: 12),
                    Text('Impacta Puerta', textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineMedium),
                    const SizedBox(height: 4),
                    Text(
                      'Inicia sesión con tu cuenta de portero',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: scheme.onSurfaceVariant),
                    ),
                    const SizedBox(height: 28),
                    TextField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.username],
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(labelText: 'Email'),
                    ),
                    const SizedBox(height: 14),
                    TextField(
                      controller: _password,
                      obscureText: true,
                      autofillHints: const [AutofillHints.password],
                      onSubmitted: (_) => _submit(),
                      decoration: const InputDecoration(labelText: 'Contraseña'),
                    ),
                    if (_showServer) ...[
                      const SizedBox(height: 14),
                      TextField(
                        controller: _server,
                        keyboardType: TextInputType.url,
                        decoration: const InputDecoration(labelText: 'Servidor', hintText: 'https://panel.impacta.bo'),
                      ),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: 14),
                      Text(_error!, style: TextStyle(color: scheme.error), textAlign: TextAlign.center),
                    ],
                    const SizedBox(height: 22),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      child: _busy
                          ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                          : const Text('Entrar'),
                    ),
                    TextButton(
                      onPressed: () => setState(() => _showServer = !_showServer),
                      child: Text(_showServer ? 'Ocultar servidor' : 'Configurar servidor'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
