// terms-gate.js
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export const TERMS_VERSION = 1;
const LS_KEY = `termsAccepted:v${TERMS_VERSION}`;

function lockScroll(lock) { document.body.style.overflow = lock ? "hidden" : ""; }
function openModal(modal){ modal.classList.add("show"); lockScroll(true); }
function closeModal(modal){ modal.classList.remove("show"); lockScroll(false); }

function termsDoc(uid){
  return doc(db, "users", uid, "meta", "terms");
}

async function hasAccepted(uid){
  if (localStorage.getItem(LS_KEY) === "1") return true;
  if (!uid) return false;

  try{
    const snap = await getDoc(termsDoc(uid));
    if(!snap.exists()) return false;
    const d = snap.data() || {};
    return Number(d.version || 0) >= TERMS_VERSION;
  }catch{
    return false;
  }
}

async function saveAccepted(uid){
  localStorage.setItem(LS_KEY, "1");
  if(!uid) return;

  await setDoc(termsDoc(uid), {
    version: TERMS_VERSION,
    acceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge:true });
}

export function wireTermsGate({
  termsModalId="termsModal",
  agreeCheckboxId="agreeTerms",
  acceptBtnId="acceptTermsBtn",
  msgId="termsMsg"
} = {}){
  const modal = document.getElementById(termsModalId);
  const agree = document.getElementById(agreeCheckboxId);
  const btn = document.getElementById(acceptBtnId);
  const msg = document.getElementById(msgId);
  if(!modal || !agree || !btn) return;

  let authResolved = false;

  async function decide(user){
    authResolved = true;
    const uid = user ? user.uid : null;
    const ok = await hasAccepted(uid);
    if(ok) closeModal(modal);
    else openModal(modal);
  }

  btn.addEventListener("click", async ()=>{
    if(msg) msg.textContent = "";
    if(!agree.checked){
      if(msg) msg.textContent = "Please check the agreement box to continue.";
      return;
    }
    try{
      const u = auth.currentUser;
      await saveAccepted(u ? u.uid : null);
      closeModal(modal);
    }catch{
      if(msg) msg.textContent = "Could not save acceptance. Check Firestore rules.";
    }
  });

  onAuthStateChanged(auth, (user)=> decide(user));

  // fallback: if auth is slow, treat as guest after 1.2s (but still waits first)
  setTimeout(()=>{
    if(!authResolved) decide(null);
  }, 1200);
}
