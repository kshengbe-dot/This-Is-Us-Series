// terms-gate.js (FULL FILE — single clean version, matches your read.html)
// Purpose: blocks reader until Terms are accepted (local first, optional cloud save).
// Works with your read.html that passes { lockScroll, unlockScroll } into wireTermsGate().

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// MUST match the date shown in your Terms modal ("Last updated: ...")
const TERMS_VERSION = "2026-02-15";
const LOCAL_KEY = `tiu_termsAccepted:${TERMS_VERSION}`;

export function wireTermsGate({
  modalId = "termsModal",
  checkboxId = "agreeTerms",
  btnId = "acceptTermsBtn",
  msgId = "termsMsg",
  // optional scroll helpers you pass from read.html
  lockScroll = null,
  unlockScroll = null
} = {}) {
  const modal = document.getElementById(modalId);
  const agree = document.getElementById(checkboxId);
  const btn = document.getElementById(btnId);
  const msg = document.getElementById(msgId);

  if (!modal || !agree || !btn) return;

  const isAcceptedLocal = () => localStorage.getItem(LOCAL_KEY) === "1";
  const setAcceptedLocal = () => localStorage.setItem(LOCAL_KEY, "1");

  function open() {
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    if (msg) msg.textContent = "";
    agree.checked = false;

    // Prefer your safe mobile lock helpers if provided
    if (typeof lockScroll === "function") lockScroll();
    else document.body.style.overflow = "hidden";
  }

  function close() {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");

    if (typeof unlockScroll === "function") unlockScroll();
    else document.body.style.overflow = "";
  }

  async function cloudAccepted(uid) {
    if (!uid) return false;
    try {
      const snap = await getDoc(doc(db, "users", uid));
      if (!snap.exists()) return false;
      const d = snap.data() || {};

      // Accept either field name (older/newer) to be robust
      const v =
        d.termsAcceptedVersion ||
        d.termsVersion ||
        d.termsAcceptedVer ||
        null;

      const ok =
        (d.termsAccepted === true || !!v) &&
        String(v || "") === TERMS_VERSION;

      return !!ok;
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
          termsAcceptedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    } catch {
      // optional; ignore failures
    }
  }

  async function runGate(user) {
    if (isAcceptedLocal()) {
      close();
      return;
    }

    // If signed in and already accepted in cloud, honor it (and cache locally)
    const uid = user?.uid || null;
    if (uid) {
      const ok = await cloudAccepted(uid);
      if (ok) {
        setAcceptedLocal();
        close();
        return;
      }
    }

    // Otherwise, show Terms gate
    open();
  }

  // Start gate
  onAuthStateChanged(auth, (user) => {
    runGate(user).catch(() => {
      // If anything fails, fail-safe: still open gate unless accepted locally
      if (!isAcceptedLocal()) open();
    });
  });

  // Lock the modal: no click-outside close
  modal.addEventListener("click", (e) => {
    // prevent accidental close by overlay clicks
    e.stopPropagation();
  });

  // Accept button
  btn.addEventListener("click", async () => {
    if (msg) msg.textContent = "";

    if (!agree.checked) {
      if (msg) msg.textContent = "Please check the box first.";
      return;
    }

    setAcceptedLocal();

    const uid = auth.currentUser?.uid || null;
    if (uid) await setCloudAccepted(uid);

    close();
  });
}
