// terms-gate.js
// Shared Terms gate used by index.html, read.html, settings.html
// Guest: localStorage | Signed-in: Firestore users/{uid}

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// bump this ONLY when you change terms text and want everyone to accept again
export const TERMS_VERSION = 1;

function lockScroll(lock) {
  document.body.style.overflow = lock ? "hidden" : "";
}

async function hasAcceptedTerms(user) {
  if (user) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const d = snap.exists() ? snap.data() : {};
      return Number(d.acceptedTermsVersion || 0) >= TERMS_VERSION;
    } catch {
      return false;
    }
  }
  const v = Number(localStorage.getItem("termsAcceptedVersion") || "0");
  return v >= TERMS_VERSION;
}

async function saveTermsAccepted(user) {
  if (user) {
    await setDoc(
      doc(db, "users", user.uid),
      {
        acceptedTermsVersion: TERMS_VERSION,
        acceptedTermsAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } else {
    localStorage.setItem("termsAcceptedVersion", String(TERMS_VERSION));
    localStorage.setItem("termsAcceptedAt", String(Date.now()));
  }
}

export function wireTermsGate({
  termsModalId = "termsModal",
  agreeCheckboxId = "agreeTerms",
  acceptBtnId = "acceptTermsBtn",
  msgId = "termsMsg",
  // optional: run after accept (ex: open opt-in modal once)
  onAccepted = null,
} = {}) {
  const termsModal = document.getElementById(termsModalId);
  const agree = document.getElementById(agreeCheckboxId);
  const acceptBtn = document.getElementById(acceptBtnId);
  const msg = document.getElementById(msgId);

  if (!termsModal || !agree || !acceptBtn) return;

  function openTermsHard() {
    termsModal.classList.add("show");
    lockScroll(true);
  }
  function closeTerms() {
    termsModal.classList.remove("show");
    lockScroll(false);
  }

  async function showIfNeeded(user) {
    const ok = await hasAcceptedTerms(user);
    if (!ok) openTermsHard();
    else closeTerms();
  }

  acceptBtn.addEventListener("click", async () => {
    if (msg) msg.textContent = "";
    if (!agree.checked) {
      if (msg) msg.textContent = "Please check the agreement box to continue.";
      return;
    }
    try {
      await saveTermsAccepted(auth.currentUser);
      closeTerms();
      if (typeof onAccepted === "function") onAccepted(auth.currentUser);
    } catch {
      if (msg) msg.textContent = "Could not save. Please try again.";
    }
  });

  // IMPORTANT: run gate for guests AND signed-in
  onAuthStateChanged(auth, async (user) => {
    await showIfNeeded(user);
  });
}
