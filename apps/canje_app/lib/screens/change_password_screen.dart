import 'package:flutter/material.dart';

import '../api.dart';
import '../app_services.dart';
import '../door_service.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';

/// Primera vez con contraseña temporal: hay que elegir una propia antes de usar la app.
class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key, required this.service});

  final DoorService service;

  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _repeat = TextEditingController();
  bool _busy = false;
  String? _error;
  int _shake = 0;

  @override
  void initState() {
    super.initState();
    _next.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _repeat.dispose();
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
    if (_next.text.length < 8) return _fail('La contraseña nueva debe tener al menos 8 caracteres.');
    if (_next.text != _repeat.text) return _fail('Las contraseñas nuevas no coinciden.');
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.service.changePassword(current: _current.text, next: _next.text);
    } on ApiException catch (e) {
      if (mounted) _fail(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// 0 a 4: largo, mayúscula, número y símbolo.
  int get _strength {
    final p = _next.text;
    var s = 0;
    if (p.length >= 8) s++;
    if (p.length >= 12) s++;
    if (RegExp(r'[A-Z]').hasMatch(p) && RegExp(r'[a-z]').hasMatch(p)) s++;
    if (RegExp(r'\d').hasMatch(p) && RegExp(r'[^A-Za-z0-9]').hasMatch(p)) s++;
    return s;
  }

  @override
  Widget build(BuildContext context) {
    final strength = _strength;
    final color = [Brand.red, Brand.red, Brand.amber, Brand.green, Brand.green][strength];
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(26, 18, 26, 30),
          children: [
            Row(
              children: [
                const BrandMark(height: 26),
                const Spacer(),
                TextButton(onPressed: () => widget.service.logout(), child: const Text('Salir')),
              ],
            ),
            const SizedBox(height: 28),
            const StaggerIn(
              child: Icon(Icons.lock_reset_rounded, size: 54, color: Brand.accent),
            ),
            const SizedBox(height: 14),
            const StaggerIn(index: 1, child: Text('Elige tu contraseña', style: Type.title)),
            const SizedBox(height: 8),
            const StaggerIn(index: 1, child: Text('Tu cuenta tiene una contraseña temporal. Elige una propia para continuar.', style: Type.muted)),
            const SizedBox(height: 26),
            StaggerIn(index: 2, child: AppField(controller: _current, label: 'Contraseña temporal', icon: Icons.key_outlined, obscure: true)),
            const SizedBox(height: 14),
            StaggerIn(index: 3, child: AppField(controller: _next, label: 'Contraseña nueva (mínimo 8)', icon: Icons.lock_outline, obscure: true)),
            const SizedBox(height: 10),
            // Barra de seguridad de la contraseña.
            Row(
              children: [
                for (var i = 0; i < 4; i++)
                  Expanded(
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 250),
                      height: 5,
                      margin: EdgeInsets.only(right: i == 3 ? 0 : 6),
                      decoration: BoxDecoration(color: i < strength ? color : Brand.surface3, borderRadius: BorderRadius.circular(3)),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 14),
            StaggerIn(
              index: 4,
              child: AppField(controller: _repeat, label: 'Repite la contraseña nueva', icon: Icons.lock_outline, obscure: true, onSubmitted: (_) => _submit()),
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
                        child: Text(_error!, style: Type.body.copyWith(color: const Color(0xFFFFC2C8), fontSize: 15)),
                      ),
                    ),
            ),
            const SizedBox(height: 24),
            PrimaryButton(label: 'GUARDAR Y CONTINUAR', icon: Icons.check_rounded, loading: _busy, onPressed: _submit),
          ],
        ),
      ),
    );
  }
}
