// terms-gate.js (FULL FILE — CLEAN + SINGLE SOURCE OF TRUTH)
// - Shows Terms modal until accepted
// - Saves acceptance locally (authoritative for gating)
// - Also saves to Firestore if signed in (optional)
// - Supports optional lockScroll/unlockScroll callbacks for iOS smoothness

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/**
 * IMPORTANT:
 * Must match the "Last updated" date shown in the Terms modal inside read.html (and/or index.html).
 * Change this string whenever you edit the Terms text.
 */
export const TERMS_VERSION = "2026-02-15";
const KEY = `termsAccepted:${TERMS_VERSION}`;

/**
 * wireTermsGate
 * @param {Object} opts
 * @param {string} opts.modalId
 * @param {string} opts.checkboxId
 * @param {string} opts.acceptBtnId
 * @param {string} opts.msgId
 * @param {Function} opts.lockScroll   optional: () => void
 * @param {Function} opts.unlockScroll optional: () => void
 */
export function wireTermsGate({
  modalId = "termsModal",
  checkboxId = "agreeTerms",
  acceptBtnId = "acceptTermsBtn",
  msgId = "termsMsg",
  lockScroll = null,
  unlockScroll = null
} = {}) {
  const modal = document.getElementById(modalId);
  const agree = document.getElementById(checkboxId);
  const acceptBtn = document.getElementById(acceptBtnId);
  const msg = document.getElementById(msgId);

  if (!modal || !agree || !acceptBtn) return;

  const localAccepted = () => localStorage.getItem(KEY) === "1";
  const setLocalAccepted = () => localStorage.setItem(KEY, "1");

  function open() {
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden"; // fallback
    if (typeof lockScroll === "function") lockScroll();
    if (msg) msg.textContent = "";
    agree.checked = false;
  }

  function close() {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = ""; // fallback
    if (typeof unlockScroll === "function") unlockScroll();
  }

  async function cloudAccepted(uid) {
    if (!uid) return false;
    try {
      const snap = await getDoc(doc(db, "users", uid));
      if (!snap.exists()) return false;
      const d = snap.data() || {};
      // accept either of these fields (backwards compatible)
      const v = d.termsAcceptedVersion || d.termsVersion || null;
      const okFlag = (d.termsAccepted === true) || !!d.termsAcceptedAt;
      return okFlag && v === TERMS_VERSION;
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
          termsAccepted: true,
          termsAcceptedVersion: TERMS_VERSION,
          termsAcceptedAt: serverTimestamp()
        },
        { merge: true }
      );
    } catch {
      // ignore
    }
  }

  async function runForUser(user) {
    // If already accepted locally -> allow
    if (localAccepted()) {
      close();
      return;
    }

    // If signed in AND cloud says accepted -> set local and allow
    const uid = user?.uid || null;
    if (uid) {
      const ok = await cloudAccepted(uid);
      if (ok) {
        setLocalAccepted();
        close();
        return;
      }
    }

    // Otherwise: gate
    open();
  }

  // Keep the modal "locked" (no click-out)
  modal.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  // Accept button
  acceptBtn.addEventListener("click", async () => {
    if (msg) msg.textContent = "";

    if (!agree.checked) {
      if (msg) msg.textContent = "Please check the box to continue.";
      return;
    }

    setLocalAccepted();

    const uid = auth.currentUser?.uid || null;
    if (uid) await setCloudAccepted(uid);

    close();
  });

  // Start / react to auth changes
  onAuthStateChanged(auth, (user) => {
    runForUser(user);
  });
}
