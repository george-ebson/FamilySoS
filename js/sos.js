// Handles triggering an SOS alert: captures a ONE-TIME location snapshot
// (not continuous background tracking — matches the "location only shared
// in response to an explicit action" principle) and writes an alert record
// that family members will see on the Active Alert screen.

import {
  doc,
  collection,
  setDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, auth } from './firebase-config.js';

function getCurrentPositionOnce() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('GEOLOCATION_UNSUPPORTED'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 20000, // laptops using WiFi-based positioning can be slower than GPS-equipped phones
      maximumAge: 5000 // allow reusing a fix from the last 5s — still tied to this specific trigger, not background tracking
    });
  });
}

/**
 * Triggers an SOS alert for the given family. Captures the device's current
 * location ONCE, then writes a new alert document. Throws with a short
 * error code string on failure so the UI can show a specific message
 * (GEOLOCATION_DENIED, GEOLOCATION_UNSUPPORTED, GEOLOCATION_TIMEOUT, or the
 * original Firestore error for anything else).
 */
export async function triggerSOS({ familyId, uid, displayName }) {
  let position;
  try {
    position = await getCurrentPositionOnce();
  } catch (err) {
    if (err.code === 1) throw new Error('GEOLOCATION_DENIED');
    if (err.code === 3) throw new Error('GEOLOCATION_TIMEOUT');
    throw new Error('GEOLOCATION_UNSUPPORTED');
  }

  const alertRef = doc(collection(db, 'families', familyId, 'alerts'));

  await setDoc(alertRef, {
    triggeredBy: uid,
    triggeredByName: displayName,
    location: {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy
    },
    createdAt: serverTimestamp(),
    status: 'active',
    // Keyed by uid so each member's ack status is a single, easily-updated
    // field rather than growing an array (simpler security rules, and
    // avoids read-modify-write race conditions when multiple people tap
    // "Seen" around the same time).
    acknowledgments: {}
  });

  // Ask the server-side function to push a notification to everyone else
  // in the family. This is deliberately best-effort: the Firestore write
  // above is what actually matters (it's what the live in-app Active Alert
  // screen reacts to for anyone who has the app open) — a failure here
  // just means someone who doesn't have the app open right now might not
  // get pinged, which we log but don't let break the SOS trigger itself.
  try {
    const idToken = await auth.currentUser.getIdToken();
    await fetch('/.netlify/functions/send-alert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ familyId, alertId: alertRef.id })
    });
  } catch (err) {
    console.error('Could not send push notification (alert was still created successfully):', err);
  }

  return alertRef.id;
}
