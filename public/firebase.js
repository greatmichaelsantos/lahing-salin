/* SALIN-LAHI — firebase.js — Firebase module init */
import { initializeApp }        from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously }
                                from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, getDocs,
  deleteDoc, doc, writeBatch, query, orderBy, limit,
  getDoc, setDoc,
}                               from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyC4GmFQDacZftYZaJvh8g6tYF7PDLtzVrU",
  authDomain:        "saln-lhi-5de80.firebaseapp.com",
  projectId:         "saln-lhi-5de80",
  storageBucket:     "saln-lhi-5de80.firebasestorage.app",
  messagingSenderId: "838506980633",
  appId:             "1:838506980633:web:48c8b3410c3418bde99188",
  measurementId:     "G-EZD4V0MXLS",
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

signInAnonymously(auth)
  .then(function () {
    // ── Public leaderboard ──
    window.fbAddScore = async function (entry) {
      await addDoc(collection(db, "salinlahi_scores"), entry);
    };
    window.fbGetScores = async function () {
      const q = query(
        collection(db, "salinlahi_scores"),
        orderBy("pct", "desc"),
        orderBy("ts", "asc"),
        limit(100),
      );
      const snap = await getDocs(q);
      return snap.docs.map(function (d) { return d.data(); });
    };

    // ── Admin — all docs with Firestore doc IDs ──
    window.fbGetAllScores = async function () {
      const q = query(
        collection(db, "salinlahi_scores"),
        orderBy("ts", "desc"),
      );
      const snap = await getDocs(q);
      return snap.docs.map(function (d) {
        return Object.assign({ _docId: d.id }, d.data());
      });
    };
    window.fbDeleteScore = async function (docId) {
      await deleteDoc(doc(db, "salinlahi_scores", docId));
    };
    window.fbClearAllScores = async function () {
      const snap = await getDocs(collection(db, "salinlahi_scores"));
      const all  = snap.docs;
      for (let i = 0; i < all.length; i += 500) {
        const batch = writeBatch(db);
        all.slice(i, i + 500).forEach(function (d) { batch.delete(d.ref); });
        await batch.commit();
      }
    };

    // ── Admin PIN — stored in salinlahi_config/admin ──
    window.fbGetAdminPin = async function () {
      const snap = await getDoc(doc(db, "salinlahi_config", "admin"));
      if (snap.exists() && snap.data().pin) return snap.data().pin;
      return null;
    };
    window.fbSetAdminPin = async function (pin) {
      await setDoc(doc(db, "salinlahi_config", "admin"), { pin: pin }, { merge: true });
    };

    // ── Presentation PIN — stored in same doc as presPin ──
    window.fbGetPresPin = async function () {
      const snap = await getDoc(doc(db, "salinlahi_config", "admin"));
      if (snap.exists() && snap.data().presPin) return snap.data().presPin;
      return null;
    };
    window.fbSetPresPin = async function (pin) {
      await setDoc(doc(db, "salinlahi_config", "admin"), { presPin: pin }, { merge: true });
    };

    // ── Presentation default flow — stored in salinlahi_config/presentation ──
    window.fbGetPresFlow = async function () {
      const snap = await getDoc(doc(db, "salinlahi_config", "presentation"));
      if (snap.exists() && snap.data().flow) return snap.data().flow;
      return null;
    };
    window.fbSetPresFlow = async function (flow) {
      await setDoc(doc(db, "salinlahi_config", "presentation"), { flow: flow }, { merge: true });
    };

    window.fbProjectId = firebaseConfig.projectId;
    window._fbReady    = true;
    window.dispatchEvent(new Event("firebase-ready"));
  })
  .catch(function (e) {
    console.error("Firebase anonymous auth failed:", e.message);
    window._fbReady = false;
    window.dispatchEvent(new CustomEvent("firebase-error", { detail: e }));
  });
