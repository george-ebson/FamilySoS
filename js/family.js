// Handles: creating a new family (with a generated invite code), looking up
// a family by an invite code, and joining a family.

import {
  doc,
  collection,
  getDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
  arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, auth } from './firebase-config.js';

// Characters chosen to avoid visual mix-ups when someone reads a code aloud
// or types it under stress: no 0/O, no 1/I/L.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

function generateCode() {
  let code = '';
  const randomValues = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomValues[i] % CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Creates a new family, generates a unique invite code for it, and updates
 * the caller's own profile to point at the new family. All three writes
 * happen in one batch, so it's all-or-nothing — no risk of ending up with
 * a family but no invite code, or vice versa.
 */
export async function createFamily(familyName) {
  const uid = auth.currentUser.uid;
  const familyRef = doc(collection(db, 'families'));

  // Vanishingly unlikely to collide at this scale, but we check anyway
  // rather than assume — a silent collision would let two families share
  // one invite code, which is exactly the kind of privacy bug this app
  // can't afford.
  let code = generateCode();
  let attempts = 0;
  while (attempts < 5) {
    const existing = await getDoc(doc(db, 'inviteCodes', code));
    if (!existing.exists()) break;
    code = generateCode();
    attempts++;
  }

  const batch = writeBatch(db);

  batch.set(familyRef, {
    name: familyName,
    inviteCode: code,
    createdBy: uid,
    memberIds: [uid],
    createdAt: serverTimestamp()
  });

  batch.set(doc(db, 'inviteCodes', code), {
    familyId: familyRef.id,
    familyName: familyName
  });

  batch.update(doc(db, 'users', uid), {
    familyId: familyRef.id,
    familyName: familyName
  });

  await batch.commit();

  return { familyId: familyRef.id, inviteCode: code };
}

/**
 * Looks up an invite code. Returns { familyId, familyName } if it exists,
 * or null if the code is invalid. This is intentionally the ONLY thing a
 * person can learn about a family before joining it.
 */
export async function lookupInviteCode(rawCode) {
  const code = rawCode.trim().toUpperCase();
  const snap = await getDoc(doc(db, 'inviteCodes', code));
  if (!snap.exists()) return null;
  return { code, ...snap.data() };
}

/**
 * Joins a family: adds the caller's uid to the family's member list, and
 * points their profile at that family. Both writes happen in one batch.
 */
export async function joinFamily(familyId, familyName) {
  const uid = auth.currentUser.uid;
  const batch = writeBatch(db);

  batch.update(doc(db, 'families', familyId), {
    memberIds: arrayUnion(uid)
  });

  batch.update(doc(db, 'users', uid), {
    familyId: familyId,
    familyName: familyName
  });

  await batch.commit();
}
