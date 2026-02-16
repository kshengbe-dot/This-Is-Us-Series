// public-feed.js (FULL FILE — COUNTERS + ANNOUNCEMENTS + SUBSCRIBERS)
// Works with your file structure:
// - firebase-config.js
// - index.html (library) can import: renderAnnouncements, submitSubscriber, renderBookStats
// - read.html imports: bumpReaderCountOnce
//
// Firestore layout used (simple + scalable):
// 1) Reader uniqueness + counts (per book)
//    books/{bookId}/readers/{readerId}   (readerId = uid OR guestToken)
//    books/{bookId}/meta/public          { readerCount, lastReaderAt }
//
// 2) Announcements (global, optional per-book)
//    public/announcements/items/{autoId} { title, body, bookId(optional), pinned, createdAt }
//
// 3) Subscribers (global)
//    public/subscribers/items/{autoId}   { email, name, phone, createdAt, source, bookId(optional) }
//
// NOTE: You must set Firestore rules to allow reads for announcements/stats,
// and writes for subscribers + readers (or restrict as you prefer).

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
  // simple guard (not perfect)
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

function readersDoc(bookId, readerId) {
  return doc(db, "books", bookId, "readers", readerId);
}

function publicMetaDoc(bookId) {
  return doc(db, "books", bookId, "meta", "public");
}

function annCol() {
  return collection(db, "public", "announcements", "items");
}

function subCol() {
  return collection(db, "public", "subscribers", "items");
}

// ---------- 1) Reader count (unique per user/token) ----------
/**
 * bumpReaderCountOnce
 * Unique count per UID (signed in) or guest token (guest).
 * Safe to call multiple times; it only increments on first unique.
 *
 * @param {Object} p
 * @param {string} p.bookId
 * @param {string|null} p.uid
 */
export async function bumpReaderCountOnce({ bookId = "book1", uid = null } = {}) {
  const readerId = uid || `guest_${getGuestReaderToken()}`;
  const rRef = readersDoc(bookId, readerId);
  const mRef = publicMetaDoc(bookId);

  await runTransaction(db, async (tx) => {
    const [rSnap, mSnap] = await Promise.all([tx.get(rRef), tx.get(mRef)]);

    // already counted (this reader exists)
    if (rSnap.exists()) return;

    const meta = mSnap.exists() ? (mSnap.data() || {}) : {};
    const current = Number(meta.readerCount || 0);
    const next = current + 1;

    tx.set(
      rRef,
      {
        readerId,
        uid: uid || null,
        kind: uid ? "user" : "guest",
        createdAt: serverTimestamp()
      },
      { merge: true }
    );

    tx.set(
      mRef,
      {
        readerCount: next,
        lastReaderAt: serverTimestamp()
      },
      { merge: true }
    );
  });
}

/**
 * renderBookStats
 * Displays readerCount for a book into a mount element.
 *
 * @param {Object} p
 * @param {string} p.bookId
 * @param {string} p.mountId
 * @param {string} p.template  Use "{n}" placeholder
 */
export async function renderBookStats({
  bookId = "book1",
  mountId = "bookStats",
  template = "Readers: {n}"
} = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  mount.textContent = "Loading…";

  try {
    const snap = await getDoc(publicMetaDoc(bookId));
    const d = snap.exists() ? (snap.data() || {}) : {};
    const n = Number(d.readerCount || 0);
    mount.textContent = template.replace("{n}", String(n));
  } catch {
    mount.textContent = "—";
  }
}

// ---------- 2) Announcements ----------
/**
 * renderAnnouncements
 * Renders a clean list of announcements. Supports pinned first.
 * If bookId is provided, shows:
 * - pinned + global (no bookId)
 * - pinned + matching bookId
 *
 * Docs should look like:
 * { title, body, pinned:boolean, bookId(optional), createdAt }
 */
export async function renderAnnouncements({
  mountId = "announcements",
  max = 6,
  bookId = "" // optional
} = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  mount.innerHTML = `<div style="opacity:.75">Loading…</div>`;

  try {
    // Firestore can't do "OR" easily without indexes; keep it simple:
    // fetch latest N and filter client-side.
    const qy = query(annCol(), orderBy("createdAt", "desc"), limit(Math.max(12, Number(max || 6) * 3)));
    const snap = await getDocs(qy);

    if (snap.empty) {
      mount.innerHTML = `<div style="opacity:.75">No announcements yet.</div>`;
      return;
    }

    const all = [];
    snap.forEach((s) => {
      const d = s.data() || {};
      const aBookId = typeof d.bookId === "string" ? d.bookId : "";
      const ok =
        !bookId ||
        aBookId === "" || // global
        aBookId === bookId; // this book

      if (!ok) return;

      all.push({
        id: s.id,
        pinned: !!d.pinned,
        title: clampStr(d.title || "Announcement", 120),
        body: clampStr(d.body || "", 2000),
        createdAt: d.createdAt || null
      });
    });

    if (!all.length) {
      mount.innerHTML = `<div style="opacity:.75">No announcements yet.</div>`;
      return;
    }

    // pinned first, then newest
    all.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return 0;
    });

    const list = all.slice(0, Math.max(1, Number(max || 6)));

    mount.innerHTML = list
      .map((a) => {
        return `
          <div style="
            border:1px solid rgba(255,255,255,.12);
            background: rgba(255,255,255,.06);
            border-radius:16px;
            padding:12px;
            margin:10px 0;
          ">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
              <div style="font:950 13px ui-sans-serif,system-ui;letter-spacing:.04em">
                ${a.pinned ? "📌 " : ""}${escapeHtml(a.title)}
              </div>
              <div style="opacity:.65;font:800 12px ui-sans-serif,system-ui">${a.pinned ? "Pinned" : ""}</div>
            </div>
            <div style="margin-top:8px;opacity:.92;line-height:1.55;font:600 13px ui-sans-serif,system-ui">
              ${escapeHtml(a.body).replaceAll("\n", "<br>")}
            </div>
          </div>
        `;
      })
      .join("");
  } catch (e) {
    mount.innerHTML = `<div style="color:#ff9b9b">Could not load announcements.</div>`;
  }
}

// ---------- 3) Subscribers ----------
/**
 * submitSubscriber
 * Saves a subscriber to Firestore.
 * You can call this from a form in index.html (library).
 */
export async function submitSubscriber({
  email = "",
  name = "",
  phone = "",
  source = "library",
  bookId = "" // optional
} = {}) {
  const e = normalizeEmail(email);
  if (!e) throw new Error("Enter a valid email.");

  const payload = {
    email: e,
    name: clampStr(name, 80) || null,
    phone: clampStr(phone, 40) || null,
    source: clampStr(source, 30) || "library",
    bookId: clampStr(bookId, 30) || null,
    createdAt: serverTimestamp()
  };

  await addDoc(subCol(), payload);
  return true;
}
