import 'package:flutter/material.dart';

import '../api.dart';
import '../door_service.dart';
import '../ui/tokens.dart';

/// Pide la contraseña de la cuenta antes de mostrar datos reservados. Devuelve true solo si es correcta.
Future<bool> askPassword(BuildContext context, DoorService service, {String reason = 'Escribe tu contraseña para continuar.'}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => _PasswordDialog(service: service, reason: reason),
  );
  return ok == true;
}

class _PasswordDialog extends StatefulWidget {
  const _PasswordDialog({required this.service, required this.reason});

  final DoorService service;
  final String reason;

  @override
  State<_PasswordDialog> createState() => _PasswordDialogState();
}

class _PasswordDialogState extends State<_PasswordDialog> {
  final _controller = TextEditingController();
  bool _hidden = true;
  bool _checking = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final value = _controller.text;
    if (value.isEmpty || _checking) return;
    setState(() {
      _checking = true;
      _error = null;
    });
    try {
      final ok = await widget.service.confirmPassword(value);
      if (!mounted) return;
      if (ok) {
        Navigator.pop(context, true);
      } else {
        setState(() {
          _checking = false;
          _error = 'La contraseña no es correcta.';
        });
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _checking = false;
        _error = e.offline ? 'Se necesita internet para comprobar la contraseña.' : e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      icon: const Icon(Icons.lock_outline_rounded, color: Brand.accent, size: 30),
      title: const Text('Confirma tu contraseña'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.reason, style: Type.muted),
          const SizedBox(height: 14),
          TextField(
            controller: _controller,
            autofocus: true,
            obscureText: _hidden,
            enabled: !_checking,
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => _submit(),
            decoration: InputDecoration(
              labelText: 'Contraseña',
              errorText: _error,
              suffixIcon: IconButton(
                icon: Icon(_hidden ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                onPressed: () => setState(() => _hidden = !_hidden),
              ),
            ),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: _checking ? null : () => Navigator.pop(context, false), child: const Text('Cancelar')),
        FilledButton(
          onPressed: _checking ? null : _submit,
          style: FilledButton.styleFrom(minimumSize: const Size(120, 48)),
          child: _checking ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.5)) : const Text('Continuar'),
        ),
      ],
    );
  }
}
