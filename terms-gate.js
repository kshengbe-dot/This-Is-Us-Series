// terms-gate.js
// Signed-in users: accept ONCE (saved in Firestore)
// Guests: ALWAYS show Terms every refresh (NO localStorage saving)
// Message tells guests: "Sign in to stop this popup"

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// bump ONLY when you truly change the terms text
export const TERMS_VERSION = 1;

function lockScroll(lock) {
  document.body.style.overflow = lock ? "hidden" : "";
}

async function hasAcceptedTermsSignedIn(user) {
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const d = snap.exists() ? snap.data() : {};
    return Number(d.acceptedTermsVersion || 0) >= TERMS_VERSION;
  } catch {
    return false;
  }
}

async function saveTermsAcceptedSignedIn(user) {
  await setDoc(
    doc(db, "users", user.uid),
    {
      acceptedTermsVersion: TERMS_VERSION,
      acceptedTermsAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Wire Terms gate:
 * - Signed-in users: check Firestore; if accepted -> do not show again.
 * - Guests: ALWAYS show (every refresh). NO localStorage stored for acceptance.
 */
export function wireTermsGate({
  termsModalId = "termsModal",
  agreeCheckboxId = "agreeTerms",
  acceptBtnId = "acceptTermsBtn",
  msgId = "termsMsg",
  // optional: for signed-in only flow (ex open opt-in once)
  onAcceptedSignedIn = null,
} = {}) {
  const termsModal = document.getElementById(termsModalId);
  const agree = document.getElementById(agreeCheckboxId);
  const acceptBtn = document.getElementById(acceptBtnId);
  const msg = document.getElementById(msgId);

  if (!termsModal || !agree || !acceptBtn) return;

  // inject guest hint message without requiring HTML edits
  function setGuestHint(show) {
    let hint = termsModal.querySelector("[data-guest-hint]");
    if (!hint) {
      hint = document.createElement("div");
      hint.setAttribute("data-guest-hint", "1");
      hint.style.cssText =
        "margin-top:10px;padding:10px 12px;border-radius:14px;" +
        "border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);" +
        "font:800 12px ui-sans-serif,system-ui;line-height:1.45;opacity:.92;";
      hint.textContent =
        "Guest mode: Terms will pop up on every refresh. Sign in to accept once and stop the popup.";
      // put it near bottom of modal card
      const card = termsModal.querySelector(".modalCard") || termsModal;
      card.appendChild(hint);
    }
    hint.style.display = show ? "block" : "none";
  }

  function openTermsHard() {
    termsModal.classList.add("show");
    lockScroll(true);
  }
  function closeTerms() {
    termsModal.classList.remove("show");
    lockScroll(false);
  }

  async function showIfNeeded(user) {
    if (!user) {
      // Guest: ALWAYS show
      setGuestHint(true);
      openTermsHard();
      return;
    }

    // Signed-in: show only if not accepted yet
    setGuestHint(false);
    const ok = await hasAcceptedTermsSignedIn(user);
    if (!ok) openTermsHard();
    else closeTerms();
  }

  acceptBtn.addEventListener("click", async () => {
    if (msg) msg.textContent = "";

    const user = auth.currentUser;

    if (!agree.checked) {
      if (msg) msg.textContent = "Please check the agreement box to continue.";
      return;
    }

    // Guest: allow them to continue BUT it will pop again next refresh
    if (!user) {
      closeTerms();
      if (msg) msg.textContent = "";
      return;
    }

    // Signed-in: save acceptance once in Firestore
    try {
      await saveTermsAcceptedSignedIn(user);
      closeTerms();
      if (typeof onAcceptedSignedIn === "function") onAcceptedSignedIn(user);
    } catch {
      if (msg) msg.textContent = "Could not save. Please try again.";
    }
  });

  // Run gate on auth state
  onAuthStateChanged(auth, async (user) => {
    await showIfNeeded(user);
  });
}
