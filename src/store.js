// Permisos de archivos y carpetas (File System Access), guardados en IndexedDB para no volver a pedirlos.
(function () {
  'use strict';

  function handlesDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('lmd-permisos', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('h', { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function handlesAll() {
    try {
      const db = await handlesDb();
      return await new Promise((resolve, reject) => {
        const q = db.transaction('h').objectStore('h').getAll();
        q.onsuccess = () => resolve(q.result || []); q.onerror = () => reject(q.error);
      });
    } catch (e) { return []; }
  }
  async function handlesGet(key) {
    try {
      const db = await handlesDb();
      return await new Promise((resolve, reject) => {
        const q = db.transaction('h').objectStore('h').get(key);
        q.onsuccess = () => resolve(q.result || null); q.onerror = () => reject(q.error);
      });
    } catch (e) { return null; }
  }
  async function handlesPut(rec) {
    try {
      const db = await handlesDb();
      await new Promise((resolve, reject) => {
        const t = db.transaction('h', 'readwrite'); t.objectStore('h').put(rec);
        t.oncomplete = resolve; t.onerror = () => reject(t.error);
      });
      return true;
    } catch (e) { return false; }
  }

  async function canWrite(handle, ask) {
    try {
      if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
      if (!ask) return false;
      return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
    } catch (e) { return false; }
  }

  async function walk(dir, parts) {
    let cur = dir;
    for (let k = 0; k < parts.length - 1; k++) cur = await cur.getDirectoryHandle(parts[k]);
    return cur.getFileHandle(parts[parts.length - 1]);
  }

  async function handlesDelete(key) {
    try {
      const db = await handlesDb();
      await new Promise((resolve) => { const t = db.transaction('h', 'readwrite'); t.objectStore('h').delete(key); t.oncomplete = resolve; t.onerror = resolve; });
    } catch (e) { /* queda guardado */ }
  }

  // Lo abierto desde la página propia: carpetas y archivos recientes, del más nuevo al más viejo.
  const rootsAll = async () => (await handlesAll()).filter((r) => r.root).sort((a, b) => (b.at || 0) - (a.at || 0));

  // Notas guardadas en el navegador: no necesitan carpeta ni cuenta, y siguen ahí al cerrar la pestaña.
  const noteKey = (name) => 'note:' + name;
  const notesAll = async () => (await handlesAll()).filter((r) => r.note).sort((a, b) => (b.at || 0) - (a.at || 0));
  const noteGet = async (name) => (await handlesAll()).find((r) => r.note && r.name === name) || null;
  const notePut = (name, text) => handlesPut({ key: noteKey(name), note: true, name, text, at: Date.now() });
  const noteDelete = (name) => handlesDelete(noteKey(name));
  // Se comporta como un archivo del disco, para que leer y guardar pasen por el mismo camino.
  function noteHandle(name) {
    return {
      kind: 'file', name,
      queryPermission: async () => 'granted',
      getFile: async () => { const r = await noteGet(name); if (!r) throw new Error('missing'); return { text: async () => r.text, lastModified: r.at, size: r.text.length }; },
      createWritable: async () => { let data = ''; return { write: async (t) => { data = String(t); }, close: async () => { await notePut(name, data); } }; },
    };
  }

  // Copia de cada nota de la nube que se abrió o se guardó, por cuenta, para abrirla sin conexión.
  // text es lo último escrito acá, base lo último que se supo del servidor, y pending marca lo que falta subir.
  const cloudKey = (who, path) => 'cloud:' + who + ':' + path;
  const cloudAll = async (who) => (await handlesAll()).filter((r) => r.cloud && r.who === who);
  const cloudGet = (who, path) => handlesGet(cloudKey(who, path));
  const cloudPut = (who, path, rec) => handlesPut(Object.assign({}, rec, { key: cloudKey(who, path), cloud: true, who, path, at: Date.now() }));
  const cloudDelete = (who, path) => handlesDelete(cloudKey(who, path));

  // Carpetas con contraseña de la nube. Lo que el servidor sabe de cada una (para poder abrirlas sin conexión) y,
  // si la persona eligió "Recordar en este dispositivo", la llave de cifrado: una CryptoKey que no se puede exportar.
  const vaultsGet = async (who) => { const r = await handlesGet('vaults:' + who); return r ? r.list : null; };
  const vaultsPut = (who, list) => handlesPut({ key: 'vaults:' + who, vaults: true, who, list });
  const vkeyKey = (who, check) => 'vkey:' + who + ':' + check;
  const vkeyGet = async (who, check) => { const r = await handlesGet(vkeyKey(who, check)); return r ? r.cryptoKey : null; };
  const vkeyPut = (who, check, cryptoKey) => handlesPut({ key: vkeyKey(who, check), vkey: true, who, cryptoKey });
  const vkeyDelete = (who, check) => handlesDelete(vkeyKey(who, check));
  const vkeyClear = async (who) => { for (const r of await handlesAll()) if ((r.vkey || r.vaults) && r.who === who) await handlesDelete(r.key); };

  LMD.store = { handlesAll, handlesPut, handlesDelete, canWrite, walk, rootsAll, notesAll, noteGet, notePut, noteDelete, noteHandle, cloudAll, cloudGet, cloudPut, cloudDelete, vaultsGet, vaultsPut, vkeyGet, vkeyPut, vkeyDelete, vkeyClear };
})();
