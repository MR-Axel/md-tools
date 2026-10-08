// Plantillas para empezar una nota: agrupadas por área, en español y en inglés.
// {{date}} se reemplaza por la fecha del día al crear la nota. El nombre del archivo sale de `file`.
(function () {
  'use strict';

  const GROUPS = [
    ['day', 'Día a día'], ['project', 'Proyectos'], ['team', 'Equipo'], ['product', 'Producto y desarrollo'], ['personal', 'Personal'],
  ];

  // [id, grupo, nombre es, nombre en, archivo, cuerpo es, cuerpo en]
  const LIST = [
    ['daily', 'day', 'Nota diaria', 'Daily note', 'daily-{{date}}',
`# {{date}}

## Hoy
- [ ]
- [ ]
- [ ]

## Notas

## Para mañana
-
`,
`# {{date}}

## Today
- [ ]
- [ ]
- [ ]

## Notes

## For tomorrow
-
`],
    ['weekly', 'day', 'Plan semanal', 'Weekly plan', 'week-{{date}}',
`# Semana del {{date}}

## Lo que tiene que salir
1.
2.
3.

| Día | Foco | Hecho |
|---|---|---|
| Lunes |  |  |
| Martes |  |  |
| Miércoles |  |  |
| Jueves |  |  |
| Viernes |  |  |

## Lo que quedó afuera
-
`,
`# Week of {{date}}

## What has to ship
1.
2.
3.

| Day | Focus | Done |
|---|---|---|
| Monday |  |  |
| Tuesday |  |  |
| Wednesday |  |  |
| Thursday |  |  |
| Friday |  |  |

## What was left out
-
`],
    ['todo', 'day', 'Lista de tareas', 'To-do list', 'todo',
`# Tareas

## Ahora
- [ ]

## Después
- [ ]

## Hecho
- [x]
`,
`# To do

## Now
- [ ]

## Later
- [ ]

## Done
- [x]
`],
    ['checklist', 'day', 'Lista', 'Checklist', 'checklist',
`# Lista

- [ ]
`,
`# Checklist

- [ ]
`],
    ['meeting', 'day', 'Notas de reunión', 'Meeting notes', 'meeting-{{date}}',
`# Reunión:

**Fecha:** {{date}}

**Participantes:**

## Temas
1.

## Lo que se decidió
-

## Quién hace qué
| Tarea | Responsable | Para cuándo |
|---|---|---|
|  |  |  |
`,
`# Meeting:

**Date:** {{date}}

**Attendees:**

## Topics
1.

## Decisions
-

## Who does what
| Task | Owner | Due |
|---|---|---|
|  |  |  |
`],
    ['decision', 'day', 'Registro de decisiones', 'Decision log', 'decisions',
`# Decisiones

| Fecha | Decisión | Por qué | Quién |
|---|---|---|---|
| {{date}} |  |  |  |

## Pendientes de decidir
- [ ]
`,
`# Decisions

| Date | Decision | Why | Who |
|---|---|---|---|
| {{date}} |  |  |  |

## Still to decide
- [ ]
`],
    ['reading', 'day', 'Notas de lectura', 'Reading notes', 'reading-notes',
`# Título

**Autor:**

**Leído:** {{date}}

## De qué trata

## Ideas que me llevo
-

## Citas
>

## Qué hago con esto
- [ ]
`,
`# Title

**Author:**

**Read:** {{date}}

## What it is about

## Ideas I keep
-

## Quotes
>

## What I do with this
- [ ]
`],
    ['brief', 'project', 'Resumen de proyecto', 'Project brief', 'project-brief',
`# Proyecto:

## El problema

## Para quién

## Qué entra
-

## Qué queda afuera
-

## Cómo sabemos que salió bien
-

## Fechas
| Hito | Fecha |
|---|---|
| Arranque | {{date}} |
| Entrega |  |
`,
`# Project:

## The problem

## Who it is for

## In scope
-

## Out of scope
-

## How we know it worked
-

## Dates
| Milestone | Date |
|---|---|
| Kickoff | {{date}} |
| Delivery |  |
`],
    ['plan', 'project', 'Plan con responsables', 'Plan with owners', 'project-plan',
`# Plan

| Tarea | Responsable | Para cuándo | Estado |
|---|---|---|---|
|  |  |  | Sin empezar |
|  |  |  | Sin empezar |

## Dependencias
-

## Riesgos
-
`,
`# Plan

| Task | Owner | Due | Status |
|---|---|---|---|
|  |  |  | Not started |
|  |  |  | Not started |

## Dependencies
-

## Risks
-
`],
    ['roadmap', 'project', 'Hoja de ruta', 'Roadmap', 'roadmap',
`# Hoja de ruta

## Ahora
-

## Lo próximo
-

## Más adelante
-

\`\`\`mermaid
gantt
  dateFormat YYYY-MM-DD
  section Ahora
  Primera entrega :a1, {{date}}, 14d
  section Lo próximo
  Segunda entrega :after a1, 21d
\`\`\`
`,
`# Roadmap

## Now
-

## Next
-

## Later
-

\`\`\`mermaid
gantt
  dateFormat YYYY-MM-DD
  section Now
  First release :a1, {{date}}, 14d
  section Next
  Second release :after a1, 21d
\`\`\`
`],
    // Un espacio de proyecto no es una nota: es una carpeta con varias, enlazadas entre sí. El cuerpo es su README
    // (lo que muestra la vista previa) y el octavo lugar trae el resto: [ruta dentro de la carpeta, texto], por idioma.
    // Es la misma estructura que arma una IA conectada por MCP (get_guide, en el servidor). Los nombres de los
    // archivos y los campos de las tarjetas (agent, needs, link) van igual en los dos idiomas: la IA los busca así.
    ['workspace', 'project', 'Espacio de proyecto', 'Project workspace', 'README',
`# Nombre del proyecto

Qué es, en dos renglones.

## Cómo se corre

1.

## Índice

- [Arquitectura](architecture.md): los componentes y cómo se conectan.
- [Épicas](epics.md): los grandes bloques de trabajo y su estado.
- [Funciones](features/funcion-de-ejemplo.md): una nota por función.
- [Decisiones](decisions.md): qué se decidió y por qué.
- [Bitácora](log.md): qué cambió, por fecha.
- [Tablero de tareas](board.md): lo planeado, lo que está en curso, en pausa y hecho.
`,
`# Project name

What it is, in two lines.

## How to run it

1.

## Index

- [Architecture](architecture.md): the components and how they connect.
- [Epics](epics.md): the big pieces of work and their status.
- [Features](features/example-feature.md): one note per feature.
- [Decisions](decisions.md): what was decided and why.
- [Log](log.md): what changed, by date.
- [Task board](board.md): what is planned, in progress, paused and done.
`,
      { es: [
        ['architecture.md',
`# Arquitectura

Cómo se conectan las partes.

\`\`\`mermaid
flowchart LR
  app[App] --> api[API]
  api --> db[(Base de datos)]
\`\`\`

## Componentes

| Componente | Qué hace | Dónde vive |
|---|---|---|
| App |  |  |
| API |  |  |
| Base de datos |  |  |

[Volver al índice](README.md)
`],
        ['epics.md',
`# Épicas

## Épica de ejemplo

Estado: planeada

- [Función de ejemplo](features/funcion-de-ejemplo.md): planeada

[Volver al índice](README.md)
`],
        ['features/funcion-de-ejemplo.md',
`# Función de ejemplo

Estado: planeada

## Qué hace

## Cómo se usa

## Criterios de aceptación
- [ ]

## Dónde vive en el código

## Pendientes
- [ ]

[Volver al índice](../README.md)
`],
        ['decisions.md',
`# Decisiones

La más nueva va al final.

## {{date}} Decisión de ejemplo

- Contexto: qué obligó a elegir.
- Decisión: qué se eligió.
- Consecuencia: qué cuesta o qué cambia.

[Volver al índice](README.md)
`],
        ['log.md',
`# Bitácora

## {{date}}

- Se creó el espacio del proyecto.
`],
        ['board.md',
`# Tablero de tareas

\`\`\`kanban
{show=agent,needs done=Hecho}
## Por hacer
- [ ] Tarea de ejemplo {agent=yo}

## En curso

## En pausa

## Hecho
\`\`\`

[Volver al índice](README.md)
`],
      ], en: [
        ['architecture.md',
`# Architecture

How the parts connect.

\`\`\`mermaid
flowchart LR
  app[App] --> api[API]
  api --> db[(Database)]
\`\`\`

## Components

| Component | What it does | Where it lives |
|---|---|---|
| App |  |  |
| API |  |  |
| Database |  |  |

[Back to the index](README.md)
`],
        ['epics.md',
`# Epics

## Example epic

Status: planned

- [Example feature](features/example-feature.md): planned

[Back to the index](README.md)
`],
        ['features/example-feature.md',
`# Example feature

Status: planned

## What it does

## How it is used

## Acceptance criteria
- [ ]

## Where it lives in the code

## Pending
- [ ]

[Back to the index](../README.md)
`],
        ['decisions.md',
`# Decisions

Newest last.

## {{date}} Example decision

- Context: what forced the choice.
- Decision: what was chosen.
- Consequence: what it costs or changes.

[Back to the index](README.md)
`],
        ['log.md',
`# Log

## {{date}}

- Project workspace created.
`],
        ['board.md',
`# Task board

\`\`\`kanban
{show=agent,needs done=Done}
## To do
- [ ] Example task {agent=me}

## In progress

## Paused

## Done
\`\`\`

[Back to the index](README.md)
`],
      ] }],
    ['board', 'project', 'Tablero kanban', 'Kanban board', 'board',
`# Tablero

\`\`\`kanban
## Por hacer
- [ ]

## En curso
- [ ]

## Hecho
- [x]
\`\`\`
`,
`# Board

\`\`\`kanban
## To do
- [ ]

## Doing
- [ ]

## Done
- [x]
\`\`\`
`],
    ['risks', 'project', 'Registro de riesgos', 'Risk register', 'risks',
`# Riesgos

| Riesgo | Probabilidad | Impacto | Qué hacemos | Responsable |
|---|---|---|---|---|
|  | Media | Alto |  |  |

## Ya pasaron
-
`,
`# Risks

| Risk | Likelihood | Impact | What we do | Owner |
|---|---|---|---|---|
|  | Medium | High |  |  |

## Already happened
-
`],
    ['retro', 'project', 'Retrospectiva', 'Retrospective', 'retro-{{date}}',
`# Retrospectiva del {{date}}

## Lo que anduvo
-

## Lo que costó
-

## Lo que cambiamos
- [ ]
`,
`# Retrospective, {{date}}

## What worked
-

## What was hard
-

## What we change
- [ ]
`],
    ['oneone', 'team', 'Uno a uno', 'One on one', 'one-on-one',
`# Uno a uno con

## {{date}}

**Cómo viene:**

**Temas suyos**
-

**Temas míos**
-

**Acordamos**
- [ ]
`,
`# One on one with

## {{date}}

**How things are going:**

**Their topics**
-

**My topics**
-

**We agreed**
- [ ]
`],
    ['agenda', 'team', 'Agenda de reunión', 'Meeting agenda', 'agenda-{{date}}',
`# Agenda del {{date}}

| Tema | Quién lo trae | Minutos |
|---|---|---|
|  |  | 10 |
|  |  | 10 |
| Total |  | =sum |

## Antes de la reunión
- [ ]
`,
`# Agenda, {{date}}

| Topic | Brought by | Minutes |
|---|---|---|
|  |  | 10 |
|  |  | 10 |
| Total |  | =sum |

## Before the meeting
- [ ]
`],
    ['onboarding', 'team', 'Lista de incorporación', 'Onboarding checklist', 'onboarding',
`# Incorporación de

## Antes del primer día
- [ ] Accesos pedidos
- [ ] Equipo listo

## Primera semana
- [ ] Presentación con el equipo
- [ ] Recorrido por el producto
- [ ] Primera tarea chica

## Primer mes
- [ ] Primera entrega propia
- [ ] Conversación de cómo viene
`,
`# Onboarding for

## Before day one
- [ ] Access requested
- [ ] Equipment ready

## First week
- [ ] Meet the team
- [ ] Product walkthrough
- [ ] First small task

## First month
- [ ] First delivery of their own
- [ ] Check-in on how it is going
`],
    ['status', 'team', 'Reporte de estado', 'Status update', 'status-{{date}}',
`# Estado al {{date}}

**En una línea:**

## Hecho
-

## En curso
-

## Trabado
-

## Necesito
-
`,
`# Status, {{date}}

**In one line:**

## Done
-

## In progress
-

## Blocked
-

## I need
-
`],
    ['incident', 'team', 'Análisis de un incidente', 'Incident review', 'incident-{{date}}',
`# Incidente del {{date}}

**Qué vio la gente:**

**Cuánto duró:**

## Línea de tiempo
| Hora | Qué pasó |
|---|---|
|  |  |

## Causa

## Cómo se resolvió

## Para que no vuelva a pasar
- [ ]
`,
`# Incident, {{date}}

**What people saw:**

**How long it lasted:**

## Timeline
| Time | What happened |
|---|---|
|  |  |

## Cause

## How it was fixed

## So it does not happen again
- [ ]
`],
    ['prd', 'product', 'Documento de requisitos', 'Requirements doc', 'requirements',
`# Función:

## Problema

## Quién lo tiene

## Qué tiene que poder hacer
1.

## Qué no hace
-

## Casos borde
-

## Cómo lo medimos
-
`,
`# Feature:

## Problem

## Who has it

## What they must be able to do
1.

## What it does not do
-

## Edge cases
-

## How we measure it
-
`],
    ['bug', 'product', 'Reporte de error', 'Bug report', 'bug',
`# Error:

**Dónde:**

**Versión:**

## Pasos
1.
2.

## Qué esperaba

## Qué pasó

## Capturas o registro
`,
`# Bug:

**Where:**

**Version:**

## Steps
1.
2.

## Expected

## What happened

## Screenshots or logs
`],
    ['design', 'product', 'Diseño técnico', 'Technical design', 'design',
`# Diseño:

## Contexto

## Propuesta

\`\`\`mermaid
graph LR
  A[Cliente] --> B[Servicio]
  B --> C[(Base)]
\`\`\`

## Alternativas que descarté
| Opción | Por qué no |
|---|---|
|  |  |

## Lo que puede salir mal
-
`,
`# Design:

## Context

## Proposal

\`\`\`mermaid
graph LR
  A[Client] --> B[Service]
  B --> C[(Database)]
\`\`\`

## Alternatives I ruled out
| Option | Why not |
|---|---|
|  |  |

## What can go wrong
-
`],
    ['release', 'product', 'Notas de versión', 'Release notes', 'release-notes',
`# Versión

**Fecha:** {{date}}

## Nuevo
-

## Mejorado
-

## Arreglado
-
`,
`# Version

**Date:** {{date}}

## New
-

## Improved
-

## Fixed
-
`],
    ['readme', 'product', 'README', 'README', 'README',
`# Nombre del proyecto

Qué hace, en una frase.

## Instalación

\`\`\`
\`\`\`

## Uso

\`\`\`
\`\`\`

## Licencia
`,
`# Project name

What it does, in one sentence.

## Install

\`\`\`
\`\`\`

## Usage

\`\`\`
\`\`\`

## License
`],
    ['journal', 'personal', 'Diario', 'Journal', 'journal-{{date}}',
`# {{date}}

## Qué pasó hoy

## Qué me quedó dando vueltas

## Una cosa buena
`,
`# {{date}}

## What happened today

## What stayed on my mind

## One good thing
`],
    ['trip', 'personal', 'Plan de viaje', 'Trip plan', 'trip',
`# Viaje a

| Día | Dónde | Qué |
|---|---|---|
| 1 |  |  |
| 2 |  |  |

## Reservas
- [ ] Pasajes
- [ ] Alojamiento

## Para llevar
- [ ]
`,
`# Trip to

| Day | Where | What |
|---|---|---|
| 1 |  |  |
| 2 |  |  |

## Bookings
- [ ] Tickets
- [ ] Place to stay

## To pack
- [ ]
`],
    ['budget', 'personal', 'Presupuesto', 'Budget', 'budget',
`# Presupuesto

| Concepto | Previsto | Real |
|---|---|---|
| Alquiler | 0 | 0 |
| Comida | 0 | 0 |
| Transporte | 0 | 0 |
| Total | =sum | =sum |
`,
`# Budget

| Item | Planned | Actual |
|---|---|---|
| Rent | 0 | 0 |
| Food | 0 | 0 |
| Transport | 0 | 0 |
| Total | =sum | =sum |
`],
    ['habits', 'personal', 'Seguimiento de hábitos', 'Habit tracker', 'habits',
`# Hábitos, semana del {{date}}

| Hábito | L | M | M | J | V | S | D |
|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |
`,
`# Habits, week of {{date}}

| Habit | M | T | W | T | F | S | S |
|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |
`],
  ];

  const today = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  const fill = (text) => text.replace(/\{\{date\}\}/g, today());

  // Las que se sumaron de la comunidad (community.js) van en su grupo, con el id c:número. Son texto: el nombre se
  // muestra como texto y el Markdown pasa por el mismo saneado que cualquier nota.
  const extra = () => (LMD.community ? LMD.community.templates() : []);
  LMD.templates = {
    groups: () => GROUPS.map((g) => ({ id: g[0], name: LMD.t(g[1]) })).concat(extra().length ? [{ id: 'community', name: LMD.t('Comunidad') }] : []),
    list: () => LIST.map((t) => ({ id: t[0], group: t[1], name: LMD.lang() === 'es' ? t[2] : t[3] })).concat(extra().map((t) => ({ id: 'c:' + t.id, group: 'community', name: t.name, community: t.id }))),
    // Devuelve el texto y el nombre de archivo sugerido (sin extensión) de una plantilla.
    get: (id) => {
      if (String(id).startsWith('c:')) { const c = extra().find((x) => 'c:' + x.id === id); return c ? { file: c.file, text: fill(c.text) } : null; }
      const t = LIST.find((x) => x[0] === id); if (!t) return null;
      const es = LMD.lang() === 'es'; const out = { file: fill(t[4]), text: fill(es ? t[5] : t[6]) };
      // pack: las notas de una plantilla que crea una carpeta, con la primera (el índice) adelante.
      if (t[7]) out.pack = [{ path: out.file + '.md', text: out.text }].concat((es ? t[7].es : t[7].en).map((n) => ({ path: n[0], text: fill(n[1]) })));
      return out;
    },
  };
})();
