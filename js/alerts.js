// Handles everything data-related for the Active Alert screen: watching
// for the family's most recent alert in real time, fetching the family's
// member roster (so we can show "not yet seen" for people who haven't
// acknowledged), and writing acknowledgment / resolve actions.

import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase-config.js';

/**
 * Live-watches a family's alerts and reports back the SINGLE most recent
 * one (by createdAt), whatever its status. Reporting the most recent
 * regardless of status (not just "active" ones) is what lets the UI show a
 * "Resolved" confirmation moment right after someone taps "I'm Safe",
 * instead of the alert screen just vanishing the instant it's resolved.
 *
 * Note: this fetches the whole alerts subcollection rather than using a
 * limit()/orderBy() query, to avoid needing a Firestore composite index for
 * Phase 1. Fine at this scale (a handful of alerts a year for one family) —
 * worth revisiting with a proper indexed query if this were ever scaled to
 * many families or years of history.
 */
export function watchLatestAlert(familyId, callback) {
  const q = query(collection(db, 'families', familyId, 'alerts'));
  return onSnapshot(q, (snap) => {
    if (snap.empty) {
      callback(null);
      return;
    }
    let latest = null;
    snap.forEach((docSnap) => {
      const data = { id: docSnap.id, ...docSnap.data() };

      if (!latest) {
        latest = data;
        return;
      }

      // An active alert always wins over a resolved one, no matter how the
      // timestamps compare — there should only ever be one active alert at
      // a time, and it's always the most relevant thing to show.
      if (data.status === 'active' && latest.status !== 'active') {
        latest = data;
        return;
      }
      if (data.status !== 'active' && latest.status === 'active') {
        return; // keep the existing active one
      }

      // Otherwise, compare by creation time. A brand-new alert's timestamp
      // is briefly blank (serverTimestamp() hasn't been filled in by
      // Firebase's servers yet) — treat that as "just now" rather than
      // "unknown/old", since a just-created doc is by definition the
      // newest thing that could exist.
      const t = data.createdAt ? data.createdAt.toMillis() : Date.now();
      const latestT = latest.createdAt ? latest.createdAt.toMillis() : Date.now();
      if (t >= latestT) latest = data;
    });
    callback(latest);
  });
}

/**
 * One-time fetch of everyone in a family (uid + displayName). Used to show
 * every member's row on the Active Alert screen, including people who
 * haven't acknowledged yet.
 */
export async function fetchFamilyMembers(familyId) {
  const q = query(collection(db, 'users'), where('familyId', '==', familyId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

/** Records "Seen" or "On my way" for the calling user on a specific alert. */
export async function acknowledgeAlert(familyId, alertId, uid, status) {
  await updateDoc(doc(db, 'families', familyId, 'alerts', alertId), {
    [`acknowledgments.${uid}`]: { status, timestamp: serverTimestamp() }
  });
}

/** Ends the alert for everyone. Anyone in the family may call this. */
export async function resolveAlert(familyId, alertId, uid) {
  await updateDoc(doc(db, 'families', familyId, 'alerts', alertId), {
    status: 'resolved',
    resolvedBy: uid,
    resolvedAt: serverTimestamp()
  });
}
