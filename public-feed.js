// public-feed.js (FULL FILE — CLEANED + FIXED)
// - bumpReaderCountOnce(): increments unique readers (caller controls "once")
// - bumpBookOpenStats(): increments opens per page-load (caller can use sessionStorage)
// - announcements + subscriber submit
// ✅ NEW: getActiveReleaseBadge(): reads releases/{bookId} for the Library NEW badge

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore,
  collection, addDoc, serverTimestamp,
  getDocs, query, orderBy, limit, where,
  doc, getDoc, setDoc, increment
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ---------------- helpers ----------------
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function clampStr(s, n = 240){
  const t = String(s ?? "").trim();
  return t.length > n ? (t.slice(0, n-1) + "…") : t;
}

function tsToMs(v){
  if(!v) return null;
  if(typeof v === "number") return v;
  if(v?.toMillis) return v.toMillis();
  if(v?.seconds) return (v.seconds * 1000);
  const d = new Date(v);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function normalizeEmail(email){
  return String(email ?? "").trim().toLowerCase();
}

// ---------------- stats ----------------
function statsRef(bookId){
  return doc(db, "stats", bookId);
}

/**
 * ✅ UNIQUE reader bump (call "once" from caller)
 * - "totalReaders" = unique readers (as your UI expects)
 */
export async function bumpReaderCountOnce({ bookId = "book1", uid = null } = {}){
  const isSignedIn = !!uid;

  try{
    await setDoc(statsRef(bookId), {
      totalReaders: increment(1),
      signedInReaders: increment(isSignedIn ? 1 : 0),
      guestReaders: increment(isSignedIn ? 0 : 1),
      updatedAt: serverTimestamp()
    }, { merge:true });
  }catch{
    // ignore
  }
}

/**
 * ✅ EVERY open bump (per page-load)
 * - "totalOpens" is a separate metric
 */
export async function bumpBookOpenStats(bookId = "book1", uid = null){
  const isSignedIn = !!uid;

  try{
    await setDoc(statsRef(bookId), {
      totalOpens: increment(1),
      signedInOpens: increment(isSignedIn ? 1 : 0),
      guestOpens: increment(isSignedIn ? 0 : 1),
      updatedAt: serverTimestamp()
    }, { merge:true });
  }catch{
    // ignore
  }
}

// ---------------- chapters ----------------
export async function getLatestChapterNumber(bookId = "book1"){
  try{
    const qy = query(
      collection(db, "books", bookId, "chapters"),
      orderBy("chapterNumber","desc"),
      limit(1)
    );
    const snap = await getDocs(qy);
    if(snap.empty) return 0;
    const d = snap.docs[0].data() || {};
    return Number(d.chapterNumber || 0) || 0;
  }catch{
    return 0;
  }
}

export async function getLastSeenChapterSignedIn(bookId = "book1", uid = null){
  if(!uid) return 0;
  try{
    const snap = await getDoc(doc(db, "users", uid, "progress", bookId));
    if(!snap.exists()) return 0;
    const d = snap.data() || {};
    return Number(d.lastSeenChapter || 0) || 0;
  }catch{
    return 0;
  }
}

export async function markLatestSeen(bookId = "book1", uid = null, latestChapter = 0){
  if(!uid) return;
  const n = Number(latestChapter || 0) || 0;
  try{
    await setDoc(doc(db, "users", uid, "progress", bookId), {
      lastSeenChapter: n,
      updatedAt: serverTimestamp()
    }, { merge:true });
  }catch{
    // ignore
  }
}

// ---------------- releases (NEW badge) ----------------
function isActiveWindow(d){
  const now = Date.now();
  const startMs = tsToMs(d.startAt) ?? tsToMs(d.startsAt) ?? tsToMs(d.start) ?? null;
  const endMs   = tsToMs(d.endAt)   ?? tsToMs(d.expiresAt) ?? tsToMs(d.end) ?? null;

  const okStart = (startMs == null) ? true : (now >= startMs);
  const okEnd   = (endMs == null) ? true : (now <= endMs);

  const activeFlag = (d.active === false) ? false : true;
  return activeFlag && okStart && okEnd;
}

/**
 * ✅ Reads releases/{bookId}
 * Returns null if no active badge
 */
export async function getActiveReleaseBadge(bookId = "book1"){
  try{
    const snap = await getDoc(doc(db, "releases", bookId));
    if(!snap.exists()) return null;
    const d = snap.data() || {};
    if(!isActiveWindow(d)) return null;

    const label = String(d.label || "NEW").trim() || "NEW";
    const chapterNumber = Number(d.chapterNumber || 0) || 0;

    return {
      label,
      chapterNumber,
      startAtMs: tsToMs(d.startAt) ?? null,
      endAtMs: tsToMs(d.endAt) ?? null
    };
  }catch{
    return null;
  }
}

// ---------------- announcements ----------------
function isAnnouncementActive(d){
  const now = Date.now();

  const startMs =
    tsToMs(d.startAt) ?? tsToMs(d.startsAt) ?? tsToMs(d.start) ?? tsToMs(d.startDate) ?? null;

  const endMs =
    tsToMs(d.endAt) ?? tsToMs(d.expiresAt) ?? tsToMs(d.end) ?? tsToMs(d.endDate) ?? null;

  const activeFlag = (d.active === false) ? false : true;

  const okStart = (startMs == null) ? true : (now >= startMs);
  const okEnd   = (endMs == null) ? true : (now <= endMs);

  return activeFlag && okStart && okEnd;
}

function pickTitle(d){
  return clampStr(d.title ?? d.heading ?? "Announcement", 90);
}

function pickBody(d){
  return clampStr(d.body ?? d.message ?? d.text ?? "", 340);
}

export async function renderAnnouncements({ mountId = "announceMount", max = 4 } = {}){
  const mount = document.getElementById(mountId);
  if(!mount) return;

  mount.textContent = "Loading…";

  try{
    const qy = query(
      collection(db,"announcements"),
      orderBy("createdAt","desc"),
      limit(Math.max(1, max * 4))
    );
    const snap = await getDocs(qy);

    const rows = [];
    snap.forEach(s=>{
      const d = s.data() || {};
      if(!isAnnouncementActive(d)) return;

      const title = escapeHtml(pickTitle(d));
      const body  = escapeHtml(pickBody(d));

      rows.push(`
        <div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.12);">
          <div style="font-weight:950">${title}</div>
          <div style="opacity:.9;line-height:1.5;margin-top:4px">${body}</div>
        </div>
      `);
    });

    if(!rows.length){
      mount.innerHTML = `<div style="opacity:.75">No active announcements right now.</div>`;
      return;
    }

    mount.innerHTML = rows.slice(0, max).join("");
  }catch{
    mount.textContent = "Could not load announcements.";
  }
}

// ---------------- subscribers ----------------
export async function submitSubscriber({ email, source = "library" } = {}){
  const u = auth.currentUser; // must be signed-in per rules
  if(!u){
    return { ok:false, msg:"Please sign in first, then subscribe." };
  }

  const em = String(email ?? "").trim();
  const lower = normalizeEmail(em);

  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)){
    return { ok:false, msg:"Enter a valid email." };
  }

  try{
    // ✅ IMPORTANT:
    // Do NOT read/query subscribers here (rules block reads for non-admin).
    // Just write. Admin tools dedupe emails anyway.
    await addDoc(collection(db,"subscribers"), {
      email: em,
      emailLower: lower,
      source,
      uid: u.uid,
      createdAt: serverTimestamp()
    });

    return { ok:true, msg:"Subscribed ✅" };
  }catch{
    return { ok:false, msg:"Could not subscribe. Please try again." };
  }
}
