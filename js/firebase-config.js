// Central Firebase setup. Every other JS file imports what it needs from here,
// so we only initialize Firebase once for the whole app.
//
// A note on these values: this config identifies WHICH Firebase project your
// app talks to. It is not a secret — it's normal and expected for it to be
// visible in your app's public JavaScript. Your actual security comes from
// the Firestore security rules we'll write later (those decide who can read
// or write what), not from hiding this config.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getMessaging, isSupported } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js';

const firebaseConfig = {
  apiKey: "AIzaSyBw2rVTPu1l4TfNfhvHWr1esdsOzGLx16w",
  authDomain: "familysos-prod.firebaseapp.com",
  projectId: "familysos-prod",
  storageBucket: "familysos-prod.firebasestorage.app",
  messagingSenderId: "79487156837",
  appId: "1:79487156837:web:5747fddab882d144f2bc8c"
};

// The VAPID key authorizes this app specifically to request push notifications.
// We'll use this in a later screen when we wire up Cloud Messaging.
export const VAPID_KEY = "BD0t3Dx3PCukhN6ZguqKFYAy3QfifHvtxbKtSNLRIi6uS8P-v2bIimbvZ5iK-VRntyiN4eGxR3ly3ovhRmpg8D8";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Messaging isn't supported in every browser context (e.g. some private
// browsing modes), so we guard it rather than letting it crash the app.
export const messagingPromise = isSupported().then((supported) =>
  supported ? getMessaging(app) : null
);
