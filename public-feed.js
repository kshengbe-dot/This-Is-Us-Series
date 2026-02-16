// public-feed.js (FULL FILE — ANNOUNCEMENTS + SUBSCRIBERS + STATS/COUNTERS)
// Matches YOUR current Admin dashboard collections:
//
// ✅ Announcements:        announcements/{id}
// ✅ Subscribers:          subscribers/{id}
// ✅ Stats (per book):     stats/{bookId}
// ✅ Unique readers:       books/{bookId}/readers/{readerId}
//
// read.html can import: bumpBookOpen, bumpBookRead
// index.html can import: renderAnnouncements, submitSubscriber, renderBookStats

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

function getGuestToken() {
  const k = "tiu_guest_token";
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

function readerDoc(bookId, readerId) {
  return doc(db, "books", bookId, "readers", readerId);
}

function annCol() {
  return collection(db, "announcements");
}

function subCol() {
  return collection(db, "subscribers");
}

function isActiveAnnouncement(d) {
  const now = Date.now();
  const startMs = d?.startAt?.toMillis ? d.startAt.toMillis() : null;
  const endMs = d?.endAt?.toMillis ? d.endAt.toMillis() : null;
  const okStart = startMs == null ? true : now >= startMs;
  const okEnd = endMs == null ? true : now <= endMs;
  return okStart && okEnd;
}

// ---------- 1) Reader/Open counters ----------
/**
 * bumpBookOpen
 * Unique reader counter (increments totalReaders + signedInReaders/guestReaders once per device/user).
 * Also sets lastReaderAt.
 *
 * Safe to call often; it only increments once per readerId.
 */
export async function bumpBookOpen({ bookId = "book1", uid = null } = {}) {
  const readerId = uid || `guest_${getGuestToken()}`;

  // extra local guard (avoids hitting Firestore too much)
  const localKey = `tiu_opened:${bookId}:${readerId}`;
  if (localStorage.getItem(localKey) === "1") return;

  await runTransaction(db, async (tx) => {
    const rRef = readerDoc(bookId, readerId);
    const sRef = statsDoc(bookId);

    const [rSnap, sSnap] = await Promise.all([tx.get(rRef), tx.get(sRef)]);
    if (rSnap.exists()) {
      localStorage.setItem(localKey, "1");
      return;
    }

    const s = sSnap.exists() ? (sSnap.data() || {}) : {};
    const totalReaders = Number(s.totalReaders || 0);
    const signedInReaders = Number(s.signedInReaders || 0);
    const guestReaders = Number(s.guestReaders || 0);

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
      sRef,
      {
        totalReaders: totalReaders + 1,
        signedInReaders: uid ? signedInReaders + 1 : signedInReaders,
        guestReaders: uid ? guestReaders : guestReaders + 1,
        lastReaderAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  });

  localStorage.setItem(localKey, "1");
}

/**
 * bumpBookRead
 * Increments totalReads (page flips / reads). Does NOT need to be unique.
 */
export async function bumpBookRead({ bookId = "book1", by = 1 } = {}) {
  const inc = Math.max(1, Number(by || 1));

  await runTransaction(db, async (tx) => {
    const sRef = statsDoc(bookId);
    const sSnap = await tx.get(sRef);
    const s = sSnap.exists() ? (sSnap.data() || {}) : {};
    const totalReads = Number(s.totalReads || 0);

    tx.set(
      sRef,
      {
        totalReads: totalReads + inc,
        lastReadAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  });
}

/**
 * renderBookStats
 * Reads stats/{bookId} and prints a simple label.
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
    const snap = await getDoc(statsDoc(bookId));
    const d = snap.exists() ? (snap.data() || {}) : {};
    const n = Number(d.totalReaders || 0);
    mount.textContent = template.replace("{n}", String(n));
  } catch {
    mount.textContent = "—";
  }
}

// ---------- 2) Announcements ----------
/**
 * renderAnnouncements
 * Reads from root collection: announcements
 * Filters to "LIVE" using startAt/endAt (same logic as admin dashboard).
 * Pinned first (if pinned:true).
 */
export async function renderAnnouncements({
  mountId = "announcements",
  max = 6,
  bookId = "" // optional future use
} = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  mount.innerHTML = `<div style="opacity:.75">Loading…</div>`;

  try {
    const qy = query(annCol(), orderBy("createdAt", "desc"), limit(Math.max(12, Number(max || 6) * 3)));
    const snap = await getDocs(qy);

    if (snap.empty) {
      mount.innerHTML = `<div style="opacity:.75">No announcements yet.</div>`;
      return;
    }

    const all = [];
    snap.forEach((s) => {
      const d = s.data() || {};
      if (!isActiveAnnouncement(d)) return;

      all.push({
        id: s.id,
        pinned: !!d.pinned,
        title: clampStr(d.title || "Announcement", 120),
        body: clampStr(d.body || "", 2000)
      });
    });

    if (!all.length) {
      mount.innerHTML = `<div style="opacity:.75">No announcements yet.</div>`;
      return;
    }

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
  } catch {
    mount.innerHTML = `<div style="opacity:.75">Could not load announcements.</div>`;
  }
}

// ---------- 3) Subscribers ----------
/**
 * submitSubscriber
 * Writes to: subscribers (root collection) — matches your admin dashboard.
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
