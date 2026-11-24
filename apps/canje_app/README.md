# iPass Canje

App aparte (base copiada de `apps/puerta_app`, que sigue su camino) para cambiar una entrada por una tarjeta o manilla NFC.
El diseño y los límites están en `docs/plan-app-nfc-tarjetas.md`.

## Qué hace

- Inicio de sesión y elección de la función (la misma cuenta de iPass Puerta; para vincular hace falta ser dueño o administrador).
- **Canjear entrada:** lee el QR o el código de barras (o se escribe), comprueba que la entrada existe, no está anulada ni usada y
  que su tipo tiene NFC. Luego lee la tarjeta y **vincula su número de serie** a la entrada en el servidor
  (`POST /api/v1/nfc-cards`). No escribe nada en la tarjeta.
  - Una tarjeta que ya es de otra entrada no se pisa.
  - Una entrada que ya tiene tarjeta se puede cambiar (tarjeta perdida o dañada); la anterior deja de abrir la puerta.
- **Leer una tarjeta:** muestra su número de serie y lo que se sabe de la etiqueta (tipo, modelo, tecnologías) y, si está
  vinculada, a qué entrada corresponde. No modifica nada.

## Código

- `lib/nfc_uid.dart`: lectura y normalización del número de serie (mismos casos que el servidor, `packages/core/src/nfc-uid.cases.json`).
- `lib/card_fingerprint.dart`: la huella que se sube (número de serie, tipo, modelo, tecnologías, ATQA, SAK).
- `lib/screens/redeem_screen.dart` y `lib/screens/read_card_screen.dart`.

## Compilar

```powershell
flutter build apk --release --dart-define=API_URL=https://ticketera-panel.proshop.lat
```

El canje necesita internet para vincular; la puerta no.
