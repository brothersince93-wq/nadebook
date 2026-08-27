/* ============================================================
   sw.js - service worker

   Regle de conception, apprise a la dure : un service worker qui
   peut casser le chargement est pire que pas de service worker.
   Celui-ci ne renvoie JAMAIS de reponse vide, ne fait JAMAIS
   echouer une requete que le reseau aurait servie, et un fichier
   manquant au pre-cache n'annule pas les autres.

   Strategie : reseau d'abord, cache en secours.
     - toujours a jour (une mise en ligne est vue immediatement)
     - fonctionne hors ligne grace au cache de secours
   Les videos ne passent pas par ici : elles sont dans IndexedDB.
   ============================================================ */

const CACHE = 'nadebook-v3';

const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/db.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/** Chemins de travail sur PC : jamais interceptes. */
const skip = (url) => ['/tools/', '/data/', '/media/'].some(p => url.pathname.includes(p));

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Un par un, pas addAll : addAll est atomique, donc un seul fichier
    // absent laissait le cache entierement vide.
    await Promise.all(SHELL.map(async (u) => {
      try {
        const res = await fetch(u, { cache: 'reload' });
        if (res.ok) await cache.put(u, res);
      } catch { /* ce fichier sera simplement pris sur le reseau */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== location.origin) return;   // CDN, liens externes
  if (skip(url)) return;                        // outils PC

  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      // on ne met en cache que ce qui est reellement exploitable
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch {
      // hors ligne : on sert le cache
      const hit = await caches.match(req);
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      // dernier recours : une vraie reponse, jamais undefined
      return new Response('Hors ligne', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
