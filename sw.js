// 「log」service worker
// 役割は2つだけ。
//   1. オフラインでも開けるようにファイルを持っておく
//   2. LINEからの共有(POST)を、端末の外に出さずに受け取る
//
// 共有をPOSTにしているのは意図的です。GETだと共有された本文がURLに乗り、
// GitHubのサーバーにリクエストとして届いてしまう。POSTをここで横取りすれば、
// 本文は一度も通信に乗らず、端末の中だけで完結します。

const CACHE = 'ichiran-v1';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// --- 共有を受け取るための最小限のIndexedDB ---
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ichiran', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function putPending(text) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ k: 'pending', text: text, at: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (e.request.method === 'POST' && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      try {
        const fd = await e.request.formData();
        const text = (fd.get('text') || fd.get('title') || fd.get('url') || '').toString();
        await putPending(text);
      } catch (err) {
        // 受け取れなかった場合も、アプリは開く。貼り付けで入れられる。
      }
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }

  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});
