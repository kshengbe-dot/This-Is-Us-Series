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

  const show = ()=>{ modal.classList.add("show"); document.body.style.overflow="hidden"; };
  const hide = ()=>{ modal.classList.remove("show"); document.body.style.overflow=""; };

  const localAccepted = ()=> localStorage.getItem(TERMS_KEY) === "yes";
  const setLocalAccepted = ()=> localStorage.setItem(TERMS_KEY, "yes");

  async function cloudAccepted(uid){
    if(!uid) return false;
    try{
      const u = await getDoc(doc(db,"users",uid));
      if(!u.exists()) return false;
      const d = u.data() || {};
      return d.termsAccepted === true && d.termsVersion === TERMS_VERSION;
    }catch{
      return false;
    }
  }

  async function setCloudAccepted(uid){
    if(!uid) return;
    try{
      await setDoc(doc(db,"users",uid), {
        termsAccepted: true,
        termsVersion: TERMS_VERSION,
        termsAcceptedAt: serverTimestamp()
      }, { merge:true });
    }catch{}
  }

  async function run(uid){
    if(localAccepted()){ hide(); return; }

    if(uid){
      const ok = await cloudAccepted(uid);
      if(ok){
        setLocalAccepted();
        hide();
        return;
      }
    }
    show();// terms-gate.js
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Must match the "Last updated" date shown in your Terms modal
const TERMS_VERSION = "2026-02-15";
const KEY = `termsAccepted:${TERMS_VERSION}`;

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

  // If already accepted locally, do nothing
  const already = localStorage.getItem(KEY) === "1";
  if (!already) open();

  acceptBtn.addEventListener("click", async () => {
    if (msg) msg.textContent = "";
    if (!agree.checked) {
      if (msg) msg.textContent = "Please check the box to continue.";
      return;
    }

    localStorage.setItem(KEY, "1");

    // Save to cloud if signed in (optional, but useful)
    const user = auth.currentUser;
    if (user) {
      try {
        await setDoc(doc(db, "users", user.uid), {
          termsAcceptedVersion: TERMS_VERSION,
          termsAcceptedAt: serverTimestamp()
        }, { merge: true });
      } catch {}
    }

    close();
  });

  // Keep it locked until accepted
  modal.addEventListener("click", (e) => {
    // do nothing (no click-out)
    e.stopPropagation();
  });

  // If user logs in later, we still keep local as authority for gating
  onAuthStateChanged(auth, () => {});
}

  }

  btn.addEventListener("click", async ()=>{
    if(msg) msg.textContent = "";
    if(!box.checked){
      if(msg) msg.textContent = "Please check the box first.";
      return;
    }
    setLocalAccepted();
    const uid = auth.currentUser?.uid || null;
    if(uid) await setCloudAccepted(uid);
    hide();
  });

  onAuthStateChanged(auth, (user)=>{
    run(user?.uid || null);
  });
}
