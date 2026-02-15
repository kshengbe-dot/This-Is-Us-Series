// terms-gate.js
// Shared Terms gate used by index.html, read.html, settings.html
// Signed-in: Firestore users/{uid} remembers acceptance
// Guest: shows EVERY refresh (NO localStorage saving). Accept closes only for current session.

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
  // Signed-in users: remember in Firestore
  if (user) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const d = snap.exists() ? snap.data() : {};
      return Number(d.acceptedTermsVersion || 0) >= TERMS_VERSION;
    } catch {
      return false;
    }
  }

  // Guests: ALWAYS false so it shows every refresh
  return false;
}

async function saveTermsAccepted(user) {
  // Signed-in: save acceptance
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
    return;
  }

  // Guest: do NOT persist. (They’ll see it again next refresh.)
  // Accept will just close the modal for this session.
}

export function wireTermsGate({
  termsModalId = "termsModal",
  agreeCheckboxId = "agreeTerms",
  acceptBtnId = "acceptTermsBtn",
  msgId = "termsMsg",
  guestNoteId = "guestTermsHint", // optional element in your modal to show guest message
  onAccepted = null,
} = {}) {
  const termsModal = document.getElementById(termsModalId);
  const agree = document.getElementById(agreeCheckboxId);
  const acceptBtn = document.getElementById(acceptBtnId);
  const msg = document.getElementById(msgId);
  const guestHint = document.getElementById(guestNoteId);

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

    if (!user) {
      if (guestHint) {
        guestHint.textContent =
          "Guest mode: Terms will pop up every refresh. Sign in to stop it.";
      }
    } else {
      if (guestHint) guestHint.textContent = "";
    }

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

  onAuthStateChanged(auth, async (user) => {
    await showIfNeeded(user);
  });
}
