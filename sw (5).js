/* ══════════════════════════════════════════════════
   CardioLog — sw.js
   Service Worker : cache offline + rappels quotidiens
   ══════════════════════════════════════════════════ */

const CACHE_NAME = 'cardiolog-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Nunito:wght@300;400;500;600;700;800&display=swap',
  'https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore-compat.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
];

// ── INSTALL ───────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(console.warn)
  );
  self.skipWaiting();
});

// ── ACTIVATE ──────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── FETCH (offline-first for app shell) ───────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Network-first for Firestore / Firebase APIs
  if (url.hostname.includes('firebase') || url.hostname.includes('googleapis.com') && url.pathname.includes('/v1/')) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(resp => {
        if (resp && resp.status === 200 && event.request.method === 'GET') {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return resp;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

// ── REMINDER SCHEDULING ───────────────────────────
// The SW keeps reminder times in its own storage and fires notifications
// at the right time using a periodic-check approach via Background Sync fallback

let reminders = { morning: '08:00', evening: '20:00' };

// Receive settings from main thread
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SET_REMINDERS') {
    reminders.morning = event.data.morning || '08:00';
    reminders.evening = event.data.evening || '20:00';

    // Try to register periodic sync (requires permission on Android Chrome)
    if ('periodicSync' in self.registration) {
      self.registration.periodicSync.register('bp-reminder', {
        minInterval: 6 * 60 * 60 * 1000 // check every 6h
      }).catch(() => {});
    }

    // Also schedule via alarm-like setTimeout check
    scheduleNextNotification();
  }
});

function scheduleNextNotification() {
  const now   = new Date();
  const slots = [reminders.morning, reminders.evening];
  let nextMs  = Infinity;

  slots.forEach(t => {
    const [h, m] = t.split(':').map(Number);
    let target = new Date(now);
    target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1); // tomorrow
    const diff = target - now;
    if (diff < nextMs) nextMs = diff;
  });

  if (nextMs < Infinity) {
    setTimeout(fireReminder, nextMs);
  }
}

async function fireReminder() {
  const now    = new Date();
  const h      = now.getHours();
  const period = h < 14 ? 'matin' : 'soir';
  const emoji  = h < 14 ? '🌅' : '🌙';

  self.registration.showNotification(`${emoji} Rappel CardioLog`, {
    body:    `Pensez à prendre votre tension du ${period} — 2 mesures.`,
    icon:    './icons/icon-192.png',
    badge:   './icons/icon-192.png',
    tag:     `bp-${period}`,
    renotify: false,
    actions: [{ action: 'open', title: 'Ouvrir l\'app' }],
  });

  // Schedule next
  scheduleNextNotification();
}

// ── PERIODIC SYNC (Android Chrome) ────────────────
self.addEventListener('periodicsync', event => {
  if (event.tag === 'bp-reminder') {
    event.waitUntil(checkAndNotify());
  }
});

async function checkAndNotify() {
  const now    = new Date();
  const hhmm   = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const period = now.getHours() < 14 ? 'matin' : 'soir';
  const emoji  = now.getHours() < 14 ? '🌅' : '🌙';

  const inWindow = (target) => {
    const [th, tm] = target.split(':').map(Number);
    const tMin = th * 60 + tm;
    const nMin = now.getHours() * 60 + now.getMinutes();
    return Math.abs(nMin - tMin) <= 30; // 30min window
  };

  if (inWindow(reminders.morning) || inWindow(reminders.evening)) {
    self.registration.showNotification(`${emoji} Rappel CardioLog`, {
      body:  `N'oubliez pas la mesure du ${period} !`,
      icon:  './icons/icon-192.png',
      tag:   `bp-${period}-${new Date().toISOString().split('T')[0]}`,
      renotify: false,
    });
  }
}

// ── NOTIFICATION CLICK ────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length > 0) {
        clients[0].focus();
      } else {
        self.clients.openWindow('./');
      }
    })
  );
});
