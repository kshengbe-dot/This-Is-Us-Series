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

// ---- prefs local keys ----
const LS_PREFS = "notifyPrefs:v1"; // { email,sms,emailVal,phoneVal }
const LS_OPT_PROMPTED = "optInPrompted"; // "1"

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

// ---- notification prefs helpers ----
export async function getNotifyPrefs(user = auth.currentUser) {
  // signed in: read from users/{uid}
  if (user) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const d = snap.exists() ? snap.data() : {};
      return {
        email: !!d.notificationEmail,
        sms: !!d.notificationSMS,
        emailVal: (d.notifyEmailValue || "")?.toString?.() || "",
        phoneVal: (d.notifyPhoneValue || "")?.toString?.() || "",
      };
    } catch {
      // fall back to local
    }
  }

  // guest/local fallback
  try {
    const raw = localStorage.getItem(LS_PREFS);
    if (!raw) return { email: false, sms: false, emailVal: "", phoneVal: "" };
    const o = JSON.parse(raw);
    return {
      email: !!o.email,
      sms: !!o.sms,
      emailVal: (o.emailVal || "").toString(),
      phoneVal: (o.phoneVal || "").toString(),
    };
  } catch {
    return { email: false, sms: false, emailVal: "", phoneVal: "" };
  }
}

export async function saveNotifyPrefs(prefs, user = auth.currentUser) {
  const clean = {
    email: !!prefs.email,
    sms: !!prefs.sms,
    emailVal: (prefs.emailVal || "").trim(),
    phoneVal: (prefs.phoneVal || "").trim(),
  };

  // always store locally too (so the form pre-fills even if offline)
  localStorage.setItem(LS_PREFS, JSON.stringify(clean));

  if (!user) return;

  // store on user doc
  await setDoc(
    doc(db, "users", user.uid),
    {
      notificationEmail: clean.email,
      notificationSMS: clean.sms,
      notifyEmailValue: clean.email ? clean.emailVal : null,
      notifyPhoneValue: clean.sms ? clean.phoneVal : null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function prefillSubscribeModal({
  // these match your index.html IDs
  emailId = "subEmail",
  phoneId = "subPhone",
  optEmailId = "optEmail",
  optSMSId = "optSMS",
} = {}) {
  const prefs = await getNotifyPrefs(auth.currentUser);

  const emailEl = document.getElementById(emailId);
  const phoneEl = document.getElementById(phoneId);
  const optEmail = document.getElementById(optEmailId);
  const optSMS = document.getElementById(optSMSId);

  if (optEmail) optEmail.checked = !!prefs.email;
  if (optSMS) optSMS.checked = !!prefs.sms;
  if (emailEl && prefs.emailVal) emailEl.value = prefs.emailVal;
  if (phoneEl && prefs.phoneVal) phoneEl.value = prefs.phoneVal;
}

export function markOptPromptedOnce() {
  localStorage.setItem(LS_OPT_PROMPTED, "1");
}
export function wasOptPrompted() {
  return localStorage.getItem(LS_OPT_PROMPTED) === "1";
}

// ---- main wire ----
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
