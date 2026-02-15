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
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// ------------------------ ANNOUNCEMENTS (ACTIVE WINDOW) ------------------------
export async function renderAnnouncementBanner({
  mountId = "announceBanner",
  max = 5
} = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  mount.innerHTML = "";
  mount.style.display = "none";

  try {
    const qy = query(collection(db, "announcements"), orderBy("createdAt", "desc"), limit(max));
    const snap = await getDocs(qy);
    if (snap.empty) return;

    const now = Date.now();

    // pick first active
    let active = null;
    snap.forEach(d => {
      if (active) return;
      const a = d.data() || {};
      const startMs = a.startAt?.toMillis ? a.startAt.toMillis() : null;
      const endMs   = a.endAt?.toMillis ? a.endAt.toMillis() : null;

      const okStart = (startMs == null) ? true : (now >= startMs);
      const okEnd   = (endMs == null) ? true : (now <= endMs);

      if (okStart && okEnd && (a.title || a.body)) active = a;
    });

    if (!active) return;

    const title = escapeHtml(active.title || "Announcement");
    const body = escapeHtml(active.body || "");
    mount.innerHTML = `
      <div style="
        border:1px solid rgba(255,255,255,.12);
        background: rgba(124,92,255,.12);
        border-radius:18px;
        padding:12px;
        margin-top:14px;
      ">
        <div style="font-weight:950; letter-spacing:.06em">${title}</div>
        <div style="opacity:.9; margin-top:6px; line-height:1.55">${body}</div>
      </div>
    `;
    mount.style.display = "block";
  } catch {
    // fail quietly
  }
}

// optional: modal list
export async function renderAnnouncementsList({ mountId = "announcementsMount", max = 6 } = {}) {
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

    const now = Date.now();
    const cards = [];

    snap.forEach(docu => {
      const d = docu.data() || {};
      const startMs = d.startAt?.toMillis ? d.startAt.toMillis() : null;
      const endMs   = d.endAt?.toMillis ? d.endAt.toMillis() : null;

      const okStart = (startMs == null) ? true : (now >= startMs);
      const okEnd   = (endMs == null) ? true : (now <= endMs);

      const badge = (okStart && okEnd) ? "LIVE" : "ARCHIVED";
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

    // Require account (your requirement)
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
      // store in subscribers (admin can view)
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

      // also store on user profile
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

// ------------------------ STATS: TOTAL READERS (PUBLIC) ------------------------
export async function bumpReaderCountOnce({ bookId = "book1" } = {}) {
  // Only once per device per book
  const key = `readerCounted:${bookId}`;
  if (localStorage.getItem(key) === "1") return;

  try {
    await setDoc(doc(db, "stats", bookId), {
      totalReaders: increment(1),
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
