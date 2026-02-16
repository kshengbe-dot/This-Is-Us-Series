// public-feed.js (FULL FILE — ANNOUNCEMENTS FIXED + BACKWARD COMPAT)
//
// ✅ Reader stats + subscribers schema same as before.
// ✅ Announcements now supports MANY admin field shapes:
//    - title/body
//    - title/message
//    - startAt/endAt
//    - postedAt/expiresAt (or expireAt/expireDate/activeUntil)
//    - active/isActive boolean
//
// If announcements still don't show after this, it's almost certainly Firestore rules
// blocking reads on collection "announcements".

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

function tsToMs(v) {
  // Firestore Timestamp
  if (v?.toMillis) return v.toMillis();
  // JS Date
  if (v instanceof Date) return v.getTime();
  // number
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // string date
  if (typeof v === "string" && v.trim()) {
    const ms = Date.parse(v);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
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

// ---------- Firestore refs ----------
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

// ---------- 1) Reader count ----------
export async function bumpReaderCountOnce({ bookId = "book1", uid = null } = {}) {
  const readerId = uid || `guest_${getGuestReaderToken()}`;
  const markerRef = readerMarkerDoc(bookId, readerId);
  const sRef = statsDoc(bookId);

  await runTransaction(db, async (tx) => {
    const [markerSnap, statsSnap] = await Promise.all([tx.get(markerRef), tx.get(sRef)]);
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

// ---------- 2) Announcements (FIXED + COMPAT) ----------
function normalizeAnnouncementDoc(id, d) {
  const title = clampStr(d.title || d.heading || "Announcement", 140);

  // body could be body/message/text/content
  const body = clampStr(
    d.body ?? d.message ?? d.text ?? d.content ?? "",
    3000
  );

  // interpret time window from many possible fields
  const startMs =
    tsToMs(d.startAt) ??
    tsToMs(d.activeFrom) ??
    tsToMs(d.postedAt) ??
    tsToMs(d.createdAt) ??
    null;

  const endMs =
    tsToMs(d.endAt) ??
    tsToMs(d.expiresAt) ??
    tsToMs(d.expireAt) ??
    tsToMs(d.expireDate) ??
    tsToMs(d.activeUntil) ??
    null;

  // interpret "active" boolean if present
  const hasActiveFlag = ("active" in d) || ("isActive" in d);
  const activeFlag = hasActiveFlag ? !!(d.active ?? d.isActive) : true;

  return { id, title, body, startMs, endMs, activeFlag };
}

function isLiveAnnouncement(a, now = Date.now()) {
  if (!a.activeFlag) return false;
  if (a.startMs != null && now < a.startMs) return false;
  if (a.endMs != null && now > a.endMs) return false;
  return true;
}

export async function getLiveAnnouncements({ max = 6 } = {}) {
  const want = Math.max(1, Number(max || 6));

  try {
    // Try ordering by createdAt (most common). If admin doesn't write createdAt,
    // we still fetch and then filter client-side.
    const qy = query(announcementsCol(), orderBy("createdAt", "desc"), limit(50));
    const snap = await getDocs(qy);

    const rows = [];
    snap.forEach((s) => {
      rows.push(normalizeAnnouncementDoc(s.id, s.data() || {}));
    });

    // If createdAt ordering isn't useful (missing fields), we can still sort by startMs fallback.
    rows.sort((a, b) => (b.startMs ?? 0) - (a.startMs ?? 0));

    const live = rows.filter((a) => isLiveAnnouncement(a)).slice(0, want);
    return live;
  } catch (e) {
    // Fallback: fetch without orderBy (in case createdAt field doesn't exist/index weirdness)
    try {
      const snap = await getDocs(query(announcementsCol(), limit(80)));
      const rows = [];
      snap.forEach((s) => rows.push(normalizeAnnouncementDoc(s.id, s.data() || {})));
      rows.sort((a, b) => (b.startMs ?? 0) - (a.startMs ?? 0));
      return rows.filter((a) => isLiveAnnouncement(a)).slice(0, want);
    } catch {
      return [{ id: "err", title: "Announcements unavailable", body: String(e?.message || e), startMs: null, endMs: null, activeFlag: true }];
    }
  }
}

export async function renderAnnouncements({ mountId = "announcements", max = 6 } = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  mount.innerHTML = `<div style="opacity:.75">Loading…</div>`;

  const list = await getLiveAnnouncements({ max });

  // If we returned an error sentinel
  if (list.length === 1 && list[0].id === "err") {
    mount.innerHTML = `<div style="color:#ff9b9b">Could not load announcements: ${escapeHtml(list[0].body)}</div>`;
    return;
  }

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

export async function renderAnnouncementBanner({ mountId = "announceLine" } = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  mount.textContent = "Loading announcements…";

  const list = await getLiveAnnouncements({ max: 1 });

  // error sentinel
  if (list.length === 1 && list[0].id === "err") {
    mount.textContent = "Announcements blocked (check Firestore rules).";
    return;
  }

  if (!list.length) {
    mount.textContent = "No announcements right now.";
    return;
  }

  const a = list[0];
  const line = a.body ? `${a.title}: ${a.body}` : a.title;
  mount.textContent = line.length > 160 ? (line.slice(0, 160) + "…") : line;
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
