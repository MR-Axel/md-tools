// La conexión del asistente de IA: la clave de la persona y las llamadas a su proveedor. Sin interfaz (assistant.js).
//
//   - Las llamadas salen de acá derecho al proveedor elegido. El servidor de SharpMD no recibe la clave ni el texto.
//   - La clave se guarda solo en este dispositivo, en la misma base que "recordar en este dispositivo" de las
//     carpetas protegidas: cifrada (AES-256-GCM) con una llave que el navegador no deja exportar. Con "pedir una
//     contraseña", esa llave sale de la contraseña (PBKDF2) y no se guarda: sin la contraseña no hay nada usable.
//   - Hay una clave por proveedor. Elegir otro proveedor no borra las demás: quedan guardadas, cada una cifrada.
//   - El cifrado va atado al proveedor y a su dirección: una clave no se puede apuntar a otro servidor cambiando un
//     dato guardado. Cambiar la dirección de un proveedor pide cargar su clave de nuevo.
//   - La clave nunca se devuelve: de acá sale solo si hay una, y sus últimos cuatro caracteres.
//   - La clave viaja siempre en una cabecera, nunca en la dirección.
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

  // El mensaje de un error, con las formas que usan los distintos proveedores: { error: { message } }, { error: '…' },
  // { message }, { detail }, { detail: [{ msg }] }, { base_resp: { status_msg } }, o todo eso dentro de una lista.
  function errText(j, depth) {
    depth = depth || 0;
    if (typeof j === 'string') return j;
    if (Array.isArray(j)) return j.map((x) => errText(x, depth + 1)).filter(Boolean).slice(0, 3).join('; ');
    if (!j || typeof j !== 'object' || depth > 4) return '';
    for (const k of ['error', 'message', 'msg', 'detail', 'status_msg', 'base_resp', 'error_msg']) { const t = errText(j[k], depth + 1); if (t) return t; }
    return '';
  }

  // ---------- Proveedores ----------
  // Cada uno: su dirección, cómo se presenta la clave, cómo se arma el pedido y cómo se lee cada evento del
  // streaming. read(json, acc) devuelve el texto nuevo y deja en acc el uso informado y por qué terminó.
  //
  // Los que hablan como OpenAI comparten el adaptador. Lo que cambia entre ellos y acá se tolera:
  //   - no se manda tope de salida (max_tokens o max_completion_tokens, según quién): cada uno usa el suyo;
  //   - stream_options se manda solo a los que lo aceptan (usage), y si uno lo rechaza el pedido se repite sin él;
  //   - el razonamiento que llega aparte (reasoning_content, reasoning) no es respuesta y no se lee;
  //   - el uso llega arriba o dentro de choices[0], y el error con cualquiera de las formas de errText.
  const openaiRead = (j, acc) => {
    if (j.error) throw fail('server', errText(j.error));
    if (j.base_resp && j.base_resp.status_code) throw fail('server', errText(j.base_resp));
    const c = j.choices && j.choices[0];
    const u = j.usage || (c && c.usage);
    if (u) { if (u.prompt_tokens != null) acc.input = u.prompt_tokens; if (u.completion_tokens != null) acc.output = u.completion_tokens; }
    if (!c) return '';
    if (c.finish_reason === 'length') acc.stop = 'length'; else if (c.finish_reason === 'content_filter') acc.stop = 'refusal';
    return (c.delta && typeof c.delta.content === 'string') ? c.delta.content : '';
  };
  const openaiBody = (q, model, plain) => Object.assign({ model, stream: true, messages: (q.system ? [{ role: 'system', content: q.system }] : []).concat(q.messages) }, plain ? {} : { stream_options: { include_usage: true } });
  // La respuesta entera, cuando el servidor no la manda en tramos.
  const openaiWhole = (j) => { const c = j && j.choices && j.choices[0]; return c && c.message && typeof c.message.content === 'string' ? c.message.content : null; };
  const bearer = (key) => (key ? { authorization: 'Bearer ' + key } : {});
  const like = (o) => Object.assign({ needsKey: true, models: [], headers: bearer, chat: '/chat/completions', list: '/models', body: openaiBody, read: openaiRead, whole: openaiWhole, think: true }, o);

  // Sobre cada dirección: sure dice si la dirección base es la que recuerdo con certeza de la documentación del
  // proveedor (true) o si conviene revisarla (false). No se pudieron verificar en vivo al escribir esto: por eso la
  // dirección queda siempre a la vista y se puede corregir, con el enlace a la documentación al lado.
  // models son sugeridos mientras no llega la lista del proveedor; el primero es el que queda elegido.
  // group: 'top' (los más usados), 'more' (los demás, por orden alfabético) o 'custom'.
  const PROVIDERS = {
    anthropic: {
      name: 'Anthropic (Claude)', group: 'top', base: 'https://api.anthropic.com/v1', sure: true, needsKey: true,
      keys: 'https://console.anthropic.com/settings/keys', docs: 'https://docs.anthropic.com/en/api/overview',
      models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001'],
      headers: (key) => ({ 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' }),
      chat: '/messages', list: '/models?limit=1000', keepOrder: true,
      body: (q, model) => Object.assign({ model, max_tokens: Math.min(MAX_OUT, q.max || MAX_OUT), stream: true, messages: q.messages }, q.system ? { system: q.system } : {}),
      whole: (j) => (j && Array.isArray(j.content) ? j.content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('') : null),
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
    openai: like({ name: 'OpenAI', group: 'top', base: 'https://api.openai.com/v1', sure: true, usage: true, keys: 'https://platform.openai.com/api-keys', docs: 'https://platform.openai.com/docs/api-reference' }),
    // Gemini por su capa compatible con OpenAI: mismo pedido, mismo streaming y lista de modelos, con la clave en
    // Authorization. La interfaz nativa también anda desde el navegador, pero pide otro adaptador entero.
    // La lista trae los ids como "models/gemini-…": se les saca el prefijo.
    gemini: like({ name: 'Google Gemini', group: 'top', base: 'https://generativelanguage.googleapis.com/v1beta/openai', sure: true, usage: true, strip: /^models\//, keys: 'https://aistudio.google.com/apikey', docs: 'https://ai.google.dev/gemini-api/docs/openai', models: ['gemini-2.5-flash', 'gemini-2.5-pro'] }),
    deepseek: like({ name: 'DeepSeek', group: 'more', base: 'https://api.deepseek.com/v1', sure: true, usage: true, keys: 'https://platform.deepseek.com/api_keys', docs: 'https://api-docs.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner'] }),
    groq: like({ name: 'Groq', group: 'more', base: 'https://api.groq.com/openai/v1', sure: true, usage: true, keys: 'https://console.groq.com/keys', docs: 'https://console.groq.com/docs', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] }),
    // Moonshot tiene dos plataformas y las claves no se cruzan: la internacional (.ai) y la de China continental (.cn).
    kimi: like({
      name: 'Kimi (Moonshot AI)', group: 'more', base: 'https://api.moonshot.ai/v1', sure: true, keys: 'https://platform.moonshot.ai/console/api-keys', docs: 'https://platform.moonshot.ai/docs',
      regions: [{ id: 'intl', name: 'Internacional', base: 'https://api.moonshot.ai/v1', keys: 'https://platform.moonshot.ai/console/api-keys', docs: 'https://platform.moonshot.ai/docs' }, { id: 'cn', name: 'China continental', base: 'https://api.moonshot.cn/v1', keys: 'https://platform.moonshot.cn/console/api-keys', docs: 'https://platform.moonshot.cn/docs' }],
      models: ['kimi-k2-turbo-preview', 'kimi-k2-0905-preview', 'moonshot-v1-auto'],
    }),
    // MiniMax: la dirección internacional cambió de dominio más de una vez (api.minimaxi.chat, después
    // api.minimax.io). Es la que menos seguro recuerdo: sure en false, y los modelos, a confirmar con la lista.
    minimax: like({
      name: 'MiniMax', group: 'more', base: 'https://api.minimax.io/v1', sure: false, keys: 'https://platform.minimax.io', docs: 'https://platform.minimax.io/docs',
      regions: [{ id: 'intl', name: 'Internacional', base: 'https://api.minimax.io/v1', keys: 'https://platform.minimax.io', docs: 'https://platform.minimax.io/docs' }, { id: 'cn', name: 'China continental', base: 'https://api.minimaxi.com/v1', keys: 'https://platform.minimaxi.com', docs: 'https://platform.minimaxi.com/document' }],
      models: ['MiniMax-M2', 'MiniMax-M1', 'MiniMax-Text-01'],
    }),
    // Mistral rechaza los campos que no conoce: sin stream_options.
    mistral: like({ name: 'Mistral', group: 'more', base: 'https://api.mistral.ai/v1', sure: true, keys: 'https://console.mistral.ai/api-keys', docs: 'https://docs.mistral.ai/api', models: ['mistral-medium-latest', 'mistral-large-latest', 'mistral-small-latest'] }),
    openrouter: like({ name: 'OpenRouter', group: 'more', base: 'https://openrouter.ai/api/v1', sure: true, usage: true, keys: 'https://openrouter.ai/keys', docs: 'https://openrouter.ai/docs', models: ['openrouter/auto'] }),
    together: like({ name: 'Together AI', group: 'more', base: 'https://api.together.xyz/v1', sure: true, keys: 'https://api.together.ai/settings/api-keys', docs: 'https://docs.together.ai', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'] }),
    xai: like({ name: 'xAI (Grok)', group: 'more', base: 'https://api.x.ai/v1', sure: true, usage: true, keys: 'https://console.x.ai', docs: 'https://docs.x.ai', models: ['grok-4', 'grok-3', 'grok-3-mini'] }),
    // Cualquier otro servidor que hable como OpenAI: Ollama o LM Studio en esta máquina, y los que no están arriba.
    compat: like({ name: 'OpenAI compatible', group: 'custom', base: '', needsKey: false, custom: true }),
  };

  const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;
  // La dirección de un servidor: https, o http solo si es esta misma máquina. Devuelve '' si no sirve.
  function cleanBase(text) {
    let u; try { u = new URL(String(text || '').trim()); } catch (e) { return ''; }
    if (u.username || u.password || u.search || u.hash) return '';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.test(u.hostname))) return '';
    return u.origin + u.pathname.replace(/\/+$/, '');
  }
  // La dirección guardada, o la del proveedor si no se la cambió.
  const baseOf = (rec) => rec.baseUrl || PROVIDERS[rec.provider].base;
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
      status: () => remote('status'), save: (o) => remote('save', o), remove: (p) => remote('remove', { provider: p || '' }), use: (p) => remote('use', { provider: p }), setModel: (m) => remote('setModel', { model: m }),
      unlock: (p) => remote('unlock', { password: p }), setLock: (p) => remote('setLock', { password: p }), models: () => remote('models'),
      stream: (q, onDelta, signal) => remote('stream', q, onDelta, signal),
    };
    return;
  }

  // ---------- Las claves guardadas ----------
  // Un solo registro. Arriba, la conexión en uso, con la misma forma de siempre (lo guardado por una versión anterior,
  // con una sola clave, se lee tal cual: no hay nada que convertir). En more, las de los demás proveedores, cada una
  // con su propio cifrado: { [proveedor]: { provider, baseUrl, model, at, data, cryptoKey | salt, last4, plain } }.
  const S = () => LMD.store; const Z = () => LMD.seal;
  const supported = () => !!(Z() && Z().supported() && root.indexedDB);
  const aad = (rec) => 'sharpmd ai key v1|' + rec.provider + '|' + baseOf(rec);
  const FIELDS = ['provider', 'baseUrl', 'model', 'at', 'data', 'cryptoKey', 'salt', 'last4', 'plain'];
  const slim = (rec) => { const o = {}; FIELDS.forEach((k) => { if (rec[k] !== undefined) o[k] = rec[k]; }); return o; };
  const others = (all) => { const o = {}; const m = (all && all.more) || {}; Object.keys(m).forEach((k) => { if (PROVIDERS[k] && m[k] && m[k].provider === k) o[k] = m[k]; }); return o; };
  const raw = async () => (await S().aiGet()) || null;
  // La conexión en uso, o nada.
  const get = async () => { const all = await raw(); return all && PROVIDERS[all.provider] ? all : null; };
  const put = (rec, more) => S().aiPut(Object.assign(slim(rec), { more: more || {} }));
  const opened = new Map(); // las llaves derivadas de una contraseña, mientras dure la pestaña: sal -> llave

  // La llave que abre lo guardado, o nada si hace falta la contraseña.
  const keyOf = (rec) => (rec.salt ? opened.get(rec.salt) || null : rec.cryptoKey || null);
  async function secret(rec) {
    if (!rec.data) return '';
    const k = keyOf(rec); if (!k) throw fail('locked');
    try { return await Z().open(k, aad(rec), rec.data); } catch (e) { throw fail('unreadable'); }
  }
  // Los últimos cuatro, y solo de una clave lo bastante larga como para que no digan nada.
  const tail = (key) => (key.length >= 20 ? key.slice(-4) : '');
  async function write(rec, key, password, more) {
    const out = { provider: rec.provider, baseUrl: rec.baseUrl || '', model: rec.model || '', at: Date.now() };
    if (rec.plain) out.plain = true;
    if (key) {
      let k;
      if (password) { const salt = Z().rand(16); k = await Z().passKey(password, salt); out.salt = Z().b64(salt); opened.set(out.salt, k); }
      else { k = await Z().deviceKey(); out.cryptoKey = k; }
      out.data = await Z().seal(k, aad(out), key); out.last4 = tail(key);
    }
    await put(out, more);
    return Object.assign(out, { more: more || {} });
  }
  const brief = (rec) => ({ provider: rec.provider, hasKey: !!rec.data, last4: rec.last4 || '' });
  const view = (rec) => (!rec ? { has: false, saved: [] } : {
    has: true, provider: rec.provider, name: PROVIDERS[rec.provider].name, custom: !!PROVIDERS[rec.provider].custom, baseUrl: baseOf(rec), model: rec.model || '', host: hostOf(rec),
    hasKey: !!rec.data, last4: rec.last4 || '', lock: !!rec.salt, open: !!keyOf(rec) || !rec.data,
    // Todos los proveedores con una conexión guardada, el que está en uso primero.
    saved: [brief(rec)].concat(Object.values(others(rec)).map(brief)),
  });

  async function status() { return view(supported() ? await get() : null); }
  // Guarda la conexión de un proveedor y la deja en uso. Reemplaza solo la de ese proveedor: las demás quedan.
  async function save(o) {
    if (!supported()) throw fail('unsupported');
    const p = PROVIDERS[o && o.provider]; if (!p) throw fail('bad_provider');
    const key = String(o.key || '').trim();
    const typed = String(o.baseUrl || '').trim();
    let baseUrl = cleanBase(typed);
    if ((p.custom || typed) && !baseUrl) throw fail('bad_url');
    if (baseUrl === p.base) baseUrl = '';
    if (p.needsKey && !key) throw fail('no_key');
    if (/\s/.test(key) || key.length > 500) throw fail('bad_key');
    const model = String(o.model || p.models[0] || '').trim().slice(0, 200);
    const all = await raw(); const more = others(all);
    if (all && PROVIDERS[all.provider] && all.provider !== o.provider) more[all.provider] = slim(all);
    delete more[o.provider];
    return view(await write({ provider: o.provider, baseUrl, model }, key, o.password || '', more));
  }
  // Pasa a usar la conexión ya guardada de otro proveedor.
  async function use(provider) {
    const all = await get(); if (!all) throw fail('no_key');
    if (all.provider === provider) return view(all);
    const more = others(all); const next = more[provider]; if (!next) throw fail('no_key');
    delete more[provider]; more[all.provider] = slim(all);
    await put(next, more);
    return view(Object.assign(slim(next), { more }));
  }
  // Borra la conexión de un proveedor (la que está en uso, si no se dice cuál). Si era la que estaba en uso y hay
  // otras guardadas, queda en uso la más reciente.
  async function remove(provider) {
    if (!supported()) return view(null);
    const all = await raw(); if (!all) return view(null);
    const more = others(all);
    if (provider && provider !== all.provider) {
      if (more[provider] && more[provider].salt) opened.delete(more[provider].salt);
      delete more[provider]; await put(all, more);
      return view(await get());
    }
    if (all.salt) opened.delete(all.salt);
    const next = Object.values(more).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    if (!next) { await S().aiDelete(); return view(null); }
    delete more[next.provider]; await put(next, more);
    return view(Object.assign(slim(next), { more }));
  }
  async function setModel(model) {
    const rec = await get(); if (!rec) throw fail('no_key');
    rec.model = String(model || '').trim().slice(0, 200); await put(rec, others(rec));
    return view(rec);
  }
  async function unlock(password) {
    const rec = await get(); if (!rec || !rec.salt) return view(rec);
    const k = await Z().passKey(password, Z().unb64(rec.salt));
    try { await Z().open(k, aad(rec), rec.data); } catch (e) { throw fail('bad_password'); }
    opened.set(rec.salt, k);
    return view(rec);
  }
  // Pone o saca la contraseña de la clave en uso: se vuelve a cifrar con la llave nueva.
  async function setLock(password) {
    const rec = await get(); if (!rec || !rec.data) throw fail('no_key');
    const key = await secret(rec);
    if (rec.salt) opened.delete(rec.salt);
    return view(await write(rec, key, password || '', others(rec)));
  }

  // ---------- El pedido ----------
  // El navegador no dice por qué falló un pedido. Si el servidor contesta a uno simple, sin clave y sin leer la
  // respuesta, es que está andando y lo que no acepta son pedidos hechos desde una página (CORS).
  // En la extensión no hace falta: sus pedidos no pasan por esa regla.
  async function blocked(url) {
    if (!PAGE || root.location.protocol === 'chrome-extension:') return false;
    const stop = new AbortController(); const timer = setTimeout(() => stop.abort(), 4000);
    try { await root.fetch(url, { method: 'GET', mode: 'no-cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: stop.signal }); return true; } catch (e) { return false; } finally { clearTimeout(timer); }
  }
  // Sin cookies, sin referente y sin seguir redirecciones: la clave no viaja a ningún otro lado.
  // Devuelve la respuesta y con qué sacar la clave de un texto, por si el proveedor la repite.
  async function ask(rec, path, init, signal) {
    const p = PROVIDERS[rec.provider];
    if (root.navigator && root.navigator.onLine === false && !local(rec)) throw fail('offline');
    const key = await secret(rec);
    const hide = (text) => (key ? String(text || '').split(key).join('…') : String(text || '')).slice(0, 300);
    const url = baseOf(rec) + path;
    let res;
    try {
      res = await root.fetch(url, Object.assign({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store', mode: 'cors', signal }, init, {
        headers: Object.assign(init.body ? { 'content-type': 'application/json' } : {}, p.headers(key)),
      }));
    } catch (e) {
      if (signal && signal.aborted) throw fail('aborted');
      if (root.navigator && root.navigator.onLine === false) throw fail('offline');
      throw fail((await blocked(url)) ? 'cors' : 'network');
    }
    if (res.ok) return [res, hide];
    let detail = '';
    try {
      const t = (await res.text()).slice(0, 4000); let j = null; try { j = JSON.parse(t); } catch (e) { /* no es JSON */ }
      detail = j ? errText(j) : /^\s*</.test(t) ? '' : t.trim(); // una página HTML de error no dice nada útil
    } catch (e) { /* sin cuerpo */ }
    const s = res.status;
    // Algunos proveedores contestan 400 a una clave que no existe.
    const auth = s === 401 || s === 403 || (s === 400 && /api[ _-]?key[^.]{0,40}(not valid|invalid|incorrect)|(invalid|incorrect)[^.]{0,20}api[ _-]?key|invalid_api_key/i.test(detail));
    throw fail(auth ? 'auth' : s === 404 ? 'not_found' : s === 429 ? 'rate' : s === 413 ? 'too_long' : s >= 500 ? 'server' : 'bad_request', hide(detail), s);
  }

  // Los modelos que ofrece el proveedor con esta clave.
  async function models() {
    const rec = await get(); if (!rec) throw fail('no_key');
    const p = PROVIDERS[rec.provider];
    const j = await (await ask(rec, p.list, { method: 'GET' }))[0].json().catch(() => null);
    const rows = Array.isArray(j) ? j : (j && (j.data || j.models)) || [];
    const ids = (Array.isArray(rows) ? rows : []).map((m) => String((m && (m.id || m.name)) || m || '')).map((id) => (p.strip ? id.replace(p.strip, '') : id)).filter((id) => id && id !== '[object Object]').slice(0, 500);
    return p.keepOrder ? ids : [...new Set(ids)].sort();
  }

  // Algunos modelos escriben su razonamiento al principio de la respuesta, entre <think> y </think>: no es respuesta.
  // Devuelve una función que recibe cada tramo y entrega lo que sí se muestra; con end en true, lo que quedó retenido.
  function noThink() {
    let state = 0; let hold = ''; // 0: todavía no se sabe, 1: adentro del razonamiento, 2: respuesta
    return (piece, end) => {
      if (state === 2) return piece;
      hold += piece;
      if (state === 0) {
        const t = hold.replace(/^\s+/, '');
        if (t.length < 7 && '<think>'.startsWith(t) && !end) return '';
        if (!t.startsWith('<think>')) { state = 2; const out = hold; hold = ''; return out; }
        state = 1; hold = t.slice(7);
      }
      const i = hold.indexOf('</think>');
      if (i < 0) { hold = hold.slice(-7); return ''; }
      state = 2; const out = hold.slice(i + 8).replace(/^\s+/, ''); hold = '';
      return out;
    };
  }

  // q: { system, messages: [{ role, content }], max? }. onDelta recibe cada tramo de texto. Devuelve el texto entero,
  // el uso que informa el proveedor (si lo informa) y por qué terminó: 'end', 'length' o 'refusal'.
  async function stream(q, onDelta, signal) {
    const rec = await get(); if (!rec) throw fail('no_key');
    const p = PROVIDERS[rec.provider];
    if (!rec.model) throw fail('no_model');
    const ask1 = (plain) => ask(rec, p.chat, { method: 'POST', body: JSON.stringify(p.body({ system: String(q.system || ''), messages: q.messages, max: q.max }, rec.model, plain)) }, signal);
    const extra = !!p.usage && !rec.plain; // pedir el uso con stream_options
    let got;
    try { got = await ask1(!extra); } catch (e) {
      // Un servidor que rechaza lo que no conoce: el pedido va de nuevo sin el dato opcional, y queda anotado.
      if (!extra || (e.status !== 400 && e.status !== 422)) throw e;
      got = await ask1(true);
      try { const now = await get(); if (now && now.provider === rec.provider && now.data === rec.data) { now.plain = true; await put(now, others(now)); } } catch (x) { /* la próxima vez prueba de nuevo */ }
    }
    const res = got[0]; const hide = got[1];
    const acc = { input: null, output: null, stop: 'end' }; let text = '';
    const filter = p.think ? noThink() : null;
    const out = (piece, end) => { const t = filter ? filter(piece, end) : piece; if (t) { text += t; if (onDelta) onDelta(t); } };
    const done = () => { out('', true); return { text, usage: { input: acc.input, output: acc.output }, stop: acc.stop, model: rec.model }; };
    // Lo que el proveedor diga en un error no lleva la clave, por si la repite.
    const safe = (fn) => { try { return fn(); } catch (e) { if (e && typeof e.code === 'string' && e.detail) e.detail = hide(e.detail); throw e; } };
    // Sin tramos: la respuesta llegó entera, o es un error con estado 200.
    if (/json/i.test(res.headers.get('content-type') || '')) {
      let j = null; try { j = JSON.parse((await res.text()).slice(0, 4e6)); } catch (e) { /* vacío */ }
      safe(() => { if (j && !Array.isArray(j)) p.read(j, acc); });
      const whole = p.whole(Array.isArray(j) ? null : j);
      if (whole == null) throw fail('server', hide(errText(j)), res.status);
      out(whole);
      return done();
    }
    const take = (data) => {
      if (!data || data === '[DONE]') return;
      let j; try { j = JSON.parse(data); } catch (e) { return; }
      if (!j || typeof j !== 'object') return;
      if (Array.isArray(j)) { const t = errText(j); if (t) throw fail('server', t); return; }
      out(p.read(j, acc));
    };
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    try {
      for (;;) {
        const r = await reader.read();
        buf += dec.decode(r.value || new Uint8Array(0), { stream: !r.done });
        const events = buf.split(/\r?\n\r?\n/); buf = r.done ? '' : events.pop();
        for (const ev of events) safe(() => take(ev.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n')));
        if (r.done) break;
      }
    } catch (e) {
      try { Promise.resolve(reader.cancel()).catch(() => {}); } catch (x) { /* ya cortado */ }
      if (e && typeof e.code === 'string' && !(e instanceof root.DOMException)) throw e;
      throw fail(signal && signal.aborted ? 'aborted' : 'network');
    }
    return done();
  }

  LMD.ai = { PROVIDERS, cleanBase, supported, status, save, use, remove, setModel, unlock, setLock, models, stream };

  // ---------- En el service worker de la extensión: atender a los .md del disco ----------
  if (!PAGE && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onConnect) {
    const OPS = { status: () => status(), save: (a) => save(a), use: (a) => use(a.provider), remove: (a) => remove(a.provider), setModel: (a) => setModel(a.model), unlock: (a) => unlock(a.password), setLock: (a) => setLock(a.password), models: () => models() };
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
