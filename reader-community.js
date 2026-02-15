// reader-community.js (Read page: comments + achievements)
// Safe init: reuses existing Firebase app if already initialized.

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

// ---------- COMMENTS ----------
export async function renderComments({ bookId = "book1", mountId = "commentsList", max = 50 } = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  mount.innerHTML = `<div style="opacity:.75">Loading comments…</div>`;

  try {
    const q = query(
      collection(db, "books", bookId, "comments"),
      orderBy("createdAt", "desc"),
      limit(max)
    );
    const snap = await getDocs(q);

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

// ---------- ACHIEVEMENTS ----------
export async function trackAchievements({ bookId = "book1", pageIndex = 0, totalPages = 1 } = {}) {
  // milestone logic (simple + effective)
  const milestones = [
    { id: "first_page", label: "First Page", when: () => pageIndex >= 0 },
    { id: "ten_pages", label: "10 Pages Read", when: () => pageIndex >= 9 },
    { id: "halfway", label: "Halfway", when: () => totalPages > 0 && pageIndex >= Math.floor(totalPages * 0.5) },
    { id: "finished", label: "Finished", when: () => totalPages > 0 && pageIndex >= totalPages - 1 },
  ];

  const unlocked = milestones.filter(m => m.when()).map(m => m.id);
  if (!unlocked.length) return;

  // Guest: localStorage
  if (!UID) {
    const key = `ach:${bookId}`;
    const prev = new Set(JSON.parse(localStorage.getItem(key) || "[]"));
    let changed = false;
    for (const id of unlocked) {
      if (!prev.has(id)) {
        prev.add(id);
        changed = true;
        toast(`Achievement unlocked: ${milestones.find(m=>m.id===id)?.label || id}`);
      }
    }
    if (changed) localStorage.setItem(key, JSON.stringify([...prev]));
    return;
  }

  // Signed-in: store in Firestore
  const baseRef = doc(db, "users", UID, "achievements", bookId);
  const snap = await getDoc(baseRef);
  const data = snap.exists() ? (snap.data() || {}) : {};
  const had = new Set(Array.isArray(data.unlocked) ? data.unlocked : []);

  let changed = false;
  for (const id of unlocked) {
    if (!had.has(id)) {
      had.add(id);
      changed = true;
      toast(`Achievement unlocked: ${milestones.find(m=>m.id===id)?.label || id}`);
    }
  }

  if (changed) {
    await setDoc(baseRef, { unlocked: [...had], updatedAt: serverTimestamp() }, { merge: true });
  }
}

function toast(text){
  // tiny toast, no CSS changes needed
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

function escapeHtml(str) {
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
