// This file MUST be named exactly "firebase-messaging-sw.js" and live at the
// site root — Firebase looks for it there automatically when registering for
// push notifications. It runs separately from our main app code and is only
// responsible for one job: showing a notification when an SOS alert arrives
// while the app is closed or in the background.
//
// Note: this file uses Firebase's older "compat" syntax (importScripts),
// not the modern modular syntax we use everywhere else in the app. That's
// intentional, not a mistake — as of today, Firebase's own documentation
// still recommends compat syntax specifically inside a background service
// worker, because of how service workers load scripts differently from
// normal web pages.

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Same config as our main app — safe to duplicate here, it's not a secret.
firebase.initializeApp({
  apiKey: "AIzaSyBw2rVTPu1l4TfNfhvHWr1esdsOzGLx16w",
  authDomain: "familysos-prod.firebaseapp.com",
  projectId: "familysos-prod",
  storageBucket: "familysos-prod.firebasestorage.app",
  messagingSenderId: "79487156837",
  appId: "1:79487156837:web:5747fddab882d144f2bc8c"
});

const messaging = firebase.messaging();

// Show a notification when a push arrives and the app isn't in the foreground.
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'FamilySOS Alert';
  const options = {
    body: payload.notification?.body || 'A family member needs you.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    // Vibration pattern to make sure this doesn't get missed — short-long-short.
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: true, // stays on screen until the person interacts with it
    data: payload.data
  };
  self.registration.showNotification(title, options);
});

// When the person taps the notification, open (or focus) the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
