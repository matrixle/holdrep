/* Service Worker：离线缓存。更新应用文件后请递增 VERSION。 */
const VERSION = 'holdrep-v6';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css', 'js/config.js', 'js/detectors.js', 'js/db.js', 'js/models.js', 'js/app.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'vendor/tf.min.js', 'vendor/pose.min.js',
  'vendor/movenet/model.json', 'vendor/movenet/group1-shard1of2.bin', 'vendor/movenet/group1-shard2of2.bin',
  'vendor/movenet-thunder/model.json', 'vendor/movenet-thunder/group1-shard1of3.bin',
  'vendor/movenet-thunder/group1-shard2of3.bin', 'vendor/movenet-thunder/group1-shard3of3.bin',
  'vendor/mediapipe/vision_bundle.mjs', 'vendor/mediapipe/pose_landmarker_full.task',
  'vendor/mediapipe/wasm/vision_wasm_internal.js', 'vendor/mediapipe/wasm/vision_wasm_internal.wasm',
  'vendor/mediapipe/wasm/vision_wasm_module_internal.js', 'vendor/mediapipe/wasm/vision_wasm_module_internal.wasm',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isVendor = req.url.includes('/vendor/');
  e.respondWith(
    caches.open(VERSION).then(async cache => {
      const hit = await cache.match(req, { ignoreSearch: true });
      // vendor 大文件：缓存优先；其余：先用缓存、后台更新
      const net = () => fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); return r; });
      if (hit) { if (!isVendor) net().catch(() => {}); return hit; }
      try { return await net(); }
      catch (err) {
        if (req.mode === 'navigate') return cache.match('index.html');
        throw err;
      }
    })
  );
});
