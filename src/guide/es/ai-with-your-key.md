# IA con tu propia clave

SharpMD no trae una IA propia. El asistente usa la clave que vos conectás, y viene apagado.

## Prenderlo

1. Abrí **Ajustes** > **Herramientas** y prendé **Asistente de IA (con tu clave)**.
2. Elegí el proveedor y pegá tu clave.
3. Probala con el botón **Probar**.

Proveedores: Claude (Anthropic), OpenAI, Google Gemini, DeepSeek, Groq, Kimi (Moonshot AI), MiniMax, Mistral, OpenRouter, Together AI y xAI (Grok). También anda con un servidor compatible con OpenAI, como Ollama o LM Studio en tu máquina. Va una clave por proveedor.

## Qué hace

- Sobre una selección o un bloque: mejora la redacción, corrige ortografía y gramática, acorta, expande, cambia el tono, traduce o explica. El resultado es una propuesta al lado del original, con las diferencias marcadas. Vos elegís si reemplaza, se inserta debajo, se copia o se descarta.
- **Escribir con IA** genera Markdown en ese punto. Tiene accesos para una tabla, una lista de tareas, un diagrama, una fórmula, un resumen y los puntos clave.
- **Preguntar sobre la nota** abre un panel al costado que responde sobre la nota abierta.

`Alt+Shift+A` abre las acciones sobre la selección o el bloque. `Alt+Shift+Q` abre el panel de preguntas.

## Dónde va tu texto

> [!IMPORTANT]
> Los pedidos salen de tu navegador directo al proveedor que elegiste. El servidor de SharpMD no recibe la clave ni el texto.

La clave se guarda solo en ese dispositivo, cifrada. No viaja con los ajustes, ni con una nota, ni con una exportación. El proveedor recibe el texto que mandás, lo cobra y lo trata según sus propios términos.

Una clave en un navegador está protegida de otros sitios y de nuestro servidor. No lo está de alguien que usa tu dispositivo desbloqueado: conviene una clave con tope de gasto.

Esto es distinto de [conectar tu IA por MCP](connect-your-ai.md), donde es tu IA la que entra a tus notas de la nube.
