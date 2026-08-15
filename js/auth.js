// Handles account creation, login, logout, and keeping a matching profile
// document in Firestore for each signed-in user.

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc,
  setDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { auth, db } from './firebase-config.js';

/**
 * Creates a new account and a matching user profile document in Firestore.
 *
 * Data minimization note: we only store what Phase 1 actually needs —
 * name, email, and family membership. No birthdate, address, medical info,
 * etc. Phase 2+ features (e.g. medical info) should live in a SEPARATE
 * subcollection like users/{uid}/medical, not bolted onto this base profile —
 * that way stricter Firestore security rules can protect sensitive fields
 * independently, without touching this core record.
 */
export async function signUp(displayName, email, password) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const user = credential.user;

  await updateProfile(user, { displayName });

  await setDoc(doc(db, 'users', user.uid), {
    displayName,
    email,
    familyId: null,       // set once they create or join a family (next screen)
    role: 'adult',        // Phase 1 keeps this simple; only 'adult' exists for now
    fcmTokens: [],         // populated once push notifications are set up
    createdAt: serverTimestamp()
  });

  return user;
}

export async function logIn(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

export async function logOut() {
  await signOut(auth);
}

/**
 * Subscribes to auth state changes. Calls `callback(user)` immediately with
 * the current state, then again any time the person logs in or out.
 * Returns an unsubscribe function.
 */
export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

/**
 * Turns Firebase's raw error codes into plain-language messages, since
 * "Firebase: Error (auth/invalid-credential)" means nothing to most people.
 */
export function friendlyAuthError(error) {
  const map = {
    'auth/email-already-in-use': 'An account already exists with that email. Try logging in instead.',
    'auth/invalid-email': 'That doesn\'t look like a valid email address.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/user-not-found': 'No account found with that email.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.'
  };
  return map[error.code] || 'Something went wrong. Please try again.';
}
