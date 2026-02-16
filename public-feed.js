// public-feed.js
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore,
  collection, addDoc, serverTimestamp,
  getDocs, query, orderBy, limit,
  doc, getDoc, setDoc, increment
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

function escapeHtml(str) {
  return String(str ?? "")
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

// ------------------------ ANNOUNCEMENTS ------------------------
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

// ------------------------ SUBSCRIBE ------------------------
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

      await setDoc(doc(db, "users", user.uid), {
        notificationEmail: wantsEmail,
        notificationSMS: wantsSMS,
        notifyEmailValue: wantsEmail ? email : null,
        notifyPhoneValue: wantsSMS ? phone : null,
        updatedAt: serverTimestamp()
      }, { merge: true });

      if (msgEl) msgEl.textContent = "Subscribed ✅";
      if (emailEl) emailEl.value = "";
      if (phoneEl) phoneEl.value = "";
    } catch (e2) {
      if (msgEl) msgEl.textContent = "Could not subscribe: " + (e2?.message || String(e2));
    }
  });
}

// ------------------------ STATS (FIXED) ------------------------
export async function bumpReaderCountOnce({ bookId = "book1", uid = null } = {}) {
  const key = `tiu_counted:${bookId}`;
  if (localStorage.getItem(key) === "yes") return;

  const fields = {
    totalReaders: increment(1),
    updatedAt: serverTimestamp()
  };

  if (uid) fields.signedInReaders = increment(1);
  else fields.guestReaders = increment(1);

  try {
    await setDoc(doc(db, "stats", bookId), fields, { merge:true });
    localStorage.setItem(key, "yes");
  } catch {
    // ignore
  }
}

// Backward compat
export function bumpReaderCountsOnce({ bookId = "book1" } = {}) {
  const uid = auth.currentUser?.uid || null;
  return bumpReaderCountOnce({ bookId, uid });
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
