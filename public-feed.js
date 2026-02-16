// public-feed.js (FULL FILE — MATCHES admin-9f3k2p.html PATHS)
//
// ✅ Firestore layout (MATCHES ADMIN DASHBOARD):
// 1) Reader uniqueness + counts (per book)
//    stats/{bookId}                        { totalReaders, signedInReaders, guestReaders, updatedAt, lastReaderAt }
//    stats/{bookId}/readers/{readerId}     { uid|null, kind:"user"|"guest", createdAt }
//
// 2) Announcements (global)
//    announcements/{autoId}               { title, body, startAt(optional), endAt(optional), createdAt, createdBy }
//
// 3) Subscribers (global)
//    subscribers/{autoId}                 { email/phone, uid(optional), bookId(optional), notificationEmail/SMS, createdAt, source, name(optional) }
//
// NOTE: Firestore rules must allow:
// - public read: announcements + stats (or at least stats fields you show)
// - public write: subscribers + stats/{bookId}/readers/{readerId}
// - stats/{bookId} update via transaction
//

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  addDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

// ---------- init ----------
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);

// ---------- helpers ----------
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clampStr(s, n = 3000) {
  const t = String(s ?? "").trim();
  return t.length > n ? t.slice(0, n) : t;
}

function normalizeEmail(email) {
  const e = String(email ?? "").trim().toLowerCase();
  if (!e || !e.includes("@") || e.length > 254) return "";
  return e;
}

function getGuestReaderToken() {
  const k = "tiu_guest_reader_token";
  let v = localStorage.getItem(k);
  if (v && v.length >= 16) return v;
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  v = Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(k, v);
  return v;
}

function statsDoc(bookId) {
  return doc(db, "stats", bookId);
}
function readerMarkerDoc(bookId, readerId) {
  return doc(db, "stats", bookId, "readers", readerId);
}
function announcementsCol() {
  return collection(db, "announcements");
}
function subscribersCol() {
  return collection(db, "subscribers");
}

// ---------- 1) Reader count (unique per user/token) ----------
export async function bumpReaderCountOnce({ bookId = "book1", uid = null } = {}) {
  const readerId = uid || `guest_${getGuestReaderToken()}`;
  const markerRef = readerMarkerDoc(bookId, readerId);
  const sRef = statsDoc(bookId);

  await runTransaction(db, async (tx) => {
    const [markerSnap, statsSnap] = await Promise.all([tx.get(markerRef), tx.get(sRef)]);

    // already counted
    if (markerSnap.exists()) return;

    const d = statsSnap.exists() ? (statsSnap.data() || {}) : {};
    const total = Number(d.totalReaders || 0);
    const signed = Number(d.signedInReaders || 0);
    const guest = Number(d.guestReaders || 0);

    const isUser = !!uid;

    tx.set(markerRef, {
      readerId,
      uid: uid || null,
      kind: isUser ? "user" : "guest",
      createdAt: serverTimestamp()
    }, { merge: true });

    tx.set(sRef, {
      totalReaders: total + 1,
      signedInReaders: signed + (isUser ? 1 : 0),
      guestReaders: guest + (isUser ? 0 : 1),
      updatedAt: serverTimestamp(),
      lastReaderAt: serverTimestamp()
    }, { merge: true });
  });
}

export async function getBookStats({ bookId = "book1" } = {}) {
  try {
    const snap = await getDoc(statsDoc(bookId));
    if (!snap.exists()) return { totalReaders: 0, signedInReaders: 0, guestReaders: 0 };
    const d = snap.data() || {};
    return {
      totalReaders: Number(d.totalReaders || 0),
      signedInReaders: Number(d.signedInReaders || 0),
      guestReaders: Number(d.guestReaders || 0)
    };
  } catch {
    return { totalReaders: 0, signedInReaders: 0, guestReaders: 0 };
  }
}

export async function renderBookStats({
  bookId = "book1",
  mountId = "bookStats",
  template = "Readers: {n}"
} = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  mount.textContent = "Loading…";
  try {
    const s = await getBookStats({ bookId });
    mount.textContent = template.replace("{n}", String((s.totalReaders || 0).toLocaleString()));
  } catch {
    mount.textContent = "—";
  }
}

// ---------- 2) Announcements (startAt/endAt live window) ----------
export async function getLiveAnnouncements({ max = 6 } = {}) {
  try {
    const qy = query(
      announcementsCol(),
      orderBy("createdAt", "desc"),
      limit(Math.max(15, Number(max || 6) * 4))
    );
    const snap = await getDocs(qy);
    if (snap.empty) return [];

    const now = Date.now();
    const live = [];

    snap.forEach((s) => {
      const d = s.data() || {};
      const title = clampStr(d.title || "Announcement", 120);
      const body = clampStr(d.body || "", 2000);

      const startMs = d.startAt?.toMillis ? d.startAt.toMillis() : null;
      const endMs = d.endAt?.toMillis ? d.endAt.toMillis() : null;

      const okStart = (startMs == null) ? true : (now >= startMs);
      const okEnd = (endMs == null) ? true : (now <= endMs);

      if (!(okStart && okEnd)) return;

      live.push({ id: s.id, title, body });
    });

    return live.slice(0, Math.max(1, Number(max || 6)));
  } catch {
    return [];
  }
}

export async function renderAnnouncements({ mountId = "announcements", max = 6 } = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  mount.innerHTML = `<div style="opacity:.75">Loading…</div>`;

  const list = await getLiveAnnouncements({ max });
  if (!list.length) {
    mount.innerHTML = `<div style="opacity:.75">No announcements right now.</div>`;
    return;
  }

  mount.innerHTML = list.map((a) => `
    <div style="
      border:1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.06);
      border-radius:16px;
      padding:12px;
      margin:10px 0;
    ">
      <div style="font:950 13px ui-sans-serif,system-ui;letter-spacing:.04em">
        📣 ${escapeHtml(a.title)}
      </div>
      <div style="margin-top:8px;opacity:.92;line-height:1.55;font:600 13px ui-sans-serif,system-ui">
        ${escapeHtml(a.body).replaceAll("\n", "<br>")}
      </div>
    </div>
  `).join("");
}

// Simple “one-line banner” helper for your hero line
export async function renderAnnouncementBanner({ mountId = "announceLine" } = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  mount.textContent = "Loading announcements…";

  const list = await getLiveAnnouncements({ max: 1 });
  if (!list.length) {
    mount.textContent = "No announcements right now.";
    return;
  }

  const a = list[0];
  mount.textContent = a.body ? `${a.title}: ${a.body}` : a.title;
}

// ---------- 3) Subscribers ----------
export async function submitSubscriber({
  email = "",
  name = "",
  phone = "",
  uid = null,
  notificationEmail = true,
  notificationSMS = false,
  source = "library",
  bookId = ""
} = {}) {
  const e = normalizeEmail(email);
  const p = clampStr(phone, 40);

  if (!e && !p) throw new Error("Enter a valid email (or phone).");

  const payload = {
    email: e || null,
    phone: p || null,
    name: clampStr(name, 80) || null,
    uid: uid || null,
    bookId: clampStr(bookId, 30) || null,
    source: clampStr(source, 30) || "library",
    notificationEmail: !!notificationEmail,
    notificationSMS: !!notificationSMS,
    createdAt: serverTimestamp()
  };

  await addDoc(subscribersCol(), payload);
  return true;
}
