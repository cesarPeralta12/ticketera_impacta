import 'package:flutter/material.dart';
import 'package:nfc_manager/nfc_manager.dart';

import '../app_services.dart';
import '../card_fingerprint.dart';
import '../door_service.dart';
import '../models.dart';
import '../ui/tokens.dart';
import '../ui/widgets.dart';
import 'scan_widgets.dart';

/// Solo lectura: muestra el número de serie de una tarjeta o manilla y, si está vinculada, a qué entrada corresponde
/// (con la lista descargada en este teléfono). No modifica nada.
class ReadCardScreen extends StatefulWidget {
  const ReadCardScreen({super.key, required this.service, required this.meta});

  final DoorService service;
  final SessionMeta meta;

  @override
  State<ReadCardScreen> createState() => _ReadCardScreenState();
}

class _ReadCardScreenState extends State<ReadCardScreen> {
  bool _read = false;
  CardFingerprint? _card;
  TicketRow? _ticket;
  String? _problem;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void dispose() {
    NfcManager.instance.stopSession().catchError((_) {});
    super.dispose();
  }

  Future<void> _start() async {
    setState(() {
      _read = false;
      _card = null;
      _ticket = null;
    });
    final availability = await NfcManager.instance.checkAvailability();
    if (availability != NfcAvailability.enabled) {
      if (mounted) setState(() => _problem = availability == NfcAvailability.disabled ? 'El NFC está apagado. Actívalo en los ajustes del teléfono.' : 'Este teléfono no tiene NFC.');
      return;
    }
    await NfcManager.instance.stopSession().catchError((_) {});
    await NfcManager.instance.startSession(
      pollingOptions: {NfcPollingOption.iso14443, NfcPollingOption.iso15693},
      onDiscovered: (tag) async {
        final card = fingerprintOf(tag);
        await NfcManager.instance.stopSession().catchError((_) {});
        if (!mounted) return;
        AppServices.of(context).feedback.detected();
        final ticket = card == null ? null : await widget.service.ticketByNfcUid(widget.meta.sessionId, card.uid);
        if (mounted) {
          setState(() {
            _read = true;
            _card = card;
            _ticket = ticket;
          });
        }
      },
    );
  }

  String _code(String c) => c.length == 10 ? '${c.substring(0, 5)}-${c.substring(5)}' : c;

  @override
  Widget build(BuildContext context) {
    final card = _card;
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Row(
                children: [
                  RoundIconButton(icon: Icons.arrow_back_rounded, tooltip: 'Volver', onTap: () => Navigator.of(context).maybePop()),
                  const SizedBox(width: 12),
                  const Expanded(child: Text('Leer una tarjeta', style: Type.title)),
                ],
              ),
            ),
            Expanded(
              child: !_read
                  ? NfcWaiting(message: _problem)
                  : SingleChildScrollView(
                      padding: const EdgeInsets.all(22),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _verdict(card),
                          const SizedBox(height: 16),
                          if (_ticket != null)
                            SoftCard(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(_ticket!.holder ?? 'Sin nombre', style: Type.heading.copyWith(fontSize: 22)),
                                  const SizedBox(height: 6),
                                  Text([if (_ticket!.type != null) _ticket!.type!, if (_ticket!.seat != null) _ticket!.seat!].join(' · '), style: Type.muted),
                                  Text('Código ${_code(_ticket!.code)}', style: Type.muted),
                                ],
                              ),
                            ),
                          if (card != null) ...[
                            const SizedBox(height: 16),
                            const SectionLabel('Lo que leyó el teléfono'),
                            const SizedBox(height: 6),
                            Text('Número de serie: ${card.uidLabel}', style: Type.muted),
                            if (card.type != null) Text('Tipo de etiqueta: ${card.type}', style: Type.muted),
                            if (card.model != null) Text('Modelo: ${card.model}', style: Type.muted),
                            if (card.tech.isNotEmpty) Text('Tecnologías: ${card.tech.join(', ')}', style: Type.muted),
                          ],
                          const SizedBox(height: 24),
                          PrimaryButton(label: 'LEER OTRA', icon: Icons.nfc_rounded, onPressed: _start),
                        ],
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _verdict(CardFingerprint? card) {
    final (String text, Color color, IconData icon) = card == null
        ? ('No se pudo leer el número de serie. Los teléfonos y las tarjetas virtuales no sirven.', Brand.red, Icons.error_outline_rounded)
        : _ticket == null
            ? ('Sin vincular en la lista de este teléfono. Si se canjeó hace poco, actualiza las entradas.', Brand.blue, Icons.crop_square_rounded)
            : ('Vinculada a una entrada de esta función.', Brand.green, Icons.verified_rounded);
    return Row(
      children: [
        Icon(icon, color: color, size: 30),
        const SizedBox(width: 12),
        Expanded(child: Text(text, style: Type.heading.copyWith(fontSize: 18, color: color))),
      ],
    );
  }
}
