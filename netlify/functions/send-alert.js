// This function runs on Netlify's servers, NEVER in the browser. It's the
// one piece of FamilySOS with the authority to tell Google's push service
// "send this notification" — that authority comes from the service account
// credential in FIREBASE_SERVICE_ACCOUNT_JSON, which is only ever readable
// here, as a Netlify environment variable. It's never in the site's HTML/JS
// files, and never committed to GitHub.
//
// Flow: after writing an alert to Firestore, the client calls this function
// with { familyId, alertId } and their own Firebase ID token (proving who
// they are). This function independently re-checks that the caller is
// actually a member of that family (never trusts the client's word alone),
// looks up every OTHER family member's registered device tokens, and asks
// Firebase Cloud Messaging to push a notification to each of them.

const admin = require('firebase-admin');

// Reused across "warm" function invocations rather than re-initializing
// every single call.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
  });
}

const db = admin.firestore();
const messaging = admin.messaging();

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // ---- 1. Verify the caller is who they claim to be ----
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing auth token' }) };
  }

  let callerUid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    callerUid = decoded.uid;
  } catch (err) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid auth token' }) };
  }

  // ---- 2. Parse and validate the request ----
  let familyId, alertId;
  try {
    ({ familyId, alertId } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }
  if (!familyId || !alertId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'familyId and alertId are required' }) };
  }

  // ---- 3. Independently confirm the caller actually belongs to this family ----
  // Never trust the client's claim alone — this check is what stops anyone
  // with a valid login (but no relation to this family) from triggering a
  // push to people they don't belong with.
  const familySnap = await db.collection('families').doc(familyId).get();
  if (!familySnap.exists || !(familySnap.data().memberIds || []).includes(callerUid)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not a member of this family' }) };
  }

  // ---- 4. Load the alert itself ----
  const alertSnap = await db.collection('families').doc(familyId)
    .collection('alerts').doc(alertId).get();
  if (!alertSnap.exists) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Alert not found' }) };
  }
  const alert = alertSnap.data();

  // ---- 5. Gather every OTHER family member's device tokens ----
  const membersSnap = await db.collection('users').where('familyId', '==', familyId).get();
  const tokens = [];
  const tokenOwner = {}; // token -> uid, so we know whose profile to clean up on failure

  membersSnap.forEach((docSnap) => {
    if (docSnap.id === alert.triggeredBy) return; // don't notify the person who triggered it
    const data = docSnap.data();
    (data.fcmTokens || []).forEach((token) => {
      tokens.push(token);
      tokenOwner[token] = docSnap.id;
    });
  });

  if (tokens.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ sent: 0, note: 'No registered devices to notify' }) };
  }

  // ---- 6. Send the push ----
  const message = {
    notification: {
      title: `${alert.triggeredByName || 'A family member'} needs help`,
      body: 'Tap to see their location and respond.'
    },
    data: {
      type: 'sos_alert',
      familyId,
      alertId
    },
    tokens
  };

  const response = await messaging.sendEachForMulticast(message);

  // ---- 7. Clean up any dead tokens (e.g. app uninstalled) so future
  // pushes don't keep retrying them ----
  const staleTokenRemovals = [];
  response.responses.forEach((result, i) => {
    if (!result.success) {
      const code = result.error && result.error.code;
      if (code === 'messaging/invalid-registration-token' || code === 'messaging/registration-token-not-registered') {
        const token = tokens[i];
        const uid = tokenOwner[token];
        staleTokenRemovals.push(
          db.collection('users').doc(uid).update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(token)
          })
        );
      }
    }
  });
  await Promise.all(staleTokenRemovals);

  return {
    statusCode: 200,
    body: JSON.stringify({ sent: response.successCount, failed: response.failureCount })
  };
};
