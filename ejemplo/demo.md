---
proyecto: App de turnos
estado: en curso
---

# Lanzamiento de la app de turnos

Lo que falta para salir el **lunes 19**. Lo que está tildado ya está en producción.

## Qué sale en esta versión

- [x] Reserva de turnos desde el celular
- [x] Recordatorio por WhatsApp el día anterior
- [ ] Pago de la seña con tarjeta
- [ ] Lista de espera cuando se libera un turno

## Quién hace qué

| Tarea | Responsable | Para cuándo | Estado |
|---|---|---|---|
| Pago de la seña | Sofía | Jueves 15 | En prueba |
| Lista de espera | Martín | Viernes 16 | Empezada |
| Textos de la tienda | Ana | Miércoles 14 | Lista |
| Prueba con cinco clientes | Sofía y Ana | Sábado 17 | Sin empezar |

## Riesgos

> [!WARNING]
> La pasarela de pago tarda hasta 48 horas en aprobar la cuenta. Hay que pedirla hoy.

El recordatorio sale desde un número nuevo y todavía no tiene la tilde verde. Mientras tanto usamos el número del local.

## Cómo se prueba

```bash
npm run build
npm run test -- reservas
```

## Después del lanzamiento

Medimos tres cosas la primera semana: turnos reservados por día, cuántos se cancelan y cuántos llegan tarde. Con eso decidimos si la lista de espera va primero o después.
