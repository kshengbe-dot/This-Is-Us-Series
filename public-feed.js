// public-feed.js
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore,
  doc, getDoc, setDoc, serverTimestamp,
  runTransaction,
  collection, getDocs, query, orderBy, limit,
  addDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);

// ---------- READER COUNT ----------
function statsDoc(bookId){
  return doc(db, "books", bookId, "public", "stats");
}

export async function bumpReaderCountOnce({ bookId="book1", uid=null } = {}){
  const ref = statsDoc(bookId);
  await runTransaction(db, async (tx)=>{
    const snap = await tx.get(ref);
    const d = snap.exists() ? (snap.data() || {}) : {};
    const cur = Number(d.readerCount || 0);
    tx.set(ref, {
      readerCount: cur + 1,
      lastAt: serverTimestamp(),
      lastUid: uid || null
    }, { merge:true });
  });
}

export async function renderReaderCount({ bookId="book1", mountId="readerCount" } = {}){
  const el = document.getElementById(mountId);
  if(!el) return;
  el.textContent = "—";
  try{
    const snap = await getDoc(statsDoc(bookId));
    const d = snap.exists() ? snap.data() : {};
    el.textContent = String(Number(d.readerCount || 0));
  }catch{
    el.textContent = "—";
  }
}

// ---------- ANNOUNCEMENTS ----------
function announcementsCol(){
  return collection(db, "announcements");
}

function esc(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

export async function renderAnnouncementsList({ mountId="announcementsMount", max=8 } = {}){
  const mount = document.getElementById(mountId);
  if(!mount) return;

  mount.innerHTML = `<div style="opacity:.75">Loading…</div>`;
  try{
    const qy = query(announcementsCol(), orderBy("createdAt","desc"), limit(max));
    const snap = await getDocs(qy);

    if(snap.empty){
      mount.innerHTML = `<div style="opacity:.75">No announcements yet.</div>`;
      return;
    }

    const items = [];
    snap.forEach(s=>{
      const d = s.data() || {};
      const title = esc(d.title || "Update");
      const body = esc(d.body || "");
      items.push(`
        <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:16px;padding:12px;margin:10px 0;">
          <div style="font-weight:950">${title}</div>
          <div style="opacity:.85;line-height:1.5;margin-top:6px">${body}</div>
        </div>
      `);
    });

    mount.innerHTML = items.join("");
  }catch(e){
    mount.innerHTML = `<div style="color:#ff9b9b">Could not load announcements.</div>`;
  }
}

export async function renderAnnouncementSection({ mountId="announceBanner", max=6 } = {}){
  const mount = document.getElementById(mountId);
  if(!mount) return;

  mount.innerHTML = "";
  try{
    const qy = query(announcementsCol(), orderBy("createdAt","desc"), limit(max));
    const snap = await getDocs(qy);

    if(snap.empty){
      mount.innerHTML = `
        <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:18px;padding:12px;">
          <div style="font-weight:950;letter-spacing:.10em;text-transform:uppercase;opacity:.8">Announcements</div>
          <div style="opacity:.8;margin-top:6px;line-height:1.5">No announcements yet.</div>
        </div>
      `;
      return;
    }

    const first = snap.docs[0].data() || {};
    mount.innerHTML = `
      <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:18px;padding:12px;">
        <div style="font-weight:950;letter-spacing:.10em;text-transform:uppercase;opacity:.8">Latest</div>
        <div style="font-weight:950;margin-top:8px">${esc(first.title || "Update")}</div>
        <div style="opacity:.85;margin-top:6px;line-height:1.5">${esc(first.body || "")}</div>
      </div>
    `;
  }catch{
    mount.innerHTML = `
      <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:18px;padding:12px;">
        <div style="font-weight:950;letter-spacing:.10em;text-transform:uppercase;opacity:.8">Announcements</div>
        <div style="opacity:.8;margin-top:6px;line-height:1.5">Could not load announcements.</div>
      </div>
    `;
  }
}

// ---------- SUBSCRIBE ----------
function subsCol(){
  return collection(db, "subscribers");
}

export function setupSubscribeForm({ bookId="book1" } = {}){
  const form = document.getElementById("subscribeForm");
  if(!form) return;

  const emailEl = document.getElementById("subEmail");
  const phoneEl = document.getElementById("subPhone");
  const optEmail = document.getElementById("optEmail");
  const optSMS = document.getElementById("optSMS");
  const msg = document.getElementById("subMsg");

  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    if(msg) msg.textContent = "";

    const wantEmail = !!optEmail?.checked;
    const wantSMS = !!optSMS?.checked;

    const email = (emailEl?.value || "").trim();
    const phone = (phoneEl?.value || "").trim();

    if(!wantEmail && !wantSMS){
      if(msg) msg.textContent = "Select Email and/or SMS first.";
      return;
    }
    if(wantEmail && !email){
      if(msg) msg.textContent = "Email is required if Email notifications are checked.";
      return;
    }
    if(wantSMS && !phone){
      if(msg) msg.textContent = "Phone is required if SMS notifications are checked.";
      return;
    }

    try{
      await addDoc(subsCol(), {
        bookId,
        wantEmail,
        wantSMS,
        email: email || null,
        phone: phone || null,
        createdAt: serverTimestamp()
      });
      if(msg) msg.textContent = "Subscribed ✅";
      if(emailEl) emailEl.value = "";
      if(phoneEl) phoneEl.value = "";
      if(optEmail) optEmail.checked = false;
      if(optSMS) optSMS.checked = false;
    }catch(e2){
      if(msg) msg.textContent = "Could not subscribe: " + (e2?.message || String(e2));
    }
  });
}
