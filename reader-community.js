// reader-community.js
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, serverTimestamp,
  getDocs, query, orderBy, limit, doc, setDoc, getDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let UID = null;
onAuthStateChanged(auth, (user) => {
  UID = user ? user.uid : null;
});

function escapeHtml(str) {
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function toast(text){
  const t = document.createElement("div");
  t.textContent = text;
  t.style.cssText = `
    position:fixed; left:50%; bottom:22px; transform:translateX(-50%);
    padding:10px 12px; border-radius:999px;
    border:1px solid rgba(255,255,255,.14);
    background: rgba(0,0,0,.55);
    color: white; font: 800 12px ui-sans-serif,system-ui;
    z-index:9999; backdrop-filter: blur(10px);
  `;
  document.body.appendChild(t);
  setTimeout(()=>{ t.style.opacity="0"; t.style.transition="opacity .35s ease"; }, 1600);
  setTimeout(()=> t.remove(), 2100);
}

// ---------- COMMENTS ----------
export async function renderComments({ bookId = "book1", mountId = "commentsList", max = 50 } = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  mount.innerHTML = `<div style="opacity:.75">Loading comments…</div>`;

  try {
    const qy = query(
      collection(db, "books", bookId, "comments"),
      orderBy("createdAt", "desc"),
      limit(max)
    );
    const snap = await getDocs(qy);

    if (snap.empty) {
      mount.innerHTML = `<div style="opacity:.75">No comments yet. Be the first.</div>`;
      return;
    }

    const rows = [];
    snap.forEach(s => {
      const d = s.data() || {};
      const name = (d.name || "Reader").toString();
      const text = (d.text || "").toString();
      const rating = Number(d.rating || 0);

      rows.push(`
        <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:16px;padding:12px;margin:10px 0;">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
            <div style="font-weight:950">${escapeHtml(name)}</div>
            <div style="opacity:.85">${rating ? "★".repeat(rating) : ""}</div>
          </div>
          <div style="opacity:.9;margin-top:6px;line-height:1.6">${escapeHtml(text)}</div>
        </div>
      `);
    });

    mount.innerHTML = rows.join("");
  } catch (e) {
    mount.innerHTML = `<div style="color:#ff9b9b">Could not load comments: ${escapeHtml(e?.message || String(e))}</div>`;
  }
}

export function setupCommentForm({
  bookId = "book1",
  formId = "commentForm",
  nameId = "cName",
  textId = "cText",
  ratingId = "cRating",
  msgId = "cMsg",
  afterPostReload = true
} = {}) {
  const form = document.getElementById(formId);
  if (!form) return;

  const nameEl = document.getElementById(nameId);
  const textEl = document.getElementById(textId);
  const ratingEl = document.getElementById(ratingId);
  const msgEl = document.getElementById(msgId);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (msgEl) msgEl.textContent = "";

    const name = (nameEl?.value || "").trim() || "Reader";
    const text = (textEl?.value || "").trim();
    const rating = Number(ratingEl?.value || 0);

    if (!text) {
      if (msgEl) msgEl.textContent = "Write a comment first.";
      return;
    }

    try {
      await addDoc(collection(db, "books", bookId, "comments"), {
        name,
        text,
        rating: (rating >= 1 && rating <= 5) ? rating : null,
        createdAt: serverTimestamp()
      });

      if (msgEl) msgEl.textContent = "Posted!";
      if (textEl) textEl.value = "";
      if (ratingEl) ratingEl.value = "0";

      if (afterPostReload) {
        await renderComments({ bookId });
      }
    } catch (e2) {
      if (msgEl) msgEl.textContent = "Could not post: " + (e2?.message || String(e2));
    }
  });
}

// ---------- RATINGS (1 per signed-in user) ----------
export async function submitRating({ bookId="book1", rating=0 } = {}) {
  if(!UID) throw new Error("Please sign in to rate.");
  const r = Number(rating || 0);
  if(!(r >= 1 && r <= 5)) throw new Error("Rating must be 1–5.");
  await setDoc(doc(db, "books", bookId, "ratings", UID), {
    uid: UID,
    rating: r,
    updatedAt: serverTimestamp()
  }, { merge:true });
  return true;
}

export async function loadMyRating({ bookId="book1" } = {}) {
  if(!UID) return 0;
  try{
    const snap = await getDoc(doc(db,"books",bookId,"ratings",UID));
    const d = snap.exists() ? snap.data() : {};
    return Number(d.rating || 0);
  }catch{
    return 0;
  }
}

export async function renderRatingSummary({ bookId="book1", mountId="ratingSummary" } = {}) {
  const mount = document.getElementById(mountId);
  if(!mount) return;

  mount.innerHTML = `<div style="opacity:.75">Loading rating…</div>`;
  try{
    const qy = query(collection(db,"books",bookId,"ratings"), limit(500));
    const snap = await getDocs(qy);
    if(snap.empty){
      mount.innerHTML = `<div style="opacity:.75">No ratings yet.</div>`;
      return;
    }
    let total=0, count=0;
    snap.forEach(s=>{
      const d = s.data() || {};
      const r = Number(d.rating || 0);
      if(r>=1 && r<=5){ total += r; count += 1; }
    });
    const avg = count ? (total/count) : 0;
    mount.innerHTML = `
      <div style="font-weight:950">${avg.toFixed(1)} / 5</div>
      <div style="opacity:.75;font-size:12px;margin-top:4px">${count} rating(s)</div>
    `;
  }catch(e){
    mount.innerHTML = `<div style="color:#ff9b9b">Could not load rating.</div>`;
  }
}

// ---------- ACHIEVEMENTS ----------
export async function trackAchievements({ bookId = "book1", pageIndex = 0, totalPages = 1 } = {}) {
  const milestones = [
    { id: "first_page", label: "First Page", when: () => pageIndex >= 0 },
    { id: "ten_pages", label: "10 Pages Read", when: () => pageIndex >= 9 },
    { id: "halfway", label: "Halfway", when: () => totalPages > 0 && pageIndex >= Math.floor(totalPages * 0.5) },
    { id: "finished", label: "Finished", when: () => totalPages > 0 && pageIndex >= totalPages - 1 },
  ];

  const unlocked = milestones.filter(m => m.when()).map(m => m.id);
  if (!unlocked.length) return;

  if (!UID) {
    // Guest: just toast (no storage)
    unlocked.forEach(id=>{
      const label = milestones.find(m=>m.id===id)?.label || id;
      toast(`Achievement: ${label}`);
    });
    return;
  }

  const baseRef = doc(db, "users", UID, "achievements", bookId);
  const snap = await getDoc(baseRef);
  const data = snap.exists() ? (snap.data() || {}) : {};
  const had = new Set(Array.isArray(data.unlocked) ? data.unlocked : []);

  let changed = false;
  for (const id of unlocked) {
    if (!had.has(id)) {
      had.add(id);
      changed = true;
      const label = milestones.find(m=>m.id===id)?.label || id;
      toast(`Achievement unlocked: ${label}`);
    }
  }

  if (changed) {
    await setDoc(baseRef, { unlocked: [...had], updatedAt: serverTimestamp() }, { merge: true });
  }
}

export async function renderMyAchievements({ bookId="book1", mountId="achList" } = {}) {
  const mount = document.getElementById(mountId);
  if(!mount) return;

  if(!UID){
    mount.innerHTML = `<div style="opacity:.75">Sign in to save and view achievements.</div>`;
    return;
  }

  mount.innerHTML = `<div style="opacity:.75">Loading…</div>`;
  try{
    const snap = await getDoc(doc(db,"users",UID,"achievements",bookId));
    const d = snap.exists() ? snap.data() : {};
    const arr = Array.isArray(d.unlocked) ? d.unlocked : [];
    if(!arr.length){
      mount.innerHTML = `<div style="opacity:.75">No achievements yet. Keep reading.</div>`;
      return;
    }
    mount.innerHTML = arr.map(a=>`
      <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:14px;padding:10px;margin:8px 0;">
        <div style="font-weight:950">${escapeHtml(a)}</div>
      </div>
    `).join("");
  }catch{
    mount.innerHTML = `<div style="color:#ff9b9b">Could not load achievements.</div>`;
  }
}

// ---------- GUIDELINES ----------
export function guidelinesHTML(){
  return `
    <div style="line-height:1.6;opacity:.92">
      <div style="font-weight:950;margin-bottom:6px">Community Guidelines</div>
      <ul style="margin:0;padding-left:18px">
        <li>Be respectful. No harassment or hate.</li>
        <li>No explicit sexual content, threats, or illegal content.</li>
        <li>No spam or advertising.</li>
        <li>Keep spoilers marked or vague when possible.</li>
        <li>The admin may remove content anytime.</li>
      </ul>
      <div style="opacity:.75;font-size:12px;margin-top:10px">
        Tip: Sign in so your achievements and rating are saved.
      </div>
    </div>
  `;
}
