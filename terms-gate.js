// terms-gate.js
// Signed-in: accept ONCE in Firestore users/{uid}/meta/terms
// Guest: accept ONCE in localStorage (so Back -> Library does NOT pop again)
// Waits for auth state to resolve before deciding (prevents flash-pop)

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// bump ONLY when you change terms text materially
export const TERMS_VERSION = 1;

const LS_KEY = `termsAccepted:v${TERMS_VERSION}`;

function lockScroll(lock) {
  document.body.style.overflow = lock ? "hidden" : "";
}

function open(modal) {
  modal.classList.add("show");
  lockScroll(true);
}

function close(modal) {
  modal.classList.remove("show");
  lockScroll(false);
}

function termsRef(uid) {
  return doc(db, "users", uid, "meta", "terms");
}

async function hasAccepted(uid) {
  // ✅ guest/signed-in both benefit from local cache for navigation/back
  if (localStorage.getItem(LS_KEY) === "1") return true;

  if (!uid) return false;

  try {
    const snap = await getDoc(termsRef(uid));
    if (!snap.exists()) return false;
    const d = snap.data() || {};
    return Number(d.version || 0) >= TERMS_VERSION;
  } catch {
    return false;
  }
}

async function saveAccepted(uid) {
  localStorage.setItem(LS_KEY, "1");
  if (!uid) return;
  await setDoc(
    termsRef(uid),
    { version: TERMS_VERSION, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export function wireTermsGate({
  termsModalId = "termsModal",
  agreeCheckboxId = "agreeTerms",
  acceptBtnId = "acceptTermsBtn",
  msgId = "termsMsg",
} = {}) {
  const modal = document.getElementById(termsModalId);
  const agree = document.getElementById(agreeCheckboxId);
  const btn = document.getElementById(acceptBtnId);
  const msg = document.getElementById(msgId);

  if (!modal || !agree || !btn) return;

  let decided = false;

  async function decide(user) {
    const uid = user ? user.uid : null;
    const ok = await hasAccepted(uid);
    decided = true;
    if (ok) close(modal);
    else open(modal);
  }

  btn.addEventListener("click", async () => {
    if (msg) msg.textContent = "";
    if (!agree.checked) {
      if (msg) msg.textContent = "Please check the agreement box to continue.";
      return;
    }
    try {
      const u = auth.currentUser;
      await saveAccepted(u ? u.uid : null);
      close(modal);
    } catch (e) {
      if (msg) msg.textContent = "Could not save acceptance (check Firestore rules).";
    }
  });

  // ✅ wait for auth state
  onAuthStateChanged(auth, (user) => decide(user));

  // fallback: if auth never resolves quickly, treat as guest
  setTimeout(() => {
    if (!decided) decide(null);
  }, 1200);
}
