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

  LMD.store = { handlesAll, handlesPut, handlesDelete, canWrite, walk, rootsAll };
})();
