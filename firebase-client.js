import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write'
};

const VALID_PROGRAMS = new Set(['IIT-NEET', 'High School', 'Primary', 'Navodaya-Sainik']);
const VALID_INQUIRY_STATUSES = new Set(['new', 'contacted', 'enrolled', 'archived']);
const VALID_VISIT_STATUSES = new Set(['scheduled', 'completed', 'cancelled']);
const PHONE_REGEX = /^[+0-9\s\-()]{7,20}$/;
const DATE_REGEX = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

let app = null;
let db = null;
let auth = null;
let currentUser = null;
let isAuthReady = false;
let initPromise = null;

export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid ?? null,
      email: auth?.currentUser?.email ?? null,
      emailVerified: auth?.currentUser?.emailVerified ?? null,
      isAnonymous: auth?.currentUser?.isAnonymous ?? null,
      tenantId: auth?.currentUser?.tenantId ?? null,
      providerInfo:
        auth?.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email
        })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

export async function initFirebase() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const response = await fetch('./firebase-applet-config.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Unable to load firebase-applet-config.json');
    }
    const firebaseConfig = await response.json();
    app = initializeApp(firebaseConfig);
    db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
    auth = getAuth(app);

    await testConnection();

    await new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        currentUser = user;
        isAuthReady = true;
        resolve();
        unsubscribe();
      });
    });

    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      isAuthReady = true;
      window.dispatchEvent(new CustomEvent('vhs-auth-changed', { detail: { user } }));
    });

    return { app, db, auth };
  })();

  return initPromise;
}

export function getAuthState() {
  return { isAuthReady, currentUser };
}

export async function saveAdmissionInquiry(rawData) {
  await initFirebase();

  const parentName = String(rawData.parentName || '').trim().slice(0, 100);
  const mobileNumber = String(rawData.mobileNumber || '').trim().slice(0, 20);
  const villageOrTown = String(rawData.villageOrTown || '').trim().slice(0, 100);
  const program = String(rawData.program || '').trim();
  const studentName = String(rawData.studentName || '').trim().slice(0, 100);

  if (!parentName) throw new Error('Please enter parent or guardian name.');
  if (!PHONE_REGEX.test(mobileNumber)) {
    throw new Error('Please enter a valid 7-20 digit mobile number.');
  }
  if (!villageOrTown) throw new Error('Please enter your village or town.');
  if (!VALID_PROGRAMS.has(program)) throw new Error('Please select a valid campus/program.');

  const path = 'admissionInquiries';
  try {
    const docRef = await addDoc(collection(db, path), {
      parentName,
      mobileNumber,
      villageOrTown,
      program,
      studentName,
      status: 'new',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function saveCampusVisit(rawData) {
  await initFirebase();

  const visitorName = String(rawData.visitorName || '').trim().slice(0, 100);
  const contactNumber = String(rawData.contactNumber || '').trim().slice(0, 20);
  const preferredDate = String(rawData.preferredDate || '').trim().slice(0, 10);

  if (!visitorName) throw new Error('Please enter your name.');
  if (!PHONE_REGEX.test(contactNumber)) {
    throw new Error('Please enter a valid 7-20 digit contact number.');
  }
  if (!DATE_REGEX.test(preferredDate)) {
    throw new Error('Please select a valid visit date.');
  }

  const path = 'campusVisits';
  try {
    const docRef = await addDoc(collection(db, path), {
      visitorName,
      contactNumber,
      preferredDate,
      status: 'scheduled',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function signInAdmin() {
  await initFirebase();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutAdmin() {
  await initFirebase();
  await signOut(auth);
}

export function subscribeToInquiries(onData, onError) {
  if (!isAuthReady || !currentUser || !db) return () => {};
  const path = 'admissionInquiries';
  const q = query(collection(db, path), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrappedError) {
        if (onError) onError(wrappedError);
      }
    }
  );
}

export function subscribeToVisits(onData, onError) {
  if (!isAuthReady || !currentUser || !db) return () => {};
  const path = 'campusVisits';
  const q = query(collection(db, path), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrappedError) {
        if (onError) onError(wrappedError);
      }
    }
  );
}

export async function updateInquiryStatus(id, status) {
  await initFirebase();
  if (!VALID_INQUIRY_STATUSES.has(status)) {
    throw new Error('Invalid inquiry status');
  }
  const path = `admissionInquiries/${id}`;
  try {
    await updateDoc(doc(db, 'admissionInquiries', id), {
      status,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateVisitStatus(id, status) {
  await initFirebase();
  if (!VALID_VISIT_STATUSES.has(status)) {
    throw new Error('Invalid visit status');
  }
  const path = `campusVisits/${id}`;
  try {
    await updateDoc(doc(db, 'campusVisits', id), {
      status,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteInquiry(id) {
  await initFirebase();
  const path = `admissionInquiries/${id}`;
  try {
    await deleteDoc(doc(db, 'admissionInquiries', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function deleteVisit(id) {
  await initFirebase();
  const path = `campusVisits/${id}`;
  try {
    await deleteDoc(doc(db, 'campusVisits', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

initFirebase().catch((err) => {
  console.error('Firebase initialization failed:', err);
});

window.vhsFirebase = {
  initFirebase,
  getAuthState,
  saveAdmissionInquiry,
  saveCampusVisit,
  signInAdmin,
  signOutAdmin,
  subscribeToInquiries,
  subscribeToVisits,
  updateInquiryStatus,
  updateVisitStatus,
  deleteInquiry,
  deleteVisit
};
