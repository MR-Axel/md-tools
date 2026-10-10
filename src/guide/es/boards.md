# Tablero kanban

Un tablero es un bloque de código con el nombre `kanban`. Cada título es una columna y cada tarea es una tarjeta.

```kanban
## Por hacer
- [ ] Abrir una carpeta del disco
- [ ] Conectar mi IA {priority=high}

## En curso
- [ ] Leer la guía

## Hecho
- [x] Abrir SharpMD
```

En una nota tuya las tarjetas se arrastran de una columna a otra, y un clic abre el detalle de la tarjeta. Esta guía es de solo lectura: guardá una copia para probarlo.

Para sumar uno, elegí **Tablero** en el menú de bloques.

## Qué se guarda

El tablero de arriba es este texto:

````text
```kanban
## Por hacer
- [ ] Abrir una carpeta del disco
- [ ] Conectar mi IA {priority=high}

## En curso
- [ ] Leer la guía

## Hecho
- [x] Abrir SharpMD
```
````

En cualquier otro programa se lee como una lista de tareas común.

## Atributos de una tarjeta

Una tarjeta puede terminar con sus atributos entre llaves:

```text
- [ ] Revisar el pedido {due=2026-10-20 priority=high}
```

- `id`, `created` y `updated` los escribe SharpMD. El `id` no cambia nunca.
- El resto es tuyo: `clave=valor`, con comillas si el valor tiene espacios.
- Un renglón solo con llaves antes de la primera columna configura el tablero. `show` dice qué atributos se ven en las tarjetas, y `clave=a|b|c` le da una lista de opciones a un atributo.

```text
{show=due,priority priority=low|medium|high}
```

## Con tu IA y con otras apps

Una IA conectada por MCP crea tableros, suma tarjetas y las mueve. Está en [Conectar tu IA por MCP](connect-your-ai.md). Un webhook avisa afuera cuando una tarjeta cambia: [Automatizaciones y webhooks](automations.md).

El tablero es una herramienta que viene prendida. Si la apagás en **Ajustes** > **Herramientas**, el bloque se ve como código y la nota no cambia.
