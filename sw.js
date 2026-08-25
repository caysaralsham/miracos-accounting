// Service worker — يخزن شكل التطبيق (الصفحة + الأيقونات + مكتبات Firebase) محليًا
// باش يفتح البرنامج حتى بلا نت خالص. البيانات المالية نفسها ما تتخزنش هنا —
// هذي مسؤولية Firestore offline persistence (مفعّلة من كود التطبيق نفسه).

const CACHE_NAME = 'miracos-cache-v3';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((err) => console.warn('SW: تعذر تخزين بعض الملفات مسبقًا', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') {
    event.respondWith(fetch(req));
    return;
  }

  const isHTMLPage = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isHTMLPage) {
    // الصفحة الرئيسية: نوريك النسخة المخزنة فورًا (بلا ما نستنى النت حتى لو بطيء)،
    // وبنفس الوقت نجيب نسخة جديدة من النت في الخلفية ونحدث الكاش بيها للمرة الجاية.
    event.respondWith(
      caches.match(req).then((cached) => {
        const networkUpdate = fetch(req).then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        }).catch(() => null);
        return cached || networkUpdate || caches.match('./index.html');
      })
    );
    return;
  }

  // باقي الملفات (أيقونات، مكتبات فايربيز...): من الكاش أول لو موجودة (أسرع وتخدم بلا نت)،
  // وإلا من الشبكة مع تحديث الكاش للمرة الجاية.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      });
    })
  );
});
