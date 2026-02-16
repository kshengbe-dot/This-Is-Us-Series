// terms-gate.js (FULL FILE)
// Purpose: Force Terms acceptance before using the site.
// - Stores acceptance locally (fast, reliable)
// - Also stores acceptance to Firestore when signed-in (optional sync)
//
// Works with your modal IDs in read.html:
//   modalId: "termsModal"
//   checkboxId: "agreeTerms"
//   acceptBtnId: "acceptTermsBtn"
//   msgId: "termsMsg"

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

// === MUST match the "Last updated" date shown in your Terms modal ===
const TERMS_VERSION = "2026-02-15";
const LOCAL_KEY = `termsAccepted:${TERMS_VERSION}`;

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function safeText(el, t) {
  if (!el) return;
  el.textContent = String(t ?? "");
}

async function cloudHasAccepted(uid) {
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return false;
    const d = snap.data() || {};
    return d.termsAcceptedVersion === TERMS_VERSION;
  } catch {
    return false;
  }
}

async function cloudSetAccepted(uid) {
  if (!uid) return;
  try {
    await setDoc(
      doc(db, "users", uid),
      {
        termsAcceptedVersion: TERMS_VERSION,
        termsAcceptedAt: serverTimestamp()
      },
      { merge: true }
    );
  } catch {
    // ignore (rules may block; local acceptance still works)
  }
}

export function wireTermsGate({
  modalId = "termsModal",
  checkboxId = "agreeTerms",
  acceptBtnId = "acceptTermsBtn",
  msgId = "termsMsg",
  // optional callbacks for iPhone-safe scroll locking
  lockScroll = null,
  unlockScroll = null
} = {}) {
  const modal = document.getElementById(modalId);
  const box = document.getElementById(checkboxId);
  const btn = document.getElementById(acceptBtnId);
  const msg = document.getElementById(msgId);

  // If the modal isn't on this page, do nothing.
  if (!modal || !box || !btn) return;

  const isAcceptedLocal = () => localStorage.getItem(LOCAL_KEY) === "1";
  const setAcceptedLocal = () => localStorage.setItem(LOCAL_KEY, "1");

  function open() {
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    box.checked = false;
    safeText(msg, "");

    // lock background scroll (iOS-safe)
    if (typeof lockScroll === "function") lockScroll();
    else document.body.style.overflow = "hidden";
  }

  function close() {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");

    if (typeof unlockScroll === "function") unlockScroll();
    else document.body.style.overflow = "";
  }

  // Prevent click-out close: user MUST accept
  modal.addEventListener("click", (e) => {
    // swallow clicks so they don't close the modal
    e.stopPropagation();
  });

  // Main logic: show only if not accepted
  async function run(uid) {
    // If accepted locally, unlock.
    if (isAcceptedLocal()) {
      close();
      return;
    }

    // If signed in, check cloud acceptance and set local if already accepted.
    if (uid) {
      const ok = await cloudHasAccepted(uid);
      if (ok) {
        setAcceptedLocal();
        close();
        return;
      }
    }

    // Otherwise force modal open.
    open();
  }

  // Accept button
  btn.addEventListener("click", async () => {
    safeText(msg, "");

    if (!box.checked) {
      safeText(msg, "Please check the box to continue.");
      return;
    }

    setAcceptedLocal();

    const user = auth.currentUser;
    if (user?.uid) await cloudSetAccepted(user.uid);

    close();
  });

  // Run after auth state is known
  onAuthStateChanged(auth, (user) => {
    run(user?.uid || null);
  });

  // Also run immediately (in case auth takes a moment)
  run(auth.currentUser?.uid || null);
}
