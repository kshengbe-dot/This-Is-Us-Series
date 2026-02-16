// public-feed.js (FULL FILE — shared public stats + announcements + subscribe helpers)
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// -----------------------------
// Refs
// -----------------------------
function statsRef(bookId) {
  // one small doc for totals (cheap + clean)
  return doc(db, "books", bookId, "meta", "stats");
}
function announcementsCol() {
  return collection(db, "announcements");
}
function subscribersCol() {
  return collection(db, "subscribers");
}

// -----------------------------
// Helpers
// -----------------------------
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function looksLikeEmail(v) {
  const s = String(v || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function fmtDate(ts) {
  try {
    if (!ts) return "";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

// -----------------------------
// Public counts (readers, etc.)
// -----------------------------
export async function getBookStats({ bookId = "book1" } = {}) {
  try {
    const snap = await getDoc(statsRef(bookId));
    const d = snap.exists() ? (snap.data() || {}) : {};
    return {
      readersTotal: Number(d.readersTotal || 0),
      readsTotal: Number(d.readsTotal || 0),
      opensTotal: Number(d.opensTotal || 0),
      updatedAt: d.updatedAt || null
    };
  } catch {
    return { readersTotal: 0, readsTotal: 0, opensTotal: 0, updatedAt: null };
  }
}

/**
 * Call when someone opens a book (library -> read.html).
 * - increments opensTotal
 * - increments readersTotal ONCE per device per book (local key)
 */
export async function bumpBookOpen({ bookId = "book1" } = {}) {
  const onceKey = `tiu:uniqueReader:${bookId}`;
  const firstTime = localStorage.getItem(onceKey) !== "1";

  try {
    await runTransaction(db, async (tx) => {
      const ref = statsRef(bookId);
      const snap = await tx.get(ref);
      const d = snap.exists() ? (snap.data() || {}) : {};

      const next = {
        opensTotal: Number(d.opensTotal || 0) + 1,
        updatedAt: serverTimestamp()
      };

      if (firstTime) {
        next.readersTotal = Number(d.readersTotal || 0) + 1;
      }

      if (snap.exists()) tx.update(ref, next);
      else tx.set(ref, { readersTotal: firstTime ? 1 : 0, opensTotal: 1, readsTotal: 0, ...next }, { merge: true });
    });

    if (firstTime) localStorage.setItem(onceKey, "1");
    return true;
  } catch {
    // still mark local so we don't spam attempts
    if (firstTime) localStorage.setItem(onceKey, "1");
    return false;
  }
}

/**
 * Optional: call when user flips pages or starts reading.
 * Keeps a total "readsTotal" (NOT unique).
 */
export async function bumpBookRead({ bookId = "book1", by = 1 } = {}) {
  const n = Math.max(1, Number(by || 1));
  try {
    await runTransaction(db, async (tx) => {
      const ref = statsRef(bookId);
      const snap = await tx.get(ref);
      const d = snap.exists() ? (snap.data() || {}) : {};
      const nextReads = Number(d.readsTotal || 0) + n;

      if (snap.exists()) {
        tx.update(ref, { readsTotal: nextReads, updatedAt: serverTimestamp() });
      } else {
        tx.set(ref, { readersTotal: 0, opensTotal: 0, readsTotal: nextReads, updatedAt: serverTimestamp() }, { merge: true });
      }
    });
    return true;
  } catch {
    return false;
  }
}

// -----------------------------
// Subscribers
// -----------------------------
export async function getSubscribersCount({ max = 2000 } = {}) {
  try {
    const snap = await getDocs(query(subscribersCol(), limit(Math.max(1, Number(max || 2000)))));
    return snap.size;
  } catch {
    return 0;
  }
}

/**
 * Subscribe email to Firestore.
 * Dedupes by emailLower.
 */
export async function subscribeEmail({ email = "", source = "library" } = {}) {
  const raw = String(email || "").trim();
  if (!looksLikeEmail(raw)) throw new Error("Enter a valid email.");

  const emailLower = raw.toLowerCase();

  // check for duplicates
  const existing = await getDocs(query(subscribersCol(), where("emailLower", "==", emailLower), limit(1)));
  if (!existing.empty) return { ok: true, already: true };

  await addDoc(subscribersCol(), {
    email: raw,
    emailLower,
    source: String(source || "library"),
    createdAt: serverTimestamp(),
    uid: auth.currentUser?.uid || null
  });

  return { ok: true, already: false };
}

// -----------------------------
// Announcements
// -----------------------------
export async function getLatestAnnouncement() {
  try {
    const qy = query(
      announcementsCol(),
      where("active", "==", true),
      orderBy("createdAt", "desc"),
      limit(1)
    );
    const snap = await getDocs(qy);
    if (snap.empty) return null;

    const d = snap.docs[0].data() || {};
    return {
      id: snap.docs[0].id,
      title: String(d.title || "Announcement"),
      body: String(d.body || ""),
      createdAt: d.createdAt || null
    };
  } catch {
    return null;
  }
}

/**
 * Render 1-line announcement into any element.
 * Safe for library top line.
 */
export async function renderAnnouncementLine({ mountId = "announceLine" } = {}) {
  const el = document.getElementById(mountId);
  if (!el) return;

  el.textContent = "Loading announcements…";

  const a = await getLatestAnnouncement();
  if (!a) {
    el.textContent = "No announcements right now.";
    return;
  }

  const t = (a.title || "").trim();
  const b = (a.body || "").trim();
  const date = fmtDate(a.createdAt);
  const line = b ? `${t}: ${b}` : t;

  el.textContent = date ? `${line} (${date})` : line;
}

/**
 * Render a clean announcements list (for future use).
 */
export async function renderAnnouncementsList({
  mountId = "announcements",
  max = 6
} = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  mount.innerHTML = `<div style="opacity:.75">Loading…</div>`;

  try {
    const qy = query(
      announcementsCol(),
      where("active", "==", true),
      orderBy("createdAt", "desc"),
      limit(Math.max(1, Number(max || 6)))
    );
    const snap = await getDocs(qy);

    if (snap.empty) {
      mount.innerHTML = `<div style="opacity:.75">No announcements.</div>`;
      return;
    }

    const rows = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data() || {};
      const title = escapeHtml(String(d.title || "Announcement"));
      const body = escapeHtml(String(d.body || ""));
      const date = fmtDate(d.createdAt);

      rows.push(`
        <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:16px;padding:12px;margin:10px 0;">
          <div style="font-weight:950">${title}</div>
          ${date ? `<div style="opacity:.70;font-size:12px;margin-top:2px">${escapeHtml(date)}</div>` : ``}
          ${body ? `<div style="opacity:.92;margin-top:8px;line-height:1.55">${body}</div>` : ``}
        </div>
      `);
    });

    mount.innerHTML = rows.join("");
  } catch {
    mount.innerHTML = `<div style="color:#ff9b9b">Could not load announcements.</div>`;
  }
}

// -----------------------------
// Small convenience: render basic counts
// -----------------------------
export async function renderCounts({
  bookId = "book1",
  readersMountId = "readersTotal",
  subsMountId = "subsTotal"
} = {}) {
  const readersEl = document.getElementById(readersMountId);
  const subsEl = document.getElementById(subsMountId);

  if (readersEl) readersEl.textContent = "— Total";
  if (subsEl) subsEl.textContent = "— Total";

  const [stats, subs] = await Promise.all([
    getBookStats({ bookId }),
    getSubscribersCount({})
  ]);

  if (readersEl) {
    const n = Number(stats.readersTotal || 0);
    readersEl.textContent = n ? `${n} Total` : "— Total";
  }
  if (subsEl) {
    subsEl.textContent = `${Number(subs || 0)} Total`;
  }
}
