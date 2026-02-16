// public-feed.js
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore,
  doc, getDoc, serverTimestamp,
  runTransaction,
  collection, getDocs, query, orderBy, limit,
  addDoc, where
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
  }catch{
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

export async function renderSubscriberCount({ bookId="book1", mountId="subCount" } = {}){
  const el = document.getElementById(mountId);
  if(!el) return;
  el.textContent = "—";
  try{
    const qy = query(subsCol(), where("bookId","==",bookId), limit(2000));
    const snap = await getDocs(qy);
    el.textContent = String(snap.size || 0);
  }catch{
    el.textContent = "—";
  }
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
// public-feed.js
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore,
  doc, getDoc, setDoc, serverTimestamp,
  runTransaction,
  collection, getDocs, query, orderBy, limit, where,
  addDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);

// ---------- helpers ----------
function toMillis(ts){
  // Firestore Timestamp -> ms
  if(!ts) return null;
  if(typeof ts === "number") return ts;
  if(typeof ts?.toMillis === "function") return ts.toMillis();
  if(typeof ts?.seconds === "number") return (ts.seconds * 1000) + Math.floor((ts.nanoseconds || 0)/1e6);
  return null;
}
function nowMs(){ return Date.now(); }

function esc(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// ---------- STATS DOC (single place for counts) ----------
function statsDoc(bookId){
  // books/{bookId}/public/stats
  return doc(db, "books", bookId, "public", "stats");
}

// ---------- READER COUNT ----------
export async function bumpReaderCountOnce({ bookId="book1", uid=null } = {}){
  const ref = statsDoc(bookId);
  await runTransaction(db, async (tx)=>{
    const snap = await tx.get(ref);
    const d = snap.exists() ? (snap.data() || {}) : {};
    const cur = Number(d.readerCount || 0);
    tx.set(ref, {
      readerCount: cur + 1,
      lastReaderAt: serverTimestamp(),
      lastReaderUid: uid || null
    }, { merge:true });
  });
}

export async function renderReaderCount({ bookId="book1", mountId="readerCount" } = {}){
  const el = document.getElementById(mountId);
  if(!el) return;
  el.textContent = "—";
  try{
    const snap = await getDoc(statsDoc(bookId));
    const d = snap.exists() ? (snap.data() || {}) : {};
    const n = Number(d.readerCount || 0);
    // fallback: if stats missing but we can’t read it, keep —
    el.textContent = String(Number.isFinite(n) ? n : 0);
  }catch{
    el.textContent = "—";
  }
}

// ---------- SUBSCRIBERS ----------
function subsCol(){
  return collection(db, "subscribers");
}

async function bumpSubscriberCount({ bookId="book1" } = {}){
  const ref = statsDoc(bookId);
  await runTransaction(db, async (tx)=>{
    const snap = await tx.get(ref);
    const d = snap.exists() ? (snap.data() || {}) : {};
    const cur = Number(d.subscriberCount || 0);
    tx.set(ref, {
      subscriberCount: cur + 1,
      lastSubAt: serverTimestamp()
    }, { merge:true });
  });
}

export async function renderSubscriberCount({ bookId="book1", mountId="subCount" } = {}){
  const el = document.getElementById(mountId);
  if(!el) return;
  el.textContent = "—";

  try{
    const snap = await getDoc(statsDoc(bookId));
    const d = snap.exists() ? (snap.data() || {}) : {};
    const n = Number(d.subscriberCount || 0);
    el.textContent = String(Number.isFinite(n) ? n : 0);

    // Optional lightweight repair: if stats doc exists but subscriberCount missing, compute once.
    if(!snap.exists() || d.subscriberCount == null){
      try{
        const qy = query(subsCol(), where("bookId","==",bookId));
        const s2 = await getDocs(qy);
        const computed = s2.size || 0;
        el.textContent = String(computed);
        await setDoc(statsDoc(bookId), { subscriberCount: computed, repairedAt: serverTimestamp() }, { merge:true });
      }catch{}
    }
  }catch{
    el.textContent = "—";
  }
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
      // create subscriber record
      await addDoc(subsCol(), {
        bookId,
        wantEmail,
        wantSMS,
        email: email || null,
        phone: phone || null,
        createdAt: serverTimestamp()
      });

      // ✅ increment subscriberCount (this is what makes your counts work)
      await bumpSubscriberCount({ bookId });

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

// ---------- ANNOUNCEMENTS ----------
function announcementsCol(){
  return collection(db, "announcements");
}

function isExpired(d){
  // supports: expiresAt OR endsAt
  const exp = toMillis(d?.expiresAt) ?? toMillis(d?.endsAt);
  return (typeof exp === "number") ? (exp <= nowMs()) : false;
}

function cardWrap(title, body){
  return `
    <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:18px;padding:12px;">
      <div style="font-weight:950;letter-spacing:.10em;text-transform:uppercase;opacity:.8">${title}</div>
      <div style="opacity:.85;margin-top:6px;line-height:1.5">${body}</div>
    </div>
  `;
}

export async function renderAnnouncementsList({ mountId="announcementsMount", max=8 } = {}){
  const mount = document.getElementById(mountId);
  if(!mount) return;

  mount.innerHTML = `<div style="opacity:.75">Loading…</div>`;
  try{
    // fetch extra so expired ones don’t kill the list
    const qy = query(announcementsCol(), orderBy("createdAt","desc"), limit(Math.max(max*3, 12)));
    const snap = await getDocs(qy);

    const items = [];
    snap.forEach(s=>{
      const d = s.data() || {};
      if(isExpired(d)) return; // ✅ auto-disappear
      const title = esc(d.title || "Update");
      const body = esc(d.body || "");
      items.push(`
        <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:16px;padding:12px;margin:10px 0;">
          <div style="font-weight:950">${title}</div>
          <div style="opacity:.85;line-height:1.5;margin-top:6px">${body}</div>
        </div>
      `);
    });

    if(items.length === 0){
      mount.innerHTML = `<div style="opacity:.75">No announcements right now.</div>`;
      return;
    }

    mount.innerHTML = items.slice(0, max).join("");
  }catch{
    mount.innerHTML = `<div style="color:#ff9b9b">Could not load announcements.</div>`;
  }
}

export async function renderAnnouncementSection({ mountId="announceBanner", max=6 } = {}){
  const mount = document.getElementById(mountId);
  if(!mount) return;

  mount.innerHTML = "";
  try{
    // fetch extra so we can skip expired and still find a live one
    const qy = query(announcementsCol(), orderBy("createdAt","desc"), limit(Math.max(max*3, 12)));
    const snap = await getDocs(qy);

    let first = null;
    for(const docSnap of snap.docs){
      const d = docSnap.data() || {};
      if(isExpired(d)) continue;
      first = d;
      break;
    }

    if(!first){
      mount.innerHTML = cardWrap("Announcements", "No announcements right now.");
      return;
    }

    mount.innerHTML = `
      <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:18px;padding:12px;">
        <div style="font-weight:950;letter-spacing:.10em;text-transform:uppercase;opacity:.8">Latest</div>
        <div style="font-weight:950;margin-top:8px">${esc(first.title || "Update")}</div>
        <div style="opacity:.85;margin-top:6px;line-height:1.5">${esc(first.body || "")}</div>
      </div>
    `;
  }catch{
    mount.innerHTML = cardWrap("Announcements", "Could not load announcements.");
  }
}
