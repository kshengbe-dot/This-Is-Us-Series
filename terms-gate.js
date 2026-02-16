// terms-gate.js (FULL FILE — CLEAN + INTEGRATED)
// ✅ Purpose: Block the app until Terms are accepted (local first, cloud optional)
// ✅ Works with your file structure + Firebase v12.9.0
// ✅ Fixes your mistake: you had TWO different versions pasted into one file.
//
// How it works:
// - Uses a single TERMS_VERSION string (set it to the "Last updated" date in your modal)
// - If accepted locally -> no modal
// - If signed in AND accepted in cloud -> auto-accept locally, no modal
// - Otherwise -> modal opens and cannot be dismissed until checkbox is checked + Accept clicked
//
// Required HTML IDs (defaults):
//   #termsModal, #agreeTerms, #acceptTermsBtn, #termsMsg
//
// Usage in read.html / index.html:
//   import { wireTermsGate } from "./terms-gate.js";
//   wireTermsGate();

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 🔁 MUST match the "Last updated" label in your Terms modal text
// Change this string when you update Terms.
const TERMS_VERSION = "2026-02-15";

// local storage key
const LOCAL_KEY = `tiu_termsAccepted:${TERMS_VERSION}`;

// Firestore fields on users/{uid}
const CLOUD_VERSION_FIELD = "termsAcceptedVersion";
const CLOUD_AT_FIELD = "termsAcceptedAt";

/**
 * wireTermsGate(options)
 * Locks UI until Terms accepted.
 */
export function wireTermsGate({
  modalId = "termsModal",
  checkboxId = "agreeTerms",
  acceptBtnId = "acceptTermsBtn",
  msgId = "termsMsg"
} = {}) {
  const modal = document.getElementById(modalId);
  const agree = document.getElementById(checkboxId);
  const acceptBtn = document.getElementById(acceptBtnId);
  const msg = document.getElementById(msgId);

  if (!modal || !agree || !acceptBtn) return;

  // --- helpers ---
  const localAccepted = () => localStorage.getItem(LOCAL_KEY) === "1";
  const setLocalAccepted = () => localStorage.setItem(LOCAL_KEY, "1");

  function open() {
    modal.classList.add("show");
    document.body.style.overflow = "hidden";
    if (msg) msg.textContent = "";
    agree.checked = false;

    // hard-lock: prevent ESC closing if your modal library tries
    window.addEventListener("keydown", blockEscape, true);
  }

  function close() {
    modal.classList.remove("show");
    document.body.style.overflow = "";
    window.removeEventListener("keydown", blockEscape, true);
  }

  function blockEscape(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  async function cloudAccepted(uid) {
    if (!uid) return false;
    try {
      const snap = await getDoc(doc(db, "users", uid));
      if (!snap.exists()) return false;
      const d = snap.data() || {};
      return d[CLOUD_VERSION_FIELD] === TERMS_VERSION;
    } catch {
      return false;
    }
  }

  async function setCloudAccepted(uid) {
    if (!uid) return;
    try {
      await setDoc(
        doc(db, "users", uid),
        {
          [CLOUD_VERSION_FIELD]: TERMS_VERSION,
          [CLOUD_AT_FIELD]: serverTimestamp()
        },
        { merge: true }
      );
    } catch {
      // ignore (terms still accepted locally)
    }
  }

  // prevent click-out closing (if your CSS uses overlay click)
  modal.addEventListener("click", (e) => {
    e.stopPropagation();
    // do not close on background clicks
  });

  // ---- start ----
  async function runGate(user) {
    // If already accepted locally -> done
    if (localAccepted()) {
      close();
      return;
    }

    // If signed in, check cloud acceptance to auto-unlock
    const uid = user?.uid || null;
    if (uid) {
      const ok = await cloudAccepted(uid);
      if (ok) {
        setLocalAccepted();
        close();
        return;
      }
    }

    // Otherwise lock
    open();
  }

  // Run once immediately using current user (may be null early)
  runGate(auth.currentUser).catch(() => open());

  // Re-run on auth changes (e.g., user logs in)
  onAuthStateChanged(auth, (user) => {
    runGate(user).catch(() => open());
  });

  // Accept button
  acceptBtn.addEventListener("click", async () => {
    if (msg) msg.textContent = "";

    if (!agree.checked) {
      if (msg) msg.textContent = "Please check the box to continue.";
      return;
    }

    // Always accept locally
    setLocalAccepted();

    // Save to cloud (optional)
    const uid = auth.currentUser?.uid || null;
    if (uid) await setCloudAccepted(uid);

    close();
  });
}
