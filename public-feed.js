// public-feed.js
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore,
  collection, addDoc, serverTimestamp,
  getDocs, query, orderBy, limit,
  doc, getDoc, setDoc, increment
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

function escapeHtml(str) {
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function toMillisMaybe(ts){
  if(!ts) return null;
  if(typeof ts.toMillis === "function") return ts.toMillis();
  return null;
}

function isActiveAnnouncement(a){
  const now = Date.now();
  const startMs = toMillisMaybe(a.startAt);
  const endMs   = toMillisMaybe(a.endAt);

  const okStart = (startMs == null) ? true : (now >= startMs);
  const okEnd   = (endMs == null) ? true : (now <= endMs);
  return okStart && okEnd;
}

async function getUserOnce(){
  return await new Promise((resolve)=>{
    const unsub = onAuthStateChanged(auth, (u)=>{
      unsub();
      resolve(u || null);
    });
  });
}

// ------------------------ ANNOUNCEMENTS (ALWAYS VISIBLE SECTION) ------------------------
export async function renderAnnouncementSection({ mountId = "announceBanner", max = 10 } = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  mount.innerHTML = "";
  mount.style.display = "none";

  try {
    const qy = query(collection(db, "announcements"), orderBy("createdAt", "desc"), limit(max));
    const snap = await getDocs(qy);
    if (snap.empty) return;

    const active = [];
    snap.forEach(d => {
      const a = d.data() || {};
      if (isActiveAnnouncement(a) && (a.title || a.body)) active.push(a);
    });

    if (!active.length) return;

    const cards = active.map(a => {
      const title = escapeHtml(a.title || "Announcement");
      const body = escapeHtml(a.body || "");
      return `
        <div style="
          border:1px solid rgba(255,255,255,.12);
          background: rgba(124,92,255,.12);
          border-radius:18px;
          padding:12px;
          margin-top:10px;
        ">
          <div style="font-weight:950; letter-spacing:.06em">${title}</div>
          <div style="opacity:.92; margin-top:6px; line-height:1.55">${body}</div>
        </div>
      `;
    }).join("");

    mount.innerHTML = `
      <div style="margin-top:14px">
        <div style="font-weight:950;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.75);font-size:12px">
          Announcements
        </div>
        ${cards}
      </div>
    `;
    mount.style.display = "block";
  } catch {
    // fail quietly
  }
}

export async function renderAnnouncementsList({ mountId = "announcementsMount", max = 8 } = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  mount.innerHTML = `<div style="opacity:.75">Loading…</div>`;

  try {
    const qy = query(collection(db, "announcements"), orderBy("createdAt", "desc"), limit(max));
    const snap = await getDocs(qy);
    if (snap.empty) {
      mount.innerHTML = `<div style="opacity:.75">No announcements yet.</div>`;
      return;
    }

    const cards = [];
    snap.forEach(docu => {
      const d = docu.data() || {};
      const badge = isActiveAnnouncement(d) ? "LIVE" : "ARCHIVED";
      cards.push(`
        <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:16px;padding:12px;margin:10px 0;">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
            <div style="font-weight:950">${escapeHtml(d.title || "Announcement")}</div>
            <div style="font:900 11px ui-sans-serif,system-ui;opacity:.8">${badge}</div>
          </div>
          <div style="opacity:.88;margin-top:6px;line-height:1.5">${escapeHtml(d.body || "")}</div>
        </div>
      `);
    });

    mount.innerHTML = cards.join("");
  } catch (e) {
    mount.innerHTML = `<div style="color:#ff9b9b">Could not load: ${escapeHtml(e?.message || String(e))}</div>`;
  }
}

// ------------------------ SUBSCRIBE (STORE ONLY) ------------------------
export function setupSubscribeForm({
  formId = "subscribeForm",
  emailId = "subEmail",
  phoneId = "subPhone",
  emailOptId = "optEmail",
  smsOptId = "optSMS",
  msgId = "subMsg",
  bookId = "book1"
} = {}) {
  const form = document.getElementById(formId);
  if (!form) return;

  const emailEl = document.getElementById(emailId);
  const phoneEl = document.getElementById(phoneId);
  const emailOpt = document.getElementById(emailOptId);
  const smsOpt = document.getElementById(smsOptId);
  const msgEl = document.getElementById(msgId);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (msgEl) msgEl.textContent = "";

    const user = auth.currentUser;
    if (!user) {
      if (msgEl) msgEl.textContent = "Please sign in (or create an account) to subscribe.";
      return;
    }

    const email = (emailEl?.value || "").trim();
    const phone = (phoneEl?.value || "").trim();
    const wantsEmail = !!emailOpt?.checked;
    const wantsSMS = !!smsOpt?.checked;

    if (!wantsEmail && !wantsSMS) {
      if (msgEl) msgEl.textContent = "Choose Email and/or SMS first.";
      return;
    }
    if (wantsEmail && !email) {
      if (msgEl) msgEl.textContent = "Enter your email to enable email notifications.";
      return;
    }
    if (wantsSMS && !phone) {
      if (msgEl) msgEl.textContent = "Enter your phone number to enable SMS notifications.";
      return;
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (msgEl) msgEl.textContent = "That email doesn’t look right.";
      return;
    }

    try {
      await addDoc(collection(db, "subscribers"), {
        uid: user.uid,
        email: wantsEmail ? email : null,
        phone: wantsSMS ? phone : null,
        notificationEmail: wantsEmail,
        notificationSMS: wantsSMS,
        bookId,
        createdAt: serverTimestamp(),
        consentText: "User opted in to notifications. Carrier rates may apply for SMS.",
        source: location.pathname
      });

      if (msgEl) msgEl.textContent = "Subscribed ✅";
      if (emailEl) emailEl.value = "";
      if (phoneEl) phoneEl.value = "";
    } catch (e2) {
      if (msgEl) msgEl.textContent = "Could not subscribe: " + (e2?.message || String(e2));
    }
  });
}

// ------------------------ STATS: COUNT ONCE PER DEVICE ------------------------
// Counts when a reader STARTS reading (open read.html).
export async function bumpReaderCountOnce({ bookId = "book1" } = {}) {
  const key = `readerCounted:${bookId}`;
  if (localStorage.getItem(key) === "1") return;

  const user = await getUserOnce();
  const signed = !!user;

  try {
    await setDoc(doc(db, "stats", bookId), {
      totalReaders: increment(1),
      guestReaders: increment(signed ? 0 : 1),
      signedInReaders: increment(signed ? 1 : 0),
      updatedAt: serverTimestamp()
    }, { merge: true });

    localStorage.setItem(key, "1");
  } catch {
    // ignore
  }
}

export async function renderReaderCount({ bookId = "book1", mountId = "readerCount" } = {}) {
  const el = document.getElementById(mountId);
  if (!el) return;

  try {
    const snap = await getDoc(doc(db, "stats", bookId));
    const d = snap.exists() ? snap.data() : {};
    const n = Number(d.totalReaders || 0);
    el.textContent = n.toLocaleString();
  } catch {
    el.textContent = "—";
  }
}

// Admin split renderer
export async function renderReaderSplitAdmin({
  bookId="book1",
  totalId="readerTotalAdmin",
  guestId="readerGuestAdmin",
  signedId="readerSignedAdmin"
} = {}) {
  const tEl = document.getElementById(totalId);
  const gEl = document.getElementById(guestId);
  const sEl = document.getElementById(signedId);

  try{
    const snap = await getDoc(doc(db,"stats",bookId));
    const d = snap.exists() ? snap.data() : {};
    if(tEl) tEl.textContent = Number(d.totalReaders || 0).toLocaleString();
    if(gEl) gEl.textContent = Number(d.guestReaders || 0).toLocaleString();
    if(sEl) sEl.textContent = Number(d.signedInReaders || 0).toLocaleString();
  }catch{
    if(tEl) tEl.textContent = "—";
    if(gEl) gEl.textContent = "—";
    if(sEl) sEl.textContent = "—";
  }
}

// Admin baseline/backfill (manual): lets you set starting totals to include past readers
export async function adminSetReaderBaseline({
  bookId="book1",
  total=0,
  guest=0,
  signed=0
} = {}) {
  // This only works if Firestore rules allow (admin can do it by being signed-in and you do it in admin UI)
  total = Number(total||0);
  guest = Number(guest||0);
  signed = Number(signed||0);
  if(total < 0 || guest < 0 || signed < 0) throw new Error("Baseline cannot be negative.");
  if(guest + signed > total) throw new Error("Guest + Signed cannot exceed Total.");

  await setDoc(doc(db,"stats",bookId), {
    totalReaders: total,
    guestReaders: guest,
    signedInReaders: signed,
    updatedAt: serverTimestamp()
  }, { merge: true });

  return true;
}
