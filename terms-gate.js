// terms-gate.js
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// change this when you update terms text
const TERMS_VERSION = "v1";
const TERMS_KEY = `tiu_terms_${TERMS_VERSION}`;

export function wireTermsGate({
  modalId = "termsModal",
  checkboxId = "agreeTerms",
  btnId = "acceptTermsBtn",
  msgId = "termsMsg"
} = {}) {
  const modal = document.getElementById(modalId);
  const box = document.getElementById(checkboxId);
  const btn = document.getElementById(btnId);
  const msg = document.getElementById(msgId);

  if (!modal || !btn || !box) return;

  // ✅ prevent double wiring if imported twice
  if (btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";

  const show = () => {
    modal.classList.add("show");
    document.body.style.overflow = "hidden";
    box.checked = false;
    if (msg) msg.textContent = "";
  };
  const hide = () => {
    modal.classList.remove("show");
    document.body.style.overflow = "";
    if (msg) msg.textContent = "";
  };

  const localAccepted = () => localStorage.getItem(TERMS_KEY) === "yes";
  const setLocalAccepted = () => localStorage.setItem(TERMS_KEY, "yes");

  async function cloudAccepted(uid) {
    if (!uid) return false;
    try {
      const u = await getDoc(doc(db, "users", uid));
      if (!u.exists()) return false;
      const d = u.data() || {};
      return d.termsAccepted === true && d.termsVersion === TERMS_VERSION;
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
          termsVersion: TERMS_VERSION,
          termsAcceptedAt: serverTimestamp()
        },
        { merge: true }
      );
    } catch {}
  }

  async function run(uid) {
    // device already accepted
    if (localAccepted()) {
      hide();
      return;
    }

    // signed-in accepted in cloud
    if (uid) {
      const ok = await cloudAccepted(uid);
      if (ok) {
        setLocalAccepted();
        hide();
        return;
      }
    }

    // otherwise require acceptance
    show();
  }

  btn.addEventListener("click", async () => {
    if (msg) msg.textContent = "";
    if (!box.checked) {
      if (msg) msg.textContent = "Please check the box first.";
      return;
    }
    setLocalAccepted();
    const uid = auth.currentUser?.uid || null;
    if (uid) await setCloudAccepted(uid);
    hide();
  });

  // ✅ run immediately (guest)
  run(auth.currentUser?.uid || null);

  // run after auth resolves (so signed-in users don’t get nagged)
  onAuthStateChanged(auth, (user) => {
    run(user?.uid || null);
  });
}
