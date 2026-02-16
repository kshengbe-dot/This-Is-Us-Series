// reader-community.js
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore,
  collection, doc, getDoc, setDoc, addDoc,
  getDocs, query, orderBy, limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

function esc(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function stars(n){
  const r = Math.max(0, Math.min(5, Math.floor(Number(n) || 0)));
  return "★★★★★".slice(0,r) + "☆☆☆☆☆".slice(0,5-r);
}

function requireSignedIn(){
  const u = auth.currentUser;
  if(!u) throw new Error("Please sign in to post or rate.");
  return u;
}

/* =========================
   COMMENTS
========================= */

export async function renderComments({ bookId="book1", mountId="commentsList", max=50 } = {}){
  const mount = document.getElementById(mountId);
  if(!mount) return;

  mount.innerHTML = `<div style="opacity:.8">Loading…</div>`;

  try{
    const qy = query(
      collection(db, "books", bookId, "comments"),
      orderBy("createdAt", "desc"),
      limit(max)
    );
    const snap = await getDocs(qy);

    if(snap.empty){
      mount.innerHTML = `<div style="opacity:.8">No comments yet. Be the first.</div>`;
      return;
    }

    const rows = [];
    snap.forEach(s=>{
      const d = s.data() || {};
      const name = esc(d.name || "Reader");
      const txt = esc(d.text || "");
      const r = Number(d.rating || 0);
      const when = d.createdAt?.toDate ? d.createdAt.toDate().toLocaleString() : "";
      rows.push(`
        <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:16px;padding:12px;margin:10px 0;">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
            <div style="font-weight:950">${name}</div>
            <div style="opacity:.75;font:700 12px ui-sans-serif,system-ui;">${esc(when)}</div>
          </div>
          ${r ? `<div style="margin-top:6px;opacity:.9;font:900 12px ui-sans-serif,system-ui;">${stars(r)}</div>` : ``}
          <div style="margin-top:8px;line-height:1.55;opacity:.95">${txt}</div>
        </div>
      `);
    });

    mount.innerHTML = rows.join("");
  }catch(e){
    mount.innerHTML = `<div style="color:#ff9b9b">Could not load comments: ${esc(e?.message || String(e))}</div>`;
  }
}

export function setupCommentForm({
  bookId="book1",
  formId="commentForm",
  nameId="cName",
  textId="cText",
  ratingId="cRating",
  msgId="cMsg",
  afterPostReload=true
} = {}){
  const form = document.getElementById(formId);
  if(!form) return;

  const nameEl = document.getElementById(nameId);
  const textEl = document.getElementById(textId);
  const ratingEl = document.getElementById(ratingId);
  const msgEl = document.getElementById(msgId);

  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    if(msgEl) msgEl.textContent = "";

    try{
      const user = requireSignedIn();

      const name = (nameEl?.value || "").trim() || "Reader";
      const text = (textEl?.value || "").trim();
      const rating = Number(ratingEl?.value || 0);

      if(!text){
        if(msgEl) msgEl.textContent = "Write a comment first.";
        return;
      }

      await addDoc(collection(db, "books", bookId, "comments"), {
        uid: user.uid,
        name,
        text,
        rating: (rating >= 1 && rating <= 5) ? rating : 0,
        createdAt: serverTimestamp()
      });

      if(msgEl) msgEl.textContent = "Posted ✅";
      if(textEl) textEl.value = "";

      if(afterPostReload){
        await renderComments({ bookId, mountId: "commentsList", max: 50 });
      }
    }catch(err){
      if(msgEl) msgEl.textContent = err?.message || "Please sign in to comment.";
    }
  });
}

/* =========================
   RATINGS (1 per signed-in user)
   Stored at: books/{bookId}/ratings/{uid}
========================= */

export async function submitRating({ bookId="book1", rating=0 } = {}){
  const user = requireSignedIn();
  const r = Math.max(1, Math.min(5, Math.floor(Number(rating) || 0)));

  await setDoc(doc(db, "books", bookId, "ratings", user.uid), {
    uid: user.uid,
    rating: r,
    updatedAt: serverTimestamp()
  }, { merge:true });

  return r;
}

export async function loadMyRating({ bookId="book1" } = {}){
  const user = auth.currentUser;
  if(!user) return 0;

  try{
    const snap = await getDoc(doc(db, "books", bookId, "ratings", user.uid));
    if(!snap.exists()) return 0;
    const d = snap.data() || {};
    return Number(d.rating || 0);
  }catch{
    return 0;
  }
}

export async function renderRatingSummary({ bookId="book1", mountId="ratingSummary" } = {}){
  const mount = document.getElementById(mountId);
  if(!mount) return;

  mount.textContent = "Loading…";

  try{
    // simple approach: fetch last 500 ratings
    const qy = query(
      collection(db, "books", bookId, "ratings"),
      orderBy("updatedAt","desc"),
      limit(500)
    );
    const snap = await getDocs(qy);

    if(snap.empty){
      mount.textContent = "No ratings yet.";
      return;
    }

    let sum = 0;
    let count = 0;

    snap.forEach(s=>{
      const d = s.data() || {};
      const r = Number(d.rating || 0);
      if(r >= 1 && r <= 5){
        sum += r;
        count += 1;
      }
    });

    if(!count){
      mount.textContent = "No ratings yet.";
      return;
    }

    const avg = sum / count;
    mount.innerHTML = `
      <div style="font:950 18px ui-sans-serif,system-ui;letter-spacing:.02em">${avg.toFixed(2)} / 5</div>
      <div style="opacity:.85;margin-top:4px;font:800 12px ui-sans-serif,system-ui;">${stars(Math.round(avg))} • ${count.toLocaleString()} rating${count===1?"":"s"}</div>
    `;
  }catch(e){
    mount.textContent = "Could not load.";
  }
}

/* =========================
   ACHIEVEMENTS
   - guests: show popups but don't save to Firestore
   - signed-in: save to users/{uid}/achievements/{bookId}
========================= */

function achKey(bookId){ return `ach:${bookId}`; }

function getGuestAch(bookId){
  try{
    return JSON.parse(localStorage.getItem(achKey(bookId)) || "[]");
  }catch{
    return [];
  }
}

function setGuestAch(bookId, arr){
  localStorage.setItem(achKey(bookId), JSON.stringify(arr.slice(0,30)));
}

function toast(msg){
  // tiny toast
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText =
    "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);" +
    "z-index:2000;padding:10px 12px;border-radius:999px;" +
    "border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.55);" +
    "color:#fff;font:900 12px ui-sans-serif,system-ui;letter-spacing:.06em";
  document.body.appendChild(el);
  setTimeout(()=>{ el.style.opacity="0"; el.style.transition="opacity .25s"; }, 1300);
  setTimeout(()=>{ el.remove(); }, 1700);
}

function computeUnlocks({ pageIndex=0, totalPages=1 }){
  // pageIndex is 0-based
  const p = pageIndex + 1;
  const unlocks = [];

  if(p >= 1) unlocks.push({ id:"started", title:"Started", desc:"You opened the book." });
  if(p >= 5) unlocks.push({ id:"warming_up", title:"Warming Up", desc:"You reached page 5." });
  if(p >= 20) unlocks.push({ id:"deep_in", title:"Deep In", desc:"You reached page 20." });
  if(totalPages >= 1 && p >= Math.ceil(totalPages * 0.5)) unlocks.push({ id:"halfway", title:"Halfway", desc:"You reached 50%." });
  if(totalPages >= 1 && p >= Math.ceil(totalPages * 0.9)) unlocks.push({ id:"almost", title:"Almost There", desc:"You reached 90%." });
  if(totalPages >= 1 && p >= totalPages) unlocks.push({ id:"finished", title:"Finished", desc:"You reached the end." });

  return unlocks;
}

export async function trackAchievements({ bookId="book1", pageIndex=0, totalPages=1 } = {}){
  const unlocks = computeUnlocks({ pageIndex, totalPages });
  const user = auth.currentUser;

  if(!user){
    const have = getGuestAch(bookId);
    const haveIds = new Set(have.map(x=>x.id));
    const newly = unlocks.filter(u=>!haveIds.has(u.id));
    if(newly.length){
      const next = have.concat(newly).slice(-30);
      setGuestAch(bookId, next);
      toast(`🏆 Achievement: ${newly[0].title}`);
    }
    return;
  }

  // signed-in: save in Firestore
  const ref = doc(db, "users", user.uid, "achievements", bookId);
  const snap = await getDoc(ref);
  const d = snap.exists() ? (snap.data() || {}) : {};
  const list = Array.isArray(d.items) ? d.items : [];
  const haveIds = new Set(list.map(x=>x.id));
  const newly = unlocks.filter(u=>!haveIds.has(u.id));

  if(!newly.length) return;

  const next = list.concat(newly).slice(-50);
  await setDoc(ref, { items: next, updatedAt: serverTimestamp() }, { merge:true });
  toast(`🏆 Achievement: ${newly[0].title}`);
}

export async function renderMyAchievements({ bookId="book1", mountId="achList" } = {}){
  const mount = document.getElementById(mountId);
  if(!mount) return;

  const user = auth.currentUser;

  if(!user){
    const list = getGuestAch(bookId);
    if(!list.length){
      mount.innerHTML = `<div style="opacity:.8">No achievements yet — start reading.</div>`;
      return;
    }
    mount.innerHTML = list.slice().reverse().map(a=>`
      <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:16px;padding:12px;margin:10px 0;">
        <div style="font-weight:950">${esc(a.title)}</div>
        <div style="opacity:.85;margin-top:6px;line-height:1.5">${esc(a.desc)}</div>
      </div>
    `).join("");
    return;
  }

  mount.textContent = "Loading…";
  try{
    const ref = doc(db, "users", user.uid, "achievements", bookId);
    const snap = await getDoc(ref);
    const d = snap.exists() ? (snap.data() || {}) : {};
    const items = Array.isArray(d.items) ? d.items : [];

    if(!items.length){
      mount.innerHTML = `<div style="opacity:.8">No achievements yet — keep reading.</div>`;
      return;
    }

    mount.innerHTML = items.slice().reverse().map(a=>`
      <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:16px;padding:12px;margin:10px 0;">
        <div style="font-weight:950">${esc(a.title)}</div>
        <div style="opacity:.85;margin-top:6px;line-height:1.5">${esc(a.desc)}</div>
      </div>
    `).join("");
  }catch(e){
    mount.innerHTML = `<div style="color:#ff9b9b">Could not load achievements.</div>`;
  }
}

/* =========================
   GUIDELINES
========================= */

export function guidelinesHTML(){
  return `
    <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:16px;padding:12px;">
      <div style="font-weight:950;letter-spacing:.10em;text-transform:uppercase;font-size:12px;opacity:.9">Community Guidelines</div>
      <div style="margin-top:10px;line-height:1.65;opacity:.92">
        <div><strong>Be respectful.</strong> No harassment, hate, threats, or personal attacks.</div>
        <div style="margin-top:6px"><strong>No spoilers</strong> in titles — use vague phrasing.</div>
        <div style="margin-top:6px"><strong>Keep it clean.</strong> No illegal content or graphic sexual content.</div>
        <div style="margin-top:6px"><strong>Copyright:</strong> Don’t paste chapters or large excerpts.</div>
        <div style="margin-top:10px;opacity:.85">
          The creator may remove comments that violate these rules.
        </div>
      </div>
    </div>
  `;
}
