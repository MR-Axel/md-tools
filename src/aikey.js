// La conexión del asistente de IA: la clave de la persona y las llamadas a su proveedor. Sin interfaz (assistant.js).
//
//   - Las llamadas salen de acá derecho al proveedor elegido. El servidor de SharpMD no recibe la clave ni el texto.
//   - La clave se guarda solo en este dispositivo, en la misma base que "recordar en este dispositivo" de las
//     carpetas protegidas: cifrada (AES-256-GCM) con una llave que el navegador no deja exportar. Con "pedir una
//     contraseña", esa llave sale de la contraseña (PBKDF2) y no se guarda: sin la contraseña no hay nada usable.
//   - El cifrado va atado al proveedor y a su dirección: una clave no se puede apuntar a otro servidor cambiando un
//     dato guardado. Cambiar de proveedor o de dirección pide cargar la clave de nuevo.
//   - La clave nunca se devuelve: de acá sale solo si hay una, y sus últimos cuatro caracteres.
//   - Las preferencias que se sincronizan (y cruzan el puente con la extensión) no la tienen.
//
// Corre en tres lugares. En la app (web o página de la extensión), tal cual. En el service worker de la extensión,
// para atender a un .md del disco. Y sobre ese .md (script de contenido), donde solo reenvía al service worker: la
// clave y el pedido al proveedor quedan del lado de la extensión, fuera de la página.
(function (root) {
  'use strict';
  const LMD = root.LMD = root.LMD || {};
  const PAGE = typeof root.window !== 'undefined' && typeof root.document !== 'undefined';
  const REMOTE = PAGE && root.location.protocol !== 'chrome-extension:' && root.__MDT_WEB !== true && typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.connect);
  const PORT = 'lmd-ai';
  const ANTHROPIC_VERSION = '2023-06-01';
  const MAX_OUT = 16000; // tope de salida para Anthropic, que lo exige; los demás usan el suyo
  const fail = (code, detail, status) => Object.assign(new Error(code), { code, detail: detail || '', status: status || 0 });

  // ---------- Proveedores ----------
  // Cada uno: su dirección, cómo se presenta la clave, cómo se arma el pedido y cómo se lee cada evento del
  // streaming. read(json, acc) devuelve el texto nuevo y deja en acc el uso informado y por qué terminó.
  const openaiRead = (j, acc) => {
    if (j.error) throw fail('server', j.error.message || '');
    if (j.usage) { acc.input = j.usage.prompt_tokens; acc.output = j.usage.completion_tokens; }
    const c = j.choices && j.choices[0]; if (!c) return '';
    if (c.finish_reason === 'length') acc.stop = 'length'; else if (c.finish_reason === 'content_filter') acc.stop = 'refusal';
    return (c.delta && typeof c.delta.content === 'string') ? c.delta.content : '';
  };
  const openaiBody = (q, model, usage) => Object.assign({ model, stream: true, messages: [{ role: 'system', content: q.system }].concat(q.messages) }, usage ? { stream_options: { include_usage: true } } : {});
  const bearer = (key) => (key ? { authorization: 'Bearer ' + key } : {});
  const PROVIDERS = {
    anthropic: {
      name: 'Anthropic (Claude)', base: 'https://api.anthropic.com/v1', needsKey: true,
      // Sugeridos mientras no llega la lista del proveedor. El primero es el que queda elegido.
      models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001'],
      headers: (key) => ({ 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' }),
      chat: '/messages', list: '/models?limit=1000',
      body: (q, model) => ({ model, max_tokens: MAX_OUT, stream: true, system: q.system, messages: q.messages }),
      read: (j, acc) => {
        if (j.type === 'error') throw fail(j.error && /overloaded|api_error/.test(j.error.type) ? 'server' : j.error && j.error.type === 'rate_limit_error' ? 'rate' : 'server', (j.error && j.error.message) || '');
        if (j.type === 'message_start' && j.message && j.message.usage) { const u = j.message.usage; acc.input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0); }
        if (j.type === 'message_delta') {
          if (j.usage && j.usage.output_tokens != null) acc.output = j.usage.output_tokens;
          const why = j.delta && j.delta.stop_reason;
          if (why === 'max_tokens') acc.stop = 'length'; else if (why === 'refusal') acc.stop = 'refusal';
        }
        // Lo que no es texto (el razonamiento del modelo) no se muestra.
        return j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta' ? j.delta.text || '' : '';
      },
    },
    openai: {
      name: 'OpenAI', base: 'https://api.openai.com/v1', needsKey: true, models: [],
      headers: bearer, chat: '/chat/completions', list: '/models',
      body: (q, model) => openaiBody(q, model, true), read: openaiRead,
    },
    // Cualquier servidor que hable como OpenAI: OpenRouter, Ollama o LM Studio en esta máquina, y otros.
    compat: {
      name: 'OpenAI compatible', base: '', needsKey: false, models: [], custom: true,
      headers: bearer, chat: '/chat/completions', list: '/models',
      body: (q, model) => openaiBody(q, model, false), read: openaiRead,
    },
  };

  const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;
  // La dirección de un servidor propio: https, o http solo si es esta misma máquina. Devuelve '' si no sirve.
  function cleanBase(text) {
    let u; try { u = new URL(String(text || '').trim()); } catch (e) { return ''; }
    if (u.username || u.password || u.search || u.hash) return '';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.test(u.hostname))) return '';
    return u.origin + u.pathname.replace(/\/+$/, '');
  }
  const baseOf = (rec) => (PROVIDERS[rec.provider].custom ? rec.baseUrl : PROVIDERS[rec.provider].base);
  const hostOf = (rec) => { try { return new URL(baseOf(rec)).host; } catch (e) { return ''; } };
  const local = (rec) => { try { return LOOPBACK.test(new URL(baseOf(rec)).hostname); } catch (e) { return false; } };

  // ---------- Del script de contenido al service worker ----------
  function remote(op, args, onDelta, signal) {
    return new Promise((resolve, reject) => {
      let port; let done = false; let beat = 0;
      const end = (fn, v) => { if (done) return; done = true; clearInterval(beat); try { port.disconnect(); } catch (e) { /* ya cerrado */ } fn(v); };
      try { port = chrome.runtime.connect({ name: PORT }); } catch (e) { reject(fail('network')); return; }
      port.onMessage.addListener((m) => {
        if (!m) return;
        if (m.delta != null) { if (onDelta) onDelta(m.delta); return; }
        if (m.error) end(reject, fail(m.error.code, m.error.detail, m.error.status)); else end(resolve, m.value);
      });
      port.onDisconnect.addListener(() => end(reject, fail(signal && signal.aborted ? 'aborted' : 'network')));
      if (signal) { if (signal.aborted) { end(reject, fail('aborted')); return; } signal.addEventListener('abort', () => end(reject, fail('aborted'))); }
      // Mientras llega una respuesta larga, el service worker tiene que seguir despierto.
      beat = setInterval(() => { try { port.postMessage({ op: 'ping' }); } catch (e) { /* cerrado */ } }, 20000);
      port.postMessage({ op, args: args || {} });
    });
  }
  if (REMOTE) {
    LMD.ai = {
      PROVIDERS, cleanBase, remote: true,
      status: () => remote('status'), save: (o) => remote('save', o), remove: () => remote('remove'), setModel: (m) => remote('setModel', { model: m }),
      unlock: (p) => remote('unlock', { password: p }), setLock: (p) => remote('setLock', { password: p }), models: () => remote('models'),
      stream: (q, onDelta, signal) => remote('stream', q, onDelta, signal),
    };
    return;
  }

  // ---------- La clave guardada ----------
  const S = () => LMD.store; const Z = () => LMD.seal;
  const supported = () => !!(Z() && Z().supported() && root.indexedDB);
  const aad = (rec) => 'sharpmd ai key v1|' + rec.provider + '|' + baseOf(rec);
  let opened = null; // la llave derivada de la contraseña, mientras dure la pestaña: { salt, key }

  // La llave que abre lo guardado, o nada si hace falta la contraseña.
  const keyOf = (rec) => (rec.salt ? (opened && opened.salt === rec.salt ? opened.key : null) : rec.cryptoKey || null);
  async function secret(rec) {
    if (!rec.data) return '';
    const k = keyOf(rec); if (!k) throw fail('locked');
    try { return await Z().open(k, aad(rec), rec.data); } catch (e) { throw fail('unreadable'); }
  }
  // Los últimos cuatro, y solo de una clave lo bastante larga como para que no digan nada.
  const tail = (key) => (key.length >= 20 ? key.slice(-4) : '');
  async function write(rec, key, password) {
    const out = { provider: rec.provider, baseUrl: rec.baseUrl || '', model: rec.model || '', at: Date.now() };
    if (key) {
      let k;
      if (password) { const salt = Z().rand(16); k = await Z().passKey(password, salt); out.salt = Z().b64(salt); opened = { salt: out.salt, key: k }; }
      else { k = await Z().deviceKey(); out.cryptoKey = k; }
      out.data = await Z().seal(k, aad(out), key); out.last4 = tail(key);
    }
    await S().aiPut(out);
    return out;
  }
  const view = (rec) => (!rec ? { has: false } : {
    has: true, provider: rec.provider, baseUrl: rec.baseUrl || '', model: rec.model || '', host: hostOf(rec),
    hasKey: !!rec.data, last4: rec.last4 || '', lock: !!rec.salt, open: !!keyOf(rec) || !rec.data,
  });

  async function status() { return view(supported() ? await S().aiGet() : null); }
  // Guarda la conexión. Con otra clave, otro proveedor u otra dirección, lo anterior se reemplaza entero.
  async function save(o) {
    if (!supported()) throw fail('unsupported');
    const p = PROVIDERS[o && o.provider]; if (!p) throw fail('bad_provider');
    const key = String(o.key || '').trim();
    const baseUrl = p.custom ? cleanBase(o.baseUrl) : '';
    if (p.custom && !baseUrl) throw fail('bad_url');
    if (p.needsKey && !key) throw fail('no_key');
    if (/\s/.test(key) || key.length > 500) throw fail('bad_key');
    const model = String(o.model || p.models[0] || '').trim().slice(0, 200);
    return view(await write({ provider: o.provider, baseUrl, model }, key, o.password || ''));
  }
  async function remove() { opened = null; if (supported()) await S().aiDelete(); return { has: false }; }
  async function setModel(model) {
    const rec = await S().aiGet(); if (!rec) throw fail('no_key');
    rec.model = String(model || '').trim().slice(0, 200); await S().aiPut(rec);
    return view(rec);
  }
  async function unlock(password) {
    const rec = await S().aiGet(); if (!rec || !rec.salt) return view(rec);
    const k = await Z().passKey(password, Z().unb64(rec.salt));
    try { await Z().open(k, aad(rec), rec.data); } catch (e) { throw fail('bad_password'); }
    opened = { salt: rec.salt, key: k };
    return view(rec);
  }
  // Pone o saca la contraseña: la clave se vuelve a cifrar con la llave nueva.
  async function setLock(password) {
    const rec = await S().aiGet(); if (!rec || !rec.data) throw fail('no_key');
    const key = await secret(rec);
    return view(await write(rec, key, password || ''));
  }

  // ---------- El pedido ----------
  // Sin cookies, sin referente y sin seguir redirecciones: la clave no viaja a ningún otro lado.
  async function ask(rec, path, init, signal) {
    const p = PROVIDERS[rec.provider];
    if (root.navigator && root.navigator.onLine === false && !local(rec)) throw fail('offline');
    const key = await secret(rec);
    let res;
    try {
      res = await root.fetch(baseOf(rec) + path, Object.assign({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store', mode: 'cors', signal }, init, {
        headers: Object.assign(init.body ? { 'content-type': 'application/json' } : {}, p.headers(key)),
      }));
    } catch (e) {
      if (signal && signal.aborted) throw fail('aborted');
      throw fail(root.navigator && root.navigator.onLine === false ? 'offline' : 'network');
    }
    if (res.ok) return res;
    let detail = '';
    try { const t = (await res.text()).slice(0, 4000); let j = null; try { j = JSON.parse(t); } catch (e) { /* no es JSON */ } detail = j ? String((j.error && (j.error.message || j.error)) || j.message || '') : ''; } catch (e) { /* sin cuerpo */ }
    if (key) detail = detail.split(key).join('…');
    const s = res.status;
    throw fail(s === 401 || s === 403 ? 'auth' : s === 404 ? 'not_found' : s === 429 ? 'rate' : s === 413 ? 'too_long' : s >= 500 ? 'server' : 'bad_request', detail.slice(0, 300), s);
  }

  // Los modelos que ofrece el proveedor con esta clave.
  async function models() {
    const rec = await S().aiGet(); if (!rec) throw fail('no_key');
    const p = PROVIDERS[rec.provider];
    const j = await (await ask(rec, p.list, { method: 'GET' })).json().catch(() => null);
    const rows = (j && (j.data || j.models)) || [];
    const ids = rows.map((m) => String((m && (m.id || m.name)) || '')).filter(Boolean).slice(0, 500);
    return rec.provider === 'anthropic' ? ids : ids.sort();
  }

  // q: { system, messages: [{ role, content }] }. onDelta recibe cada tramo de texto. Devuelve el texto entero, el
  // uso que informa el proveedor (si lo informa) y por qué terminó: 'end', 'length' o 'refusal'.
  async function stream(q, onDelta, signal) {
    const rec = await S().aiGet(); if (!rec) throw fail('no_key');
    const p = PROVIDERS[rec.provider];
    if (!rec.model) throw fail('no_model');
    const res = await ask(rec, p.chat, { method: 'POST', body: JSON.stringify(p.body({ system: String(q.system || ''), messages: q.messages }, rec.model)) }, signal);
    const acc = { input: null, output: null, stop: 'end' }; let text = '';
    const take = (data) => {
      if (!data || data === '[DONE]') return;
      let j; try { j = JSON.parse(data); } catch (e) { return; }
      const piece = p.read(j, acc);
      if (piece) { text += piece; if (onDelta) onDelta(piece); }
    };
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    try {
      for (;;) {
        const r = await reader.read();
        buf += dec.decode(r.value || new Uint8Array(0), { stream: !r.done });
        const events = buf.split(/\r?\n\r?\n/); buf = r.done ? '' : events.pop();
        for (const ev of events) take(ev.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n'));
        if (r.done) break;
      }
    } catch (e) {
      try { Promise.resolve(reader.cancel()).catch(() => {}); } catch (x) { /* ya cortado */ }
      if (e && typeof e.code === 'string' && !(e instanceof root.DOMException)) throw e;
      throw fail(signal && signal.aborted ? 'aborted' : 'network');
    }
    return { text, usage: { input: acc.input, output: acc.output }, stop: acc.stop, model: rec.model };
  }

  LMD.ai = { PROVIDERS, cleanBase, supported, status, save, remove, setModel, unlock, setLock, models, stream };

  // ---------- En el service worker de la extensión: atender a los .md del disco ----------
  if (!PAGE && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onConnect) {
    const OPS = { status: () => status(), save: (a) => save(a), remove: () => remove(), setModel: (a) => setModel(a.model), unlock: (a) => unlock(a.password), setLock: (a) => setLock(a.password), models: () => models() };
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== PORT) return;
      // Solo el script de contenido de esta extensión, en el marco principal de una pestaña.
      const from = port.sender;
      if (!from || from.id !== chrome.runtime.id || !from.tab || from.frameId !== 0) { port.disconnect(); return; }
      const stop = new AbortController(); let open = true;
      const send = (m) => { if (open) { try { port.postMessage(m); } catch (e) { open = false; } } };
      port.onDisconnect.addListener(() => { open = false; stop.abort(); });
      port.onMessage.addListener((m) => {
        if (!m || m.op === 'ping') return;
        const a = m.args && typeof m.args === 'object' ? m.args : {};
        const run = m.op === 'stream' ? stream(a, (d) => send({ delta: d }), stop.signal) : OPS[m.op] ? OPS[m.op](a) : Promise.reject(fail('bad_op'));
        Promise.resolve(run).then((value) => send({ value }), (e) => send({ error: { code: (e && e.code) || 'network', detail: (e && e.detail) || '', status: (e && e.status) || 0 } }));
      });
    });
  }
})(typeof self !== 'undefined' ? self : globalThis);
