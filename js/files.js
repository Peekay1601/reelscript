/*
 * ReelScript — saving to the computer + draft history
 *  - Linked files: File System Access API (Chrome, Edge, Brave, Opera on desktop).
 *    "Save as…" lets the writer pick the folder and name; afterwards Save and the
 *    once-a-minute autosave write straight into that file.
 *  - Drafts: every minute a snapshot of each changed script goes to IndexedDB
 *    (last 100 per script) so earlier versions can be restored.
 */
(function (root) {
  'use strict';

  const SF = (root.SF = root.SF || {});
  const DB_NAME = 'reelscript-files';
  const MAX_DRAFTS = 100;

  const canPickFiles = () => typeof root.showSaveFilePicker === 'function' && typeof root.showOpenFilePicker === 'function';

  // ---------------------------------------------------------------------------
  // Tiny IndexedDB helper
  // ---------------------------------------------------------------------------
  let dbPromise = null;
  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('handles')) d.createObjectStore('handles');
        if (!d.objectStoreNames.contains('drafts')) {
          const s = d.createObjectStore('drafts', { keyPath: 'id', autoIncrement: true });
          s.createIndex('script', 'scriptId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      Promise.resolve(fn(s)).then((r) => (result = r));
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  const reqP = (r) => new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

  // ---------------------------------------------------------------------------
  // Drafts (version history)
  // ---------------------------------------------------------------------------
  async function addDraft(script) {
    const words = (SF.plainText(script.content).match(/\S+/g) || []).length;
    await tx('drafts', 'readwrite', (s) => s.add({ scriptId: script.id, name: script.name, content: script.content, words, at: Date.now() }));
    // prune to the newest MAX_DRAFTS for this script (keys ascend, oldest first)
    const keys = await tx('drafts', 'readonly', (s) => reqP(s.index('script').getAllKeys(script.id)));
    if (keys && keys.length > MAX_DRAFTS) {
      const extra = keys.slice(0, keys.length - MAX_DRAFTS);
      await tx('drafts', 'readwrite', (s) => extra.forEach((k) => s.delete(k)));
    }
  }

  /** The newest draft of a script without loading the others */
  async function latestDraft(scriptId) {
    return tx('drafts', 'readonly', (s) => reqP(s.index('script').openCursor(IDBKeyRange.only(scriptId), 'prev')).then((c) => (c ? c.value : null)));
  }

  /** Newest first */
  async function listDrafts(scriptId) {
    const rows = await tx('drafts', 'readonly', (s) => reqP(s.index('script').getAll(scriptId)));
    return (rows || []).sort((a, b) => b.at - a.at);
  }

  async function deleteDrafts(scriptId) {
    const all = await listDrafts(scriptId);
    await tx('drafts', 'readwrite', (s) => all.forEach((d) => s.delete(d.id)));
  }

  // ---------------------------------------------------------------------------
  // Linked files
  // ---------------------------------------------------------------------------
  const memHandles = new Map(); // scriptId → handle (also persisted to IndexedDB when possible)

  async function getHandle(scriptId) {
    if (memHandles.has(scriptId)) return memHandles.get(scriptId);
    try {
      const h = await tx('handles', 'readonly', (s) => reqP(s.get(scriptId)));
      if (h) memHandles.set(scriptId, h);
      return h || null;
    } catch (e) {
      return null;
    }
  }

  async function setHandle(scriptId, handle) {
    memHandles.set(scriptId, handle);
    try {
      await tx('handles', 'readwrite', (s) => s.put(handle, scriptId));
    } catch (e) {
      /* handle not storable (e.g. old browser) — kept for this session only */
    }
  }

  async function removeHandle(scriptId) {
    memHandles.delete(scriptId);
    try {
      await tx('handles', 'readwrite', (s) => s.delete(scriptId));
    } catch (e) {
      /* ignore */
    }
  }

  /** Can we write to this handle without asking? ask=true prompts (needs a click). */
  async function hasPermission(handle, ask) {
    if (!handle) return false;
    if (typeof handle.queryPermission !== 'function') return true;
    try {
      if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
      if (ask && (await handle.requestPermission({ mode: 'readwrite' })) === 'granted') return true;
    } catch (e) {
      /* ignore */
    }
    return false;
  }

  const SAVE_TYPES = [
    { description: 'Fountain screenplay (recommended — keeps everything)', accept: { 'text/plain': ['.fountain'] } },
    { description: 'Final Draft', accept: { 'application/xml': ['.fdx'] } },
    { description: 'Highland 2', accept: { 'application/zip': ['.highland'] } },
    { description: 'Fade In', accept: { 'application/zip': ['.fadein'] } },
    { description: 'Trelby', accept: { 'text/plain': ['.trelby'] } },
    { description: 'Celtx', accept: { 'application/zip': ['.celtx'] } },
  ];
  const OPEN_TYPES = [{ description: 'Screenplays', accept: { 'text/plain': ['.fountain', '.txt', '.md'], 'application/xml': ['.fdx'], 'application/zip': ['.highland', '.fadein', '.celtx'], 'application/octet-stream': ['.trelby'], 'application/pdf': ['.pdf'] } }];
  // Files opened from the computer that Save may write straight back into. Other formats
  // (Final Draft, Highland…) open as a copy so their app-only details are never overwritten.
  const WRITE_BACK = /\.(fountain|spmd|txt)$/i;

  const extOf = (name) => ((/\.([^.]+)$/.exec(name || '') || [])[1] || 'fountain').toLowerCase();

  /** Script → bytes/text in the format the file name asks for */
  function serialize(script, fileName) {
    const ext = extOf(fileName);
    switch (ext) {
      case 'fdx':
        return SF.toFDX(script.content, script.settings);
      case 'highland':
        return SF.toHighland(script.content, script.name);
      case 'fadein':
        return SF.toFadeIn(script.content, script.name);
      case 'trelby':
        return SF.toTrelby(script.content);
      case 'celtx':
        return SF.toCeltx(script.content, script.name);
      default:
        return script.content;
    }
  }

  async function writeFile(handle, script) {
    const w = await handle.createWritable();
    await w.write(serialize(script, handle.name));
    await w.close();
  }

  const safeName = (s) => ((s || 'Screenplay').trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'Screenplay');

  /** Ask where to save; returns the handle (or null if cancelled). */
  async function pickSaveLocation(script, preferredExt) {
    const ext = preferredExt || 'fountain';
    const types = [...SAVE_TYPES].sort((a, b) => (Object.values(b.accept)[0][0] === '.' + ext) - (Object.values(a.accept)[0][0] === '.' + ext));
    try {
      return await root.showSaveFilePicker({ suggestedName: `${safeName(script.name)}.${ext}`, types, id: 'reelscript-save' });
    } catch (e) {
      if (e && e.name === 'AbortError') return null;
      throw e;
    }
  }

  async function pickOpenFile() {
    try {
      const [h] = await root.showOpenFilePicker({ types: OPEN_TYPES, multiple: false, id: 'reelscript-open' });
      return h || null;
    } catch (e) {
      if (e && e.name === 'AbortError') return null;
      throw e;
    }
  }

  SF.Files = { canPickFiles, addDraft, listDrafts, deleteDrafts, getHandle, setHandle, removeHandle, hasPermission, writeFile, pickSaveLocation, pickOpenFile, serialize, extOf, latestDraft, canWriteBack: (name) => WRITE_BACK.test(name || ''), MAX_DRAFTS };
})(typeof window !== 'undefined' ? window : globalThis);
