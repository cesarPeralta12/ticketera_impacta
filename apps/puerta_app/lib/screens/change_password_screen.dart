import 'package:flutter/material.dart';

import '../api.dart';
import '../door_service.dart';

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

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _repeat.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_next.text.length < 8) {
      setState(() => _error = 'La contraseña nueva debe tener al menos 8 caracteres.');
      return;
    }
    if (_next.text != _repeat.text) {
      setState(() => _error = 'Las contraseñas nuevas no coinciden.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.service.changePassword(current: _current.text, next: _next.text);
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
      appBar: AppBar(
        title: const Text('Cambia tu contraseña'),
        actions: [TextButton(onPressed: () => widget.service.logout(), child: const Text('Salir'))],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              'Tu cuenta tiene una contraseña temporal. Elige una propia para continuar.',
              style: TextStyle(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 20),
            TextField(controller: _current, obscureText: true, decoration: const InputDecoration(labelText: 'Contraseña temporal')),
            const SizedBox(height: 14),
            TextField(controller: _next, obscureText: true, decoration: const InputDecoration(labelText: 'Contraseña nueva (mínimo 8)')),
            const SizedBox(height: 14),
            TextField(
              controller: _repeat,
              obscureText: true,
              onSubmitted: (_) => _submit(),
              decoration: const InputDecoration(labelText: 'Repite la contraseña nueva'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 14),
              Text(_error!, style: TextStyle(color: scheme.error)),
            ],
            const SizedBox(height: 22),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: _busy ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5)) : const Text('Guardar y continuar'),
            ),
          ],
        ),
      ),
    );
  }
}
