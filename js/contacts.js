// Handles the family's shared Emergency Contacts list: a live-updating
// feed (so if one member adds a contact, everyone's list updates without a
// refresh — same pattern as the Active Alert screen), plus add/edit/delete.

import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase-config.js';

/**
 * Live-watches a family's emergency contacts. No orderBy() to avoid needing
 * a composite index for Phase 1 — the list is sorted client-side by name
 * instead, which is plenty fast at family-list scale (a handful of entries).
 */
export function watchContacts(familyId, callback) {
  const ref = collection(db, 'families', familyId, 'contacts');
  return onSnapshot(ref, (snap) => {
    const contacts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    contacts.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    callback(contacts);
  });
}

export async function addContact(familyId, { name, relationship, phone, addedBy }) {
  const ref = collection(db, 'families', familyId, 'contacts');
  await addDoc(ref, {
    name,
    relationship,
    phone,
    addedBy,
    createdAt: serverTimestamp()
  });
}

export async function updateContact(familyId, contactId, { name, relationship, phone }) {
  await updateDoc(doc(db, 'families', familyId, 'contacts', contactId), {
    name,
    relationship,
    phone
  });
}

export async function deleteContact(familyId, contactId) {
  await deleteDoc(doc(db, 'families', familyId, 'contacts', contactId));
}
