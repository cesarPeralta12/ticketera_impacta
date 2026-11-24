import 'package:flutter/material.dart';

import '../api.dart';
import '../app_services.dart';
import '../door_service.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';

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
  bool _showPassword = false;
  String? _error;
  int _shake = 0;

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

  void _fail(String message) {
    setState(() {
      _error = message;
      _shake++;
    });
    AppServices.of(context).feedback.fail();
  }

  Future<void> _submit() async {
    if (_email.text.trim().isEmpty || _password.text.isEmpty) {
      _fail('Escribe tu correo y tu contraseña.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.service.login(server: _server.text, email: _email.text, password: _password.text);
    } on ApiException catch (e) {
      if (mounted) _fail(e.offline ? 'No hay conexión con el servidor. Revisa tu internet.' : e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      resizeToAvoidBottomInset: true,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 26, vertical: 24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    StaggerIn(
                      index: 0,
                      child: GestureDetector(
                        // Quien administra el teléfono puede cambiar el servidor tocando el logo varias veces.
                        onLongPress: () => setState(() => _showServer = !_showServer),
                        child: Column(
                          children: [
                            const AppIconTile(size: 84),
                            const SizedBox(height: 22),
                            const BrandMark(height: 46),
                            const SizedBox(height: 10),
                            Text('CONTROL DE ACCESO', style: Type.label.copyWith(letterSpacing: 3.6, color: Brand.highlight)),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 40),
                    StaggerIn(
                      index: 1,
                      child: Text('Inicia sesión', style: Type.title.copyWith(fontSize: 24)),
                    ),
                    const SizedBox(height: 4),
                    const StaggerIn(index: 1, child: Text('Con tu cuenta de portero o de administración.', style: Type.muted)),
                    const SizedBox(height: 22),
                    StaggerIn(
                      index: 2,
                      child: AppField(
                        controller: _email,
                        label: 'Correo',
                        icon: Icons.alternate_email,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.username],
                        textInputAction: TextInputAction.next,
                      ),
                    ),
                    const SizedBox(height: 14),
                    StaggerIn(
                      index: 3,
                      child: AppField(
                        controller: _password,
                        label: 'Contraseña',
                        icon: Icons.lock_outline,
                        obscure: !_showPassword,
                        autofillHints: const [AutofillHints.password],
                        onSubmitted: (_) => _submit(),
                        suffix: IconButton(
                          tooltip: _showPassword ? 'Ocultar' : 'Mostrar',
                          icon: Icon(_showPassword ? Icons.visibility_off_outlined : Icons.visibility_outlined, color: Brand.muted),
                          onPressed: () => setState(() => _showPassword = !_showPassword),
                        ),
                      ),
                    ),
                    AnimatedSize(
                      duration: const Duration(milliseconds: 260),
                      curve: Curves.easeOutCubic,
                      child: _showServer
                          ? Padding(
                              padding: const EdgeInsets.only(top: 14),
                              child: AppField(controller: _server, label: 'Servidor', icon: Icons.dns_outlined, keyboardType: TextInputType.url),
                            )
                          : const SizedBox(width: double.infinity),
                    ),
                    AnimatedSize(
                      duration: const Duration(milliseconds: 260),
                      curve: Curves.easeOutCubic,
                      child: _error == null
                          ? const SizedBox(width: double.infinity)
                          : Shake(
                              trigger: _shake,
                              child: Container(
                                margin: const EdgeInsets.only(top: 14),
                                padding: const EdgeInsets.all(14),
                                decoration: BoxDecoration(
                                  color: Brand.red.withValues(alpha: 0.12),
                                  borderRadius: BorderRadius.circular(14),
                                  border: Border.all(color: Brand.red.withValues(alpha: 0.4)),
                                ),
                                child: Row(
                                  children: [
                                    const Icon(Icons.error_outline, color: Brand.red, size: 20),
                                    const SizedBox(width: 10),
                                    Expanded(child: Text(_error!, style: Type.body.copyWith(color: const Color(0xFFFFC2C8), fontSize: 15))),
                                  ],
                                ),
                              ),
                            ),
                    ),
                    const SizedBox(height: 24),
                    StaggerIn(index: 4, child: PrimaryButton(label: 'ENTRAR', icon: Icons.arrow_forward_rounded, loading: _busy, onPressed: _submit)),
                    const SizedBox(height: 22),
                    Center(child: Text('Versión $appVersion', style: Type.muted.copyWith(fontSize: 12, color: Brand.faint))),
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
