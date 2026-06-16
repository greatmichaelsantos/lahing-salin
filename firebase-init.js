import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  writeBatch,
  query,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC4GmFQDacZftYZaJvh8g6tYF7PDLtzVrU",
  authDomain: "saln-lhi-5de80.firebaseapp.com",
  projectId: "saln-lhi-5de80",
  storageBucket: "saln-lhi-5de80.firebasestorage.app",
  messagingSenderId: "838506980633",
  appId: "1:838506980633:web:48c8b3410c3418bde99188",
  measurementId: "G-EZD4V0MXLS",
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
export const db = getFirestore(app);
export const projectId = firebaseConfig.projectId;

signInAnonymously(auth).catch(function (e) {
  console.warn("Firebase anonymous auth failed:", e.message);
});

// ── Public leaderboard — top 100, pct DESC then ts ASC ──
export async function fbAddScore(entry) {
  await addDoc(collection(db, "salinlahi_scores"), entry);
}

export async function fbGetScores() {
  const q = query(
    collection(db, "salinlahi_scores"),
    orderBy("pct", "desc"),
    orderBy("ts", "asc"),
    limit(100),
  );
  const snap = await getDocs(q);
  return snap.docs.map(function (d) {
    return d.data();
  });
}

// ── Admin — all docs, ts DESC, with Firestore doc IDs attached as _docId ──
export async function fbGetAllScores() {
  const q = query(
    collection(db, "salinlahi_scores"),
    orderBy("ts", "desc"),
  );
  const snap = await getDocs(q);
  return snap.docs.map(function (d) {
    return Object.assign({ _docId: d.id }, d.data());
  });
}

// ── Admin — delete a single score document ──
export async function fbDeleteScore(docId) {
  await deleteDoc(doc(db, "salinlahi_scores", docId));
}

// ── Admin — delete all score documents in batches of 500 ──
export async function fbClearAllScores() {
  const snap = await getDocs(collection(db, "salinlahi_scores"));
  const allDocs = snap.docs;
  for (let i = 0; i < allDocs.length; i += 500) {
    const batch = writeBatch(db);
    allDocs.slice(i, i + 500).forEach(function (d) {
      batch.delete(d.ref);
    });
    await batch.commit();
  }
}
