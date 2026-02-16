// terms-gate.js (FULL FILE — UPDATED to match your rules)
// Signed-in: one time (Firestore + local cache)
// Guest: show every refresh (NO localStorage saving)

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

// MUST match the “Last updated” date shown in the modal text
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
      { termsAcceptedVersion: TERMS_VERSION, termsAcceptedAt: serverTimestamp() },
      { merge: true }
    );
  } catch {
    // ignore
  }
}

export function wireTermsGate({
  modalId = "termsModal",
  checkboxId = "agreeTerms",
  acceptBtnId = "acceptTermsBtn",
  msgId = "termsMsg",
  lockScroll = null,
  unlockScroll = null
} = {}) {
  const modal = document.getElementById(modalId);
  const box = document.getElementById(checkboxId);
  const btn = document.getElementById(acceptBtnId);
  const msg = document.getElementById(msgId);

  // If modal isn't on this page, do nothing.
  if (!modal || !box || !btn) return;

  // Guest session-only acceptance (resets on refresh)
  let guestAcceptedThisLoad = false;

  const isAcceptedLocal = () => localStorage.getItem(LOCAL_KEY) === "1";
  const setAcceptedLocal = () => localStorage.setItem(LOCAL_KEY, "1");

  function open() {
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    box.checked = false;
    safeText(msg, "");

    if (typeof lockScroll === "function") lockScroll();
    else document.body.style.overflow = "hidden";
  }

  function close() {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");

    if (typeof unlockScroll === "function") unlockScroll();
    else document.body.style.overflow = "";
  }

  // User MUST accept (no click-out close)
  modal.addEventListener("click", (e) => e.stopPropagation());

  async function run(uid) {
    // ✅ Guests: show every refresh (no localStorage saving)
    if (!uid) {
      if (guestAcceptedThisLoad) {
        close();
        return;
      }
      open();
      safeText(msg, "Guest mode: this will appear every refresh. Sign in to accept once.");
      return;
    }

    // ✅ Signed-in: one time (local + cloud)
    if (isAcceptedLocal()) {
      close();
      return;
    }

    const ok = await cloudHasAccepted(uid);
    if (ok) {
      setAcceptedLocal();
      close();
      return;
    }

    open();
  }

  btn.addEventListener("click", async () => {
    safeText(msg, "");

    if (!box.checked) {
      safeText(msg, "Please check the box to continue.");
      return;
    }

    const user = auth.currentUser;

    if (user?.uid) {
      // signed-in: save local + cloud
      setAcceptedLocal();
      await cloudSetAccepted(user.uid);
    } else {
      // guest: do NOT write localStorage
      guestAcceptedThisLoad = true;
    }

    close();
  });

  onAuthStateChanged(auth, (user) => run(user?.uid || null));
  run(auth.currentUser?.uid || null);
}
