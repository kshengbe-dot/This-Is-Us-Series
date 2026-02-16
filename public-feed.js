// public-feed.js (FULL FILE — Library + Reader compatible, Firebase v12.9.0)
//
// Exports used by index.html:
//   - renderAnnouncements({ mountId, max })
//   - subscribeEmail({ email })
//   - getBookStats({ bookId })
//
// Export used by read.html (and/or reader page):
//   - bumpReaderCountOnce({ bookId, uid })
//
// Firestore layout (simple + works without Cloud Functions):
//   announcements/{autoId}
//     - title: string
//     - body: string
//     - createdAt: serverTimestamp()
//     - pinned: boolean (optional)
//
//   subscribers/{encodedEmail}
//     - email: string
//     - emailLower: string
//     - uid: string|null
//     - createdAt: serverTimestamp()
//     - updatedAt: serverTimestamp()
//     - source: "library" | "reader" | ...
//     - userAgent: string
//
//   books/{bookId}
//     - pages: number (optional but recommended)
//     - readers: number (approx, increments via bumpReaderCountOnce)
//     - updatedAt: serverTimestamp()
//
//   books/{bookId}/readers/{uid}
//     - uid: string
//     - firstSeenAt: serverTimestamp()

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore,
  collection, doc, getDoc, setDoc, addDoc,
  serverTimestamp,
  getDocs, query, orderBy, limit,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

/* ----------------------------- helpers ----------------------------- */

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function fmtWhen(ts){
  try{
    const d = ts?.toDate ? ts.toDate() : null;
    if(!d) return "";
    // short, clean (browser locale)
    return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" });
  }catch{
    return "";
  }
}

function bookRef(bookId){ return doc(db, "books", String(bookId || "book1")); }
function commentsCol(bookId){ return collection(db, "books", String(bookId || "book1"), "comments"); }

/* ----------------------------- announcements ----------------------------- */

export async function renderAnnouncements({ mountId="annMount", max=6 } = {}){
  const mount = document.getElementById(mountId);
  if(!mount) return;

  mount.innerHTML = `<div style="opacity:.75">Loading announcements…</div>`;

  try{
    const qy = query(collection(db, "announcements"), orderBy("createdAt","desc"), limit(Math.max(1, Number(max||6))));
    const snap = await getDocs(qy);

    if(snap.empty){
      mount.innerHTML = `<div style="opacity:.75">No announcements yet.</div>`;
      return;
    }

    const rows = [];
    snap.forEach(s=>{
      const d = s.data() || {};
      const title = escapeHtml(d.title || "Announcement");
      const body  = escapeHtml(d.body || "");
      const when  = fmtWhen(d.createdAt);

      rows.push(`
        <div class="ann">
          <div class="aTop">
            <div class="aTitle">${title}</div>
            <div class="aWhen">${escapeHtml(when)}</div>
          </div>
          <div class="aBody">${body || `<span style="opacity:.75">—</span>`}</div>
        </div>
      `);
    });

    mount.innerHTML = rows.join("");
  }catch(e){
    mount.innerHTML = `<div style="opacity:.75">Could not load announcements.</div>`;
  }
}

/* ----------------------------- subscribe ----------------------------- */

function safeDocIdFromEmail(emailLower){
  // Firestore doc ids can’t contain "/" — encodeURIComponent removes that risk.
  return encodeURIComponent(emailLower);
}

export async function subscribeEmail({ email="", source="library" } = {}){
  const raw = String(email || "").trim();
  if(!raw || !raw.includes("@")) throw new Error("Enter a valid email.");

  const emailLower = raw.toLowerCase();
  const id = safeDocIdFromEmail(emailLower);

  const user = auth.currentUser;
  const uid = user?.uid || null;

  // Upsert so user doesn’t get duplicated
  await setDoc(doc(db, "subscribers", id), {
    email: raw,
    emailLower,
    uid,
    source: String(source || "library"),
    userAgent: (typeof navigator !== "undefined" ? (navigator.userAgent || "") : ""),
    updatedAt: serverTimestamp(),
    // only set createdAt once if new
    createdAt: serverTimestamp()
  }, { merge:true });

  return true;
}

/* ----------------------------- stats ----------------------------- */

// Optional hard fallback (if you haven’t stored pages in Firestore yet)
const FALLBACK_PAGES = {
  book1: null, // put a number here if you want e.g. 120
};

async function countCommentsCheap(bookId){
  // For small communities this is fine.
  // If you grow big later, you’ll want a stored counter.
  try{
    const snap = await getDocs(query(commentsCol(bookId), limit(1200)));
    return snap.size;
  }catch{
    return null;
  }
}

export async function getBookStats({ bookId="book1" } = {}){
  const bid = String(bookId || "book1");

  // 1) Try book doc (fast)
  let pages = null, readers = null;

  try{
    const snap = await getDoc(bookRef(bid));
    if(snap.exists()){
      const d = snap.data() || {};
      const p = Number(d.pages);
      const r = Number(d.readers);
      pages = Number.isFinite(p) && p > 0 ? p : null;
      readers = Number.isFinite(r) && r >= 0 ? r : null;
    }
  }catch{}

  // 2) Fallback pages
  if(!pages){
    const fp = Number(FALLBACK_PAGES[bid]);
    pages = Number.isFinite(fp) && fp > 0 ? fp : null;
  }

  // 3) Comment count (cheap)
  const comments = await countCommentsCheap(bid);

  return {
    bookId: bid,
    pages: pages ?? "—",
    readers: readers ?? "—",
    comments: (comments ?? "—"),
  };
}

/* ----------------------------- reader counter (unique-ish) ----------------------------- */

function localReadKey(bookId, uid){
  const u = uid ? `uid:${uid}` : "guest";
  return `tiu:readOnce:${bookId}:${u}`;
}

export async function bumpReaderCountOnce({ bookId="book1", uid=null } = {}){
  const bid = String(bookId || "book1");
  const key = localReadKey(bid, uid);

  // If already counted locally, stop.
  if(localStorage.getItem(key) === "1") return false;

  // Always set local first to prevent double taps
  localStorage.setItem(key, "1");

  const bRef = bookRef(bid);

  // If signed in, try to be truly unique using /readers/{uid}
  if(uid){
    const rRef = doc(db, "books", bid, "readers", uid);

    try{
      await runTransaction(db, async (tx)=>{
        const [bSnap, rSnap] = await Promise.all([tx.get(bRef), tx.get(rRef)]);

        // If already has reader doc, do not increment
        if(rSnap.exists()) return;

        // Create reader marker
        tx.set(rRef, { uid, firstSeenAt: serverTimestamp() }, { merge:true });

        // Increment approximate counter on book doc
        const d = bSnap.exists() ? (bSnap.data() || {}) : {};
        const prev = Number(d.readers || 0);
        const next = (Number.isFinite(prev) && prev >= 0) ? (prev + 1) : 1;

        tx.set(bRef, { readers: next, updatedAt: serverTimestamp() }, { merge:true });
      });

      return true;
    }catch{
      // If transaction fails, keep local as counted and just stop quietly
      return false;
    }
  }

  // Guest mode: we can only do approximate counting
  try{
    await runTransaction(db, async (tx)=>{
      const bSnap = await tx.get(bRef);
      const d = bSnap.exists() ? (bSnap.data() || {}) : {};
      const prev = Number(d.readers || 0);
      const next = (Number.isFinite(prev) && prev >= 0) ? (prev + 1) : 1;
      tx.set(bRef, { readers: next, updatedAt: serverTimestamp() }, { merge:true });
    });
    return true;
  }catch{
    return false;
  }
}
