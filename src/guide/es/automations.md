# Automatizaciones y webhooks

Conectan tus notas de la nube con Slack, Discord, Make, n8n, Activepieces o Zapier. Son parte del plan pago y se arman en **Ajustes** > **API y automatizaciones**.

Hay tres piezas:

| Pieza | Para qué |
|---|---|
| **Automatizaciones** | SharpMD avisa afuera cuando algo cambia (webhooks) |
| **Direcciones de entrada** | Algo de afuera escribe en tus notas |
| **Tokens de la API** | Un flujo lee y escribe notas y mueve tarjetas |

## Avisar afuera

**Nueva automatización** arma un webhook: elegís qué mirar (toda la cuenta, una carpeta o una nota), qué eventos y a dónde mandarlos. Hay formatos listos para Slack y Discord, y JSON para el resto.

También se llega desde el explorador: clic derecho sobre una nota o una carpeta de la nube y **Automatizar…**.

Los eventos:

- De una nota: `note.created`, `note.updated`, `note.moved`, `note.deleted`, `note.restored`
- De un comentario: `comment.created`, `comment.resolved`
- De una tarjeta de un tablero: `card.created`, `card.moved`, `card.updated`, `card.done`, `card.deleted`

Cada envío va firmado con HMAC-SHA-256 en la cabecera `X-SharpMD-Signature`. Tu flujo comprueba la firma con el secreto de la automatización.

## Recibir de afuera

**Nueva dirección de entrada** crea una dirección secreta. Lo que le llega agrega texto a una nota, crea una nota o crea una tarjeta. Sirve para un formulario, una venta o un correo.

> [!WARNING]
> La dirección se muestra una sola vez. Copiala en ese momento. Quien la tenga puede escribir ahí.

## Leer y escribir desde un flujo

La API usa los mismos tokens que la IA. Los pedidos están en la [Referencia de la API](api.md).

Con toda la nube protegida con contraseña no hay automatizaciones hasta que saques la protección. Está en [La nube y compartir](cloud-and-sharing.md).
