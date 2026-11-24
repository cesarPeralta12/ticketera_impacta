import 'dart:async';

import 'package:flutter/material.dart';

import '../door_service.dart';
import '../models.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';

/// Ingresos y personas dentro de la función elegida. Está fuera de la pantalla de lectura a propósito: se abre desde
/// los ajustes y pide la contraseña.
class AttendanceScreen extends StatefulWidget {
  const AttendanceScreen({super.key, required this.service, required this.meta});

  final DoorService service;
  final SessionMeta meta;

  @override
  State<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends State<AttendanceScreen> {
  ({int total, int used, int inside}) _counts = (total: 0, used: 0, inside: 0);
  bool _loaded = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _refresh();
    _timer = Timer.periodic(const Duration(seconds: 10), (_) => _refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    final c = await widget.service.gateCounts(widget.meta.sessionId);
    if (mounted) {
      setState(() {
        _counts = c;
        _loaded = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final total = _counts.total;
    final used = _counts.used;
    final pending = total - used;
    return Scaffold(
      appBar: AppBar(title: const Text('Ingresos y personas dentro')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          Text(widget.meta.title, style: Type.heading, maxLines: 2, overflow: TextOverflow.ellipsis),
          if (widget.meta.gate != null) ...[
            const SizedBox(height: 2),
            Text('Puerta: ${widget.meta.gate!.name}', style: Type.muted),
          ],
          const SizedBox(height: 18),
          SoftCard(
            padding: const EdgeInsets.all(22),
            child: Row(
              children: [
                RingGauge(
                  value: total == 0 ? 0 : used / total,
                  size: 120,
                  stroke: 12,
                  child: Text(total == 0 ? '0%' : '${(used / total * 100).round()}%', style: Type.number.copyWith(fontSize: 26)),
                ),
                const SizedBox(width: 22),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_loaded ? '$used de $total' : '…', style: Type.number.copyWith(fontSize: 30)),
                      Text('entradas ya ingresaron', style: Type.muted),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(child: _Figure(icon: Icons.login_rounded, color: Brand.green, value: _counts.inside, label: 'Dentro ahora')),
              const SizedBox(width: 12),
              Expanded(child: _Figure(icon: Icons.hourglass_empty_rounded, color: Brand.amber, value: pending < 0 ? 0 : pending, label: 'Faltan por ingresar')),
            ],
          ),
          const SizedBox(height: 16),
          Text('Solo cuenta las entradas de esta puerta y lo que este teléfono ya descargó o leyó.', style: Type.muted.copyWith(fontSize: 12.5)),
        ],
      ),
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure({required this.icon, required this.color, required this.value, required this.label});

  final IconData icon;
  final Color color;
  final int value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return SoftCard(
      padding: const EdgeInsets.all(16),
      radius: 20,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 22),
          const SizedBox(height: 10),
          AnimatedNumber(value: value, style: Type.number.copyWith(fontSize: 28)),
          Text(label, style: Type.muted.copyWith(fontSize: 12.5)),
        ],
      ),
    );
  }
}
