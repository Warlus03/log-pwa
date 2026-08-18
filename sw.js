// 「log」service worker
// 役割は3つ。
//   1. 本体は毎回ネットを先に見る（上げ直したらすぐ反映されるように）
//   2. 圏外でも開けるように、控えを持っておく
//   3. LINEからの共有(POST)を、端末の外に出さずに受け取る
//
// 共有をPOSTにしているのは意図的です。GETだと共有された本文がURLに乗り、
// GitHubのサーバーにリクエストとして届いてしまう。POSTをここで横取りすれば、
// 本文は一度も通信に乗らず、端末の中だけで完結します。

const CACHE = 'log-v2';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ASSETS.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
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

  // 共有された本文を受け取る
  if (e.request.method === 'POST' && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      try {
        const fd = await e.request.formData();
        const text = (fd.get('text') || fd.get('title') || fd.get('url') || '').toString();
        await putPending(text);
      } catch (err) {
        // 受け取れなかった場合もアプリは開く。貼り付けで入れられる。
      }
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }

  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  const isPage = e.request.mode === 'navigate' || /\.(html|json|js)$/.test(url.pathname) || url.pathname.endsWith('/');

  if (isPage) {
    // 本体は新しいものを取りに行く。取れなければ控えを出す。
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // 画像などは控えを先に出す（変わらないので）
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
