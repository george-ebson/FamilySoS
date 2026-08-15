import { signUp, logIn, logOut, watchAuthState, friendlyAuthError } from './auth.js';
import { createFamily, lookupInviteCode, joinFamily } from './family.js';
import { triggerSOS } from './sos.js';
import { watchLatestAlert, fetchFamilyMembers, acknowledgeAlert, resolveAlert } from './alerts.js';
import { watchContacts, addContact, updateContact, deleteContact } from './contacts.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase-config.js';

// Tracks who's currently logged in and which family they're in, so the SOS
// button and Active Alert screen always have what they need without
// re-fetching it. Populated at login and kept in sync after create/join
// family. `members` is the family roster, fetched once per home session.
const session = { uid: null, displayName: null, familyId: null, familyName: null, members: [] };

// ---------- Service worker registration ----------
// Registers our app-shell service worker so the app can install and
// load offline. This is separate from firebase-messaging-sw.js, which
// Firebase registers itself later when we wire up push notifications.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Service worker registration failed:', err);
    });
  });
}

// ---------- Simple screen switcher ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
}

async function goToHome(familyId, familyName) {
  session.familyId = familyId;
  session.familyName = familyName;
  document.getElementById('home-family-name').textContent = familyName || 'Your Family';
  showScreen('screen-home');

  try {
    session.members = await fetchFamilyMembers(familyId);
  } catch (err) {
    console.error('Could not load family roster:', err);
    session.members = [];
  }

  startAlertWatcher(familyId);
  startContactsWatcher(familyId);
}

// ---------- Auth screen wiring ----------
const form = document.getElementById('auth-form');
const nameField = document.getElementById('field-name');
const nameInput = document.getElementById('input-name');
const emailInput = document.getElementById('input-email');
const passwordInput = document.getElementById('input-password');
const passwordHint = document.getElementById('password-hint');
const submitBtn = document.getElementById('auth-submit');
const errorBox = document.getElementById('auth-error');
const toggleBtn = document.getElementById('auth-toggle-btn');
const toggleText = document.getElementById('auth-toggle-text');
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');

let mode = 'login'; // or 'signup'

function setMode(newMode) {
  mode = newMode;
  clearError();

  if (mode === 'signup') {
    nameField.style.display = 'block';
    nameInput.required = true;
    passwordHint.style.display = 'block';
    passwordInput.autocomplete = 'new-password';
    submitBtn.textContent = 'Create account';
    authTitle.textContent = 'Create your family account';
    authSubtitle.textContent = 'This starts your private, invite-only space.';
    toggleText.textContent = 'Already have an account?';
    toggleBtn.textContent = 'Log in';
  } else {
    nameField.style.display = 'none';
    nameInput.required = false;
    passwordHint.style.display = 'none';
    passwordInput.autocomplete = 'current-password';
    submitBtn.textContent = 'Log in';
    authTitle.textContent = 'Welcome to FamilySOS';
    authSubtitle.textContent = 'Sign in to reach your family, fast.';
    toggleText.textContent = "Don't have an account?";
    toggleBtn.textContent = 'Sign up';
  }
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.add('visible');
}

function clearError() {
  errorBox.textContent = '';
  errorBox.classList.remove('visible');
}

toggleBtn.addEventListener('click', () => {
  setMode(mode === 'login' ? 'signup' : 'login');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  submitBtn.disabled = true;
  submitBtn.textContent = mode === 'signup' ? 'Creating account…' : 'Logging in…';

  try {
    if (mode === 'signup') {
      await signUp(nameInput.value.trim(), emailInput.value.trim(), passwordInput.value);
    } else {
      await logIn(emailInput.value.trim(), passwordInput.value);
    }
    // No need to manually switch screens here — watchAuthState below
    // reacts to the login automatically.
  } catch (err) {
    console.error(err);
    showError(friendlyAuthError(err));
    submitBtn.disabled = false;
    setMode(mode); // resets button label
  }
});

document.getElementById('home-logout').addEventListener('click', async () => {
  await logOut();
});

// ---------- Create / Join Family screen wiring ----------
const familyModes = ['choice', 'create', 'created', 'join', 'confirm'];

function showFamilyMode(name) {
  familyModes.forEach((m) => {
    document.getElementById(`family-mode-${m}`).style.display = m === name ? 'block' : 'none';
  });
}

document.getElementById('btn-show-create').addEventListener('click', () => showFamilyMode('create'));
document.getElementById('btn-show-join').addEventListener('click', () => showFamilyMode('join'));
document.getElementById('create-back').addEventListener('click', () => showFamilyMode('choice'));
document.getElementById('join-back').addEventListener('click', () => showFamilyMode('choice'));

// -- Create a family --
const createForm = document.getElementById('create-form');
const createError = document.getElementById('create-error');
const createSubmit = document.getElementById('create-submit');
let createdFamilyId = null;
let createdFamilyName = null;

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  createError.classList.remove('visible');
  createSubmit.disabled = true;
  createSubmit.textContent = 'Creating…';

  try {
    const name = document.getElementById('input-family-name').value.trim();
    const { familyId, inviteCode } = await createFamily(name);
    document.getElementById('invite-code-text').textContent = inviteCode;
    createdFamilyId = familyId;
    createdFamilyName = name;
    showFamilyMode('created');
  } catch (err) {
    console.error(err);
    createError.textContent = 'Something went wrong creating your family. Please try again.';
    createError.classList.add('visible');
  } finally {
    createSubmit.disabled = false;
    createSubmit.textContent = 'Create family';
  }
});

document.getElementById('btn-copy-code').addEventListener('click', async () => {
  const code = document.getElementById('invite-code-text').textContent;
  const btn = document.getElementById('btn-copy-code');
  try {
    await navigator.clipboard.writeText(code);
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy code'; }, 1500);
  } catch {
    // Clipboard API can fail/be unavailable in some contexts — not fatal,
    // the code is already big and visible on screen for manual copying.
  }
});

// Explicit navigation — no listener involved, so nothing can jump the gun
// or yank the person back while they're still looking at their new code.
document.getElementById('btn-created-continue').addEventListener('click', () => {
  goToHome(createdFamilyId, createdFamilyName);
});

// -- Join a family --
const joinForm = document.getElementById('join-form');
const joinError = document.getElementById('join-error');
const joinSubmit = document.getElementById('join-submit');
let pendingJoinFamilyId = null;
let pendingJoinFamilyName = null;

joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  joinError.classList.remove('visible');
  joinSubmit.disabled = true;
  joinSubmit.textContent = 'Looking up…';

  try {
    const code = document.getElementById('input-invite-code').value;
    const result = await lookupInviteCode(code);
    if (!result) {
      joinError.textContent = "That code doesn't match any family. Double-check it and try again.";
      joinError.classList.add('visible');
    } else {
      pendingJoinFamilyId = result.familyId;
      pendingJoinFamilyName = result.familyName;
      document.getElementById('confirm-family-name').textContent = result.familyName;
      document.getElementById('confirm-error').classList.remove('visible');
      showFamilyMode('confirm');
    }
  } catch (err) {
    console.error(err);
    joinError.textContent = 'Something went wrong. Please try again.';
    joinError.classList.add('visible');
  } finally {
    joinSubmit.disabled = false;
    joinSubmit.textContent = 'Find family';
  }
});

document.getElementById('btn-confirm-cancel').addEventListener('click', () => {
  pendingJoinFamilyId = null;
  showFamilyMode('join');
});

document.getElementById('btn-confirm-join').addEventListener('click', async () => {
  const btn = document.getElementById('btn-confirm-join');
  const confirmError = document.getElementById('confirm-error');
  confirmError.classList.remove('visible');
  btn.disabled = true;
  btn.textContent = 'Joining…';

  try {
    await joinFamily(pendingJoinFamilyId, pendingJoinFamilyName);
    goToHome(pendingJoinFamilyId, pendingJoinFamilyName);
  } catch (err) {
    console.error(err);
    confirmError.textContent = 'Something went wrong joining that family. Please try again.';
    confirmError.classList.add('visible');
    btn.disabled = false;
    btn.textContent = 'Yes, join this family';
  }
});

// ---------- React to auth state, then check the person's profile ONCE ----------
// Deliberately a one-time check, not a live listener: a live listener here
// was re-firing at odd moments (e.g. right as a write was being committed)
// and yanking the person back to the choice screen mid-flow. Explicit
// navigation after createFamily()/joinFamily() (above) handles moving
// forward; this only handles "what screen do I land on right after login."
watchAuthState(async (user) => {
  submitBtn.disabled = false;

  if (!user) {
    session.uid = null;
    session.displayName = null;
    session.familyId = null;
    session.familyName = null;
    session.members = [];
    stopAlertWatcher();
    stopContactsWatcher();
    setMode('login');
    showScreen('screen-auth');
    return;
  }

  showScreen('screen-loading');
  session.uid = user.uid;

  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    const profile = snap.data();
    session.displayName = profile ? profile.displayName : null;

    if (profile && profile.familyId) {
      goToHome(profile.familyId, profile.familyName);
    } else {
      showFamilyMode('choice');
      showScreen('screen-family');
    }
  } catch (err) {
    console.error('Could not load profile:', err);
    showFamilyMode('choice');
    showScreen('screen-family');
  }
});

// ---------- Home / SOS screen wiring ----------
const sosButton = document.getElementById('btn-sos');
const sosRing = document.getElementById('sos-ring-progress');
const sosHint = document.getElementById('sos-hint');
const sosError = document.getElementById('sos-error');

const HOLD_DURATION_MS = 2000;
let holdTimer = null;
let sosInFlight = false; // guards against double-firing while a trigger is in progress

function startHold() {
  if (sosInFlight) return;
  sosError.classList.remove('visible');
  sosButton.classList.add('holding');
  sosRing.classList.add('filling');
  sosHint.textContent = 'Keep holding…';

  holdTimer = setTimeout(() => {
    handleSOSConfirmed();
  }, HOLD_DURATION_MS);
}

function cancelHold() {
  if (sosInFlight) return;
  clearTimeout(holdTimer);
  holdTimer = null;
  sosButton.classList.remove('holding');
  sosRing.classList.remove('filling');
  sosHint.textContent = 'Press and hold for 2 seconds to alert your family';
}

async function handleSOSConfirmed() {
  sosInFlight = true;
  sosHint.textContent = 'Getting your location…';
  if (navigator.vibrate) navigator.vibrate([80, 40, 80]); // tactile confirmation it registered

  try {
    await triggerSOS({
      familyId: session.familyId,
      uid: session.uid,
      displayName: session.displayName
    });
    // No manual navigation here — the live alert watcher (below) will pick
    // up this new alert within moments and move everyone, including this
    // device, to the Active Alert screen. Just reset the button's visuals
    // in case there's a brief moment before that happens.
    sosButton.classList.remove('holding');
    sosRing.classList.remove('filling');
    sosHint.textContent = 'Press and hold for 2 seconds to alert your family';
  } catch (err) {
    console.error(err);
    sosButton.classList.remove('holding');
    sosRing.classList.remove('filling');
    sosHint.textContent = 'Press and hold for 2 seconds to alert your family';

    if (err.message === 'GEOLOCATION_DENIED') {
      sosError.textContent = 'Location access is off, so we can\u2019t send your position. Please allow location access for this site and try again.';
    } else if (err.message === 'GEOLOCATION_TIMEOUT') {
      sosError.textContent = 'Couldn\u2019t get your location in time. Please try again.';
    } else if (err.message === 'GEOLOCATION_UNSUPPORTED') {
      sosError.textContent = 'This device/browser doesn\u2019t support location sharing, which SOS alerts require.';
    } else {
      sosError.textContent = 'Something went wrong sending your alert. Please try again.';
    }
    sosError.classList.add('visible');
  } finally {
    sosInFlight = false;
  }
}

// Pointer events cover mouse, touch, and stylus in one API. We deliberately
// do NOT fire on a plain "click" — only a completed 2-second hold counts.
sosButton.addEventListener('pointerdown', startHold);
sosButton.addEventListener('pointerup', cancelHold);
sosButton.addEventListener('pointerleave', cancelHold);
sosButton.addEventListener('pointercancel', cancelHold);
// Prevents the default touch behaviors (like text selection callouts on
// long-press) from interfering with the hold gesture.
sosButton.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Active Alert screen wiring ----------
let unsubscribeAlertWatcher = null;
let currentAlertId = null; // which alert (if any) is actively displayed
let map = null;
let mapMarker = null;

function startAlertWatcher(familyId) {
  stopAlertWatcher();
  unsubscribeAlertWatcher = watchLatestAlert(familyId, handleLatestAlert);
}

function stopAlertWatcher() {
  if (unsubscribeAlertWatcher) {
    unsubscribeAlertWatcher();
    unsubscribeAlertWatcher = null;
  }
  currentAlertId = null;
}

function formatTime(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== 'function') return 'just now';
  return timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function handleLatestAlert(alert) {
  if (!alert) return; // this family has never had an alert — nothing to do

  if (alert.status === 'active') {
    currentAlertId = alert.id;
    renderActiveAlert(alert);
    showScreen('screen-alert');
  } else if (alert.status === 'resolved' && alert.id === currentAlertId) {
    // Only show the "Resolved" confirmation if we were actively viewing
    // THIS alert — otherwise (e.g. fresh login, long after the fact) stay
    // quietly on the Home screen instead of surfacing old history.
    renderResolvedAlert(alert);
    currentAlertId = null;
  }
}

function renderActiveAlert(alert) {
  document.getElementById('alert-title').textContent = `${alert.triggeredByName || 'A family member'} needs help`;
  document.getElementById('alert-time').textContent = `Triggered at ${formatTime(alert.createdAt)}`;
  document.getElementById('alert-resolved-banner').style.display = 'none';
  document.getElementById('alert-actions').style.display = 'flex';
  document.getElementById('btn-alert-done').style.display = 'none';

  // The trigger person doesn't need to "acknowledge" their own alert —
  // only offer them the one action that matters: ending it.
  const isTrigger = alert.triggeredBy === session.uid;
  document.getElementById('btn-ack-seen').style.display = isTrigger ? 'none' : 'block';
  document.getElementById('btn-ack-omw').style.display = isTrigger ? 'none' : 'block';

  renderMemberList(alert);
  renderMap(alert.location);
}

function renderResolvedAlert(alert) {
  const resolvedByName =
    (session.members.find((m) => m.uid === alert.resolvedBy) || {}).displayName ||
    (alert.resolvedBy === session.uid ? 'You' : 'A family member');

  document.getElementById('alert-resolved-text').textContent =
    `Marked safe by ${resolvedByName} at ${formatTime(alert.resolvedAt)}.`;
  document.getElementById('alert-resolved-banner').style.display = 'block';
  document.getElementById('alert-actions').style.display = 'none';
  document.getElementById('btn-alert-done').style.display = 'block';
}

function renderMemberList(alert) {
  const container = document.getElementById('alert-members-list');
  container.innerHTML = '';

  const acks = alert.acknowledgments || {};
  const others = session.members.filter((m) => m.uid !== alert.triggeredBy);

  others.forEach((member) => {
    const ack = acks[member.uid];
    const row = document.createElement('div');
    row.className = 'alert-member-row';

    const name = document.createElement('div');
    name.className = 'alert-member-name';
    name.textContent = member.displayName || 'Family member';

    const status = document.createElement('div');
    if (ack) {
      const label = ack.status === 'on_the_way' ? 'On my way' : 'Seen';
      status.textContent = `${label} · ${formatTime(ack.timestamp)}`;
      status.className = `alert-member-status status-${ack.status}`;
    } else {
      status.textContent = 'Not yet seen';
      status.className = 'alert-member-status status-pending';
    }

    row.appendChild(name);
    row.appendChild(status);
    container.appendChild(row);
  });
}

function renderMap(location) {
  const container = document.getElementById('alert-map');
  if (!location || typeof location.lat !== 'number') {
    container.textContent = 'Location unavailable for this alert.';
    return;
  }

  const latLng = [location.lat, location.lng];

  if (!map) {
    map = L.map(container).setView(latLng, 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    mapMarker = L.marker(latLng).addTo(map);
  } else {
    map.setView(latLng, 16);
    mapMarker.setLatLng(latLng);
  }

  // Leaflet needs a nudge to re-measure its container after being hidden
  // (display:none) — without this, tiles can render at the wrong size.
  setTimeout(() => map.invalidateSize(), 150);
}

document.getElementById('btn-ack-seen').addEventListener('click', async () => {
  if (!currentAlertId) return;
  try {
    await acknowledgeAlert(session.familyId, currentAlertId, session.uid, 'seen');
  } catch (err) {
    console.error('Could not record acknowledgment:', err);
  }
});

document.getElementById('btn-ack-omw').addEventListener('click', async () => {
  if (!currentAlertId) return;
  try {
    await acknowledgeAlert(session.familyId, currentAlertId, session.uid, 'on_the_way');
  } catch (err) {
    console.error('Could not record acknowledgment:', err);
  }
});

document.getElementById('btn-resolve-safe').addEventListener('click', async () => {
  if (!currentAlertId) return;
  const btn = document.getElementById('btn-resolve-safe');
  btn.disabled = true;
  try {
    await resolveAlert(session.familyId, currentAlertId, session.uid);
    // The live watcher (handleLatestAlert) will pick up the resolved
    // status and show the "Resolved" confirmation automatically.
  } catch (err) {
    console.error('Could not resolve alert:', err);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('btn-alert-done').addEventListener('click', () => {
  currentAlertId = null;
  showScreen('screen-home');
});

// ---------- Emergency Contacts screen wiring ----------
let unsubscribeContactsWatcher = null;
let currentContacts = [];
let editingContactId = null; // null = adding a new contact
let pendingDeleteId = null;

function startContactsWatcher(familyId) {
  stopContactsWatcher();
  unsubscribeContactsWatcher = watchContacts(familyId, (contacts) => {
    currentContacts = contacts;
    // Only re-render the visible list if we're actually looking at it —
    // no need to touch the DOM while the person is elsewhere in the app.
    if (document.getElementById('screen-contacts').classList.contains('active')) {
      renderContactsList();
    }
  });
}

function stopContactsWatcher() {
  if (unsubscribeContactsWatcher) {
    unsubscribeContactsWatcher();
    unsubscribeContactsWatcher = null;
  }
  currentContacts = [];
}

function showContactsMode(mode) {
  ['list', 'form', 'confirm-delete'].forEach((m) => {
    document.getElementById(`contacts-mode-${m}`).style.display = m === mode ? 'flex' : 'none';
  });
}

function renderContactsList() {
  const container = document.getElementById('contacts-list');
  container.innerHTML = '';

  if (currentContacts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'contacts-empty';
    empty.textContent = 'No emergency contacts yet. Add the first one below.';
    container.appendChild(empty);
    return;
  }

  currentContacts.forEach((contact) => {
    const row = document.createElement('div');
    row.className = 'contact-row';

    const info = document.createElement('div');
    info.className = 'contact-row-info';
    // Tapping the row (not the call button) opens it for editing.
    info.addEventListener('click', () => openEditContact(contact));

    const name = document.createElement('div');
    name.className = 'contact-row-name';
    name.textContent = contact.name;

    const rel = document.createElement('div');
    rel.className = 'contact-row-relationship';
    rel.textContent = contact.relationship;

    info.appendChild(name);
    info.appendChild(rel);

    const callLink = document.createElement('a');
    callLink.className = 'contact-row-call';
    callLink.href = `tel:${contact.phone.replace(/[^\d+]/g, '')}`;
    callLink.textContent = 'Call';
    // Stop the row's click (which opens edit mode) from also firing.
    callLink.addEventListener('click', (e) => e.stopPropagation());

    row.appendChild(info);
    row.appendChild(callLink);
    container.appendChild(row);
  });
}

document.getElementById('home-contacts').addEventListener('click', () => {
  showContactsMode('list');
  renderContactsList();
  showScreen('screen-contacts');
});

document.getElementById('contacts-back').addEventListener('click', () => {
  showScreen('screen-home');
});

function openAddContact() {
  editingContactId = null;
  document.getElementById('contact-form-title').textContent = 'Add a contact';
  document.getElementById('input-contact-name').value = '';
  document.getElementById('input-contact-relationship').value = '';
  document.getElementById('input-contact-phone').value = '';
  document.getElementById('contact-form-error').classList.remove('visible');
  document.getElementById('btn-delete-contact').style.display = 'none';
  showContactsMode('form');
}

function openEditContact(contact) {
  editingContactId = contact.id;
  document.getElementById('contact-form-title').textContent = 'Edit contact';
  document.getElementById('input-contact-name').value = contact.name;
  document.getElementById('input-contact-relationship').value = contact.relationship;
  document.getElementById('input-contact-phone').value = contact.phone;
  document.getElementById('contact-form-error').classList.remove('visible');
  document.getElementById('btn-delete-contact').style.display = 'block';
  showContactsMode('form');
}

document.getElementById('btn-add-contact').addEventListener('click', openAddContact);
document.getElementById('contact-form-back').addEventListener('click', () => showContactsMode('list'));

document.getElementById('contact-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = document.getElementById('contact-form-error');
  const submitBtn = document.getElementById('contact-form-submit');
  errorBox.classList.remove('visible');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  const data = {
    name: document.getElementById('input-contact-name').value.trim(),
    relationship: document.getElementById('input-contact-relationship').value.trim(),
    phone: document.getElementById('input-contact-phone').value.trim()
  };

  try {
    if (editingContactId) {
      await updateContact(session.familyId, editingContactId, data);
    } else {
      await addContact(session.familyId, { ...data, addedBy: session.uid });
    }
    showContactsMode('list');
  } catch (err) {
    console.error('Could not save contact:', err);
    errorBox.textContent = 'Something went wrong saving this contact. Please try again.';
    errorBox.classList.add('visible');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save contact';
  }
});

document.getElementById('btn-delete-contact').addEventListener('click', () => {
  const contact = currentContacts.find((c) => c.id === editingContactId);
  pendingDeleteId = editingContactId;
  document.getElementById('delete-contact-name').textContent = contact
    ? `"${contact.name}" will be permanently removed for your whole family.`
    : "This can't be undone.";
  showContactsMode('confirm-delete');
});

document.getElementById('btn-cancel-delete').addEventListener('click', () => {
  pendingDeleteId = null;
  showContactsMode('form');
});

document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  const btn = document.getElementById('btn-confirm-delete');
  btn.disabled = true;
  try {
    await deleteContact(session.familyId, pendingDeleteId);
    pendingDeleteId = null;
    editingContactId = null;
    showContactsMode('list');
  } catch (err) {
    console.error('Could not delete contact:', err);
  } finally {
    btn.disabled = false;
  }
});
