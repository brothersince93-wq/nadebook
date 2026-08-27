/* ============================================================
   db.js - stockage local (IndexedDB)
   Deux magasins :
     lineups : les fiches   { id, map, side, type, ... , media:[...] }
     media   : les fichiers { id, blob, mime }
   Rien ne part sur Internet : tout reste sur l'appareil.
   ============================================================ */

const DB = (() => {
  const NAME = 'nadebook';
  const VERSION = 1;
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('lineups')) {
          const s = db.createObjectStore('lineups', { keyPath: 'id' });
          s.createIndex('map', 'map', { unique: false });
        }
        if (!db.objectStoreNames.contains('media')) {
          db.createObjectStore('media', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        _db = req.result;

        // Sans ces deux gardes, une connexion devenue morte (base supprimee,
        // ou autre onglet qui change la version) reste en cache : les
        // transactions suivantes se bloquent en silence, sans jamais finir.
        _db.onversionchange = () => { try { _db.close(); } catch {} _db = null; };
        _db.onclose = () => { _db = null; };

        resolve(_db);
      };
      req.onerror   = () => reject(req.error);
      req.onblocked = () => reject(new Error('Base bloquee par un autre onglet — ferme les autres onglets de l\'app.'));
    });
  }

  /** Ouvre une transaction et resout avec son resultat.
   *  Si la connexion est morte, on la lache et on reessaie une fois. */
  function tx(store, mode, fn, retry = true) {
    return open().then(db => new Promise((resolve, reject) => {
      let t;
      try {
        t = db.transaction(store, mode);
      } catch (e) {
        _db = null;                                  // connexion inutilisable
        return retry ? resolve(tx(store, mode, fn, false)) : reject(e);
      }
      const s = t.objectStore(store);
      let out;
      const r = fn(s);
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => resolve(out);
      t.onerror    = () => reject(t.error);
      t.onabort    = () => reject(t.error || new Error('transaction interrompue'));
    }));
  }

  /* ---------------- lineups ---------------- */

  const allLineups  = ()   => tx('lineups', 'readonly',  s => s.getAll());
  const getLineup   = (id) => tx('lineups', 'readonly',  s => s.get(id));
  const putLineup   = (o)  => tx('lineups', 'readwrite', s => s.put(o));

  async function deleteLineup(id) {
    const lu = await getLineup(id);
    if (lu) {
      // on nettoie aussi les fichiers rattaches, sinon ils occupent
      // de la place pour rien
      for (const m of lu.media || []) {
        if (m.blobId) await deleteMedia(m.blobId);
      }
      if (lu.poster) await deleteMedia(lu.poster);
    }
    return tx('lineups', 'readwrite', s => s.delete(id));
  }

  /* ---------------- media ---------------- */

  const putMedia    = (id, blob, mime) => tx('media', 'readwrite', s => s.put({ id, blob, mime }));
  const getMedia    = (id) => tx('media', 'readonly',  s => s.get(id));
  const deleteMedia = (id) => tx('media', 'readwrite', s => s.delete(id));
  const allMedia    = ()   => tx('media', 'readonly',  s => s.getAll());

  /* ---------------- divers ---------------- */

  async function clearAll() {
    await tx('lineups', 'readwrite', s => s.clear());
    await tx('media',   'readwrite', s => s.clear());
  }

  /**
   * Place reellement occupee par les medias.
   * navigator.storage.estimate() sous-declare largement les blobs
   * IndexedDB (vu : 0,1 Mo annonces pour 400 Mo stockes), donc on
   * additionne les tailles nous-memes. Le quota, lui, reste utile.
   */
  async function usage() {
    const media = await allMedia();
    const bytes = media.reduce((a, m) => a + (m.blob ? m.blob.size : 0), 0);

    let quota = null;
    if (navigator.storage && navigator.storage.estimate) {
      try { quota = (await navigator.storage.estimate()).quota || null; }
      catch { /* pas d'info de quota : on affichera juste la taille */ }
    }
    return { bytes, count: media.length, quota };
  }

  return {
    open, allLineups, getLineup, putLineup, deleteLineup,
    putMedia, getMedia, deleteMedia, allMedia,
    clearAll, usage
  };
})();
