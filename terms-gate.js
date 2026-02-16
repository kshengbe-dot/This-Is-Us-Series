// terms-gate.js (FULL FILE — CLEAN + INTEGRATED)
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// MUST match the "Last updated" date shown in your Terms modal UI
export const TERMS_VERSION = "2026-02-15";

// local storage key (guest + signed-in)
const LOCAL_KEY = `termsAccepted:${TERMS_VERSION}`;

// cloud fields (saved on users/{uid})
const CLOUD_FIELD_VERSION = "termsAcceptedVersion";
const CLOUD_FIELD_AT = "termsAcceptedAt";

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

  function open() {
    modal.classList.add("show");
    document.body.style.overflow = "hidden";
    if (msg) msg.textContent = "";
    agree.checked = false;
  }

  function close() {
    modal.classList.remove("show");
    document.body.style.overflow = "";
  }

  function localAccepted() {
    return localStorage.getItem(LOCAL_KEY) === "1";
  }

  function setLocalAccepted() {
    localStorage.setItem(LOCAL_KEY, "1");
  }

  async function cloudAccepted(uid) {
    if (!uid) return false;
    try {
      const snap = await getDoc(doc(db, "users", uid));
      if (!snap.exists()) return false;
      const d = snap.data() || {};
      return String(d[CLOUD_FIELD_VERSION] || "") === TERMS_VERSION;
    } catch {
      return false;
    }
  }

  async function setCloudAccepted(uid) {
    if (!uid) return;
    try {
      await setDoc(doc(db, "users", uid), {
        [CLOUD_FIELD_VERSION]: TERMS_VERSION,
        [CLOUD_FIELD_AT]: serverTimestamp()
      }, { merge: true });
    } catch {}
  }

  async function enforceGate(uid) {
    // If already accepted locally, we're done
    if (localAccepted()) {
      close();
      return;
    }

    // If signed in and accepted in cloud, restore local and close
    if (uid) {
      const ok = await cloudAccepted(uid);
      if (ok) {
        setLocalAccepted();
        close();
        return;
      }
    }

    // Otherwise keep the site locked
    open();
  }

  // Prevent click-out closing
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

  // Run once, and again when auth changes
  onAuthStateChanged(auth, (user) => {
    enforceGate(user?.uid || null);
  });
}
