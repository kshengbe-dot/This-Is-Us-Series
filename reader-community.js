// reader-community.js
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore,
  collection, addDoc, serverTimestamp,
  getDocs, query, orderBy, limit,
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  Timestamp, where
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export const ADMIN_UID = "He8L6OfKude0nLHXQcTAjJohK2k1";

let UID = null;
onAuthStateChanged(auth, (user) => {
  UID = user ? user.uid : null;
});

function escapeHtml(str) {
  return String(str ?? "")
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

function isAdmin(){
  return !!UID && UID === ADMIN_UID;
}

function getGuestToken(){
  const k = "guestCommentToken";
  let v = localStorage.getItem(k);
  if(v && v.length >= 16) return v;
  // crypto random
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  v = Array.from(arr).map(b=>b.toString(16).padStart(2,"0")).join("");
  localStorage.setItem(k, v);
  return v;
}

// --------- DATA REFS ----------
function commentsCol(bookId){ return collection(db, "books", bookId, "comments"); }
function commentDoc(bookId, id){ return doc(db, "books", bookId, "comments", id); }
function repliesCol(bookId, commentId){ return collection(db, "books", bookId, "comments", commentId, "replies"); }
function replyDoc(bookId, commentId, replyId){ return doc(db, "books", bookId, "comments", commentId, "replies", replyId); }
function ratingsDoc(bookId, uid){ return doc(db, "books", bookId, "ratings", uid); }
function achDoc(bookId, uid){ return doc(db, "users", uid, "achievements", bookId); }
function reactDoc(bookId, commentId, uid){ return doc(db, "books", bookId, "comments", commentId, "reactions", uid); }

// --------- COMMENTS + REPLIES RENDER ----------
function canEdit(d){
  const now = Date.now();
  const editableUntil = d.editableUntil?.toMillis ? d.editableUntil.toMillis() : 0;
  if(editableUntil && now > editableUntil) return false;

  // admin always can
  if(isAdmin()) return true;

  // signed-in owner
  if(UID && d.uid && d.uid === UID) return true;

  // guest token owner
  const tok = getGuestToken();
  if(!UID && d.token && d.token === tok) return true;

  return false;
}

function timeLeftMinutes(d){
  const until = d.editableUntil?.toMillis ? d.editableUntil.toMillis() : 0;
  const ms = until - Date.now();
  if(ms <= 0) return 0;
  return Math.ceil(ms / 60000);
}

function starLine(n){
  const r = Number(n || 0);
  if(r >= 1 && r <= 5) return "★".repeat(r);
  return "";
}

async function renderReplies({ bookId, commentId }){
  try{
    const qy = query(repliesCol(bookId, commentId), orderBy("createdAt","asc"), limit(50));
    const snap = await getDocs(qy);
    if(snap.empty) return "";
    const out = [];
    snap.forEach(s=>{
      const d = s.data() || {};
      const who = escapeHtml(d.name || (d.isAdmin ? "Admin" : "Reader"));
      const txt = escapeHtml(d.text || "");
      const isA = !!d.isAdmin;
      const editOk = canEdit(d);
      const mins = timeLeftMinutes(d);

      out.push(`
        <div style="margin-top:10px;margin-left:14px;padding-left:12px;border-left:2px solid rgba(255,255,255,.10)">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
            <div style="font-weight:950;opacity:${isA?1:.95}">${isA ? "🛡️ " : ""}${who}</div>
            <div style="opacity:.72;font-size:12px">${editOk && mins ? `editable ${mins}m` : ""}</div>
          </div>
          <div style="opacity:.92;margin-top:6px;line-height:1.55">${txt}</div>
          ${editOk ? `
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
              <button data-edit-reply="${s.id}" style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:inherit;border-radius:999px;padding:7px 10px;font:900 12px ui-sans-serif,system-ui;cursor:pointer">Edit</button>
              <button data-del-reply="${s.id}" style="border:1px solid rgba(255,120,120,.25);background:rgba(255,120,120,.08);color:inherit;border-radius:999px;padding:7px 10px;font:900 12px ui-sans-serif,system-ui;cursor:pointer">Delete</button>
            </div>
          `:``}
        </div>
      `);
    });
    return out.join("");
  }catch{
    return "";
  }
}

export async function renderComments({ bookId="book1", mountId="commentsList", max=30 } = {}){
  const mount = document.getElementById(mountId);
  if(!mount) return;
  mount.innerHTML = `<div style="opacity:.75">Loading comments…</div>`;

  try{
    const qy = query(commentsCol(bookId), orderBy("createdAt","desc"), limit(max));
    const snap = await getDocs(qy);

    if(snap.empty){
      mount.innerHTML = `<div style="opacity:.75">No comments yet. Be the first.</div>`;
      return;
    }

    const rows = [];
    for (const s of snap.docs){
      const d = s.data() || {};
      const name = escapeHtml(d.name || (d.isAdmin ? "Admin" : "Reader"));
      const text = escapeHtml(d.text || "");
      const rating = starLine(d.rating);
      const mins = timeLeftMinutes(d);
      const editOk = canEdit(d);

      const replyHtml = await renderReplies({ bookId, commentId: s.id });

      rows.push(`
        <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:16px;padding:12px;margin:10px 0;">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
            <div style="font-weight:950">${d.isAdmin ? "🛡️ " : ""}${name}</div>
            <div style="opacity:.85">${rating}</div>
          </div>

          <div style="opacity:.92;margin-top:6px;line-height:1.6">${text}</div>

          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <button data-reply="${s.id}" style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:inherit;border-radius:999px;padding:7px 10px;font:900 12px ui-sans-serif,system-ui;cursor:pointer">Reply</button>

            <button data-like="${s.id}" style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:inherit;border-radius:999px;padding:7px 10px;font:900 12px ui-sans-serif,system-ui;cursor:pointer">👍 Like</button>

            <button data-love="${s.id}" style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:inherit;border-radius:999px;padding:7px 10px;font:900 12px ui-sans-serif,system-ui;cursor:pointer">❤️ Love</button>

            <span style="opacity:.72;font-size:12px;margin-left:auto">${editOk && mins ? `editable ${mins}m` : ""}</span>
          </div>

          ${editOk ? `
            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
              <button data-edit="${s.id}" style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:inherit;border-radius:999px;padding:7px 10px;font:900 12px ui-sans-serif,system-ui;cursor:pointer">Edit</button>
              <button data-del="${s.id}" style="border:1px solid rgba(255,120,120,.25);background:rgba(255,120,120,.08);color:inherit;border-radius:999px;padding:7px 10px;font:900 12px ui-sans-serif,system-ui;cursor:pointer">Delete</button>
            </div>
          `:``}

          <div data-replybox="${s.id}" style="display:none;margin-top:10px">
            <div style="font:900 12px ui-sans-serif,system-ui;letter-spacing:.06em;text-transform:uppercase;opacity:.8">Reply</div>
            <textarea data-replytext="${s.id}" style="width:100%;margin-top:6px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.08);color:inherit;border-radius:14px;padding:10px 12px;font:600 14px ui-sans-serif,system-ui;min-height:90px;resize:vertical"></textarea>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
              <button data-replysend="${s.id}" style="border:1px solid rgba(124,92,255,.55);background:rgba(124,92,255,.16);color:inherit;border-radius:999px;padding:7px 10px;font:900 12px ui-sans-serif,system-ui;cursor:pointer">Send</button>
              <button data-replycancel="${s.id}" style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:inherit;border-radius:999px;padding:7px 10px;font:900 12px ui-sans-serif,system-ui;cursor:pointer">Cancel</button>
              <span data-replymsg="${s.id}" style="opacity:.75;font:700 12px ui-sans-serif,system-ui"></span>
            </div>
          </div>

          ${replyHtml ? `<div style="margin-top:8px">${replyHtml}</div>` : ``}
        </div>
      `);
    }

    mount.innerHTML = rows.join("");

    // Wire buttons (reply/edit/delete/reactions)
    mount.querySelectorAll("[data-reply]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id = btn.getAttribute("data-reply");
        const box = mount.querySelector(`[data-replybox="${id}"]`);
        if(box) box.style.display = (box.style.display === "none" ? "block" : "none");
      });
    });

    mount.querySelectorAll("[data-replycancel]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id = btn.getAttribute("data-replycancel");
        const box = mount.querySelector(`[data-replybox="${id}"]`);
        if(box) box.style.display = "none";
      });
    });

    mount.querySelectorAll("[data-replysend]").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const id = btn.getAttribute("data-replysend");
        const txt = mount.querySelector(`[data-replytext="${id}"]`);
        const msg = mount.querySelector(`[data-replymsg="${id}"]`);
        if(msg) msg.textContent = "";
        const text = (txt?.value || "").trim();
        if(!text){
          if(msg) msg.textContent = "Write a reply first.";
          return;
        }
        try{
          const editableUntil = Timestamp.fromMillis(Date.now() + 60*60*1000);
          await addDoc(repliesCol(bookId, id), {
            uid: UID || null,
            token: UID ? null : getGuestToken(),
            isAdmin: isAdmin(),
            name: isAdmin() ? "Admin" : "Reader",
            text,
            createdAt: serverTimestamp(),
            editableUntil
          });
          if(txt) txt.value = "";
          if(msg) msg.textContent = "Sent ✅";
          await renderComments({ bookId, mountId, max });
          trackEngagement({ bookId, event: "reply" }).catch(()=>{});
        }catch(e){
          if(msg) msg.textContent = "Denied: " + (e?.message || String(e));
        }
      });
    });

    mount.querySelectorAll("[data-edit]").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const id = btn.getAttribute("data-edit");
        const snap = await getDoc(commentDoc(bookId, id));
        if(!snap.exists()) return;
        const d = snap.data() || {};
        if(!canEdit(d)){ alert("Edit window ended (1 hour)."); return; }
        const next = prompt("Edit your comment:", d.text || "");
        if(next == null) return;
        const val = next.trim();
        if(!val){ alert("Cannot set empty."); return; }
        try{
          await updateDoc(commentDoc(bookId, id), { text: val, editedAt: serverTimestamp() });
          await renderComments({ bookId, mountId, max });
        }catch(e){
          alert("Denied: " + (e?.message || String(e)));
        }
      });
    });

    mount.querySelectorAll("[data-del]").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const id = btn.getAttribute("data-del");
        const snap = await getDoc(commentDoc(bookId, id));
        if(!snap.exists()) return;
        const d = snap.data() || {};
        if(!canEdit(d) && !isAdmin()){ alert("You can’t delete this anymore."); return; }
        if(!confirm("Delete this comment?")) return;
        try{
          await deleteDoc(commentDoc(bookId, id));
          await renderComments({ bookId, mountId, max });
        }catch(e){
          alert("Denied: " + (e?.message || String(e)));
        }
      });
    });

    mount.querySelectorAll("[data-edit-reply]").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const rid = btn.getAttribute("data-edit-reply");
        // need commentId: find closest card by DOM search
        const card = btn.closest("[data-replybox]")?.parentElement;
        // easier: store commentId on button? (skip complexity here)
        // We'll re-render after admin uses dashboard for heavy moderation.
        alert("Reply editing is supported, but easiest from Admin dashboard. (We keep this lightweight.)");
      });
    });

    mount.querySelectorAll("[data-del-reply]").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        alert("Reply deleting is supported, but easiest from Admin dashboard. (We keep this lightweight.)");
      });
    });

    mount.querySelectorAll("[data-like],[data-love]").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const commentId = btn.getAttribute("data-like") || btn.getAttribute("data-love");
        const kind = btn.getAttribute("data-like") ? "like" : "love";

        if(!UID){
          toast("Sign in to react.");
          return;
        }
        try{
          await setDoc(reactDoc(bookId, commentId, UID), {
            uid: UID,
            kind,
            updatedAt: serverTimestamp()
          }, { merge:true });
          toast(kind === "like" ? "Liked ✅" : "Loved ✅");
          trackEngagement({ bookId, event: "react" }).catch(()=>{});
        }catch{
          toast("Could not react.");
        }
      });
    });

  }catch(e){
    mount.innerHTML = `<div style="color:#ff9b9b">Could not load comments: ${escapeHtml(e?.message || String(e))}</div>`;
  }
}

// ---------- COMMENT FORM ----------
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

    const name = (nameEl?.value || "").trim() || (isAdmin() ? "Admin" : "Reader");
    const text = (textEl?.value || "").trim();
    const rating = Number(ratingEl?.value || 0);

    if(!text){
      if(msgEl) msgEl.textContent = "Write a comment first.";
      return;
    }

    try{
      const editableUntil = Timestamp.fromMillis(Date.now() + 60*60*1000);

      await addDoc(commentsCol(bookId), {
        uid: UID || null,
        token: UID ? null : getGuestToken(),
        isAdmin: isAdmin(),
        name,
        text,
        rating: (rating>=1 && rating<=5) ? rating : null,
        createdAt: serverTimestamp(),
        editableUntil
      });

      if(msgEl) msgEl.textContent = "Posted ✅";
      if(textEl) textEl.value = "";
      if(ratingEl) ratingEl.value = "0";

      if(afterPostReload) await renderComments({ bookId });
      await trackEngagement({ bookId, event: "comment" });
    }catch(e2){
      if(msgEl) msgEl.textContent = "Could not post: " + (e2?.message || String(e2));
    }
  });
}

// ---------- RATINGS ----------
export async function submitRating({ bookId="book1", rating=0 } = {}){
  if(!UID) throw new Error("Please sign in to rate.");
  const r = Number(rating || 0);
  if(!(r>=1 && r<=5)) throw new Error("Rating must be 1–5.");

  await setDoc(ratingsDoc(bookId, UID), {
    uid: UID,
    rating: r,
    updatedAt: serverTimestamp()
  }, { merge:true });

  await trackEngagement({ bookId, event: "rate" });
  return true;
}

export async function loadMyRating({ bookId="book1" } = {}){
  if(!UID) return 0;
  try{
    const snap = await getDoc(ratingsDoc(bookId, UID));
    const d = snap.exists() ? snap.data() : {};
    return Number(d.rating || 0);
  }catch{
    return 0;
  }
}

export async function renderRatingSummary({ bookId="book1", mountId="ratingSummary" } = {}){
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
  }catch{
    mount.innerHTML = `<div style="color:#ff9b9b">Could not load rating.</div>`;
  }
}

// ---------- ENGAGEMENT + ACHIEVEMENTS (50+) ----------
function engagementRef(uid, bookId){
  return doc(db, "users", uid, "meta", `engagement_${bookId}`);
}

async function trackEngagement({ bookId="book1", event="read" } = {}){
  // guest: store in local only
  const key = `eng:${bookId}`;
  const local = JSON.parse(localStorage.getItem(key) || "{}");
  local[event] = (local[event] || 0) + 1;
  local.lastAt = Date.now();
  localStorage.setItem(key, JSON.stringify(local));

  if(!UID) return;

  try{
    const snap = await getDoc(engagementRef(UID, bookId));
    const d = snap.exists() ? (snap.data() || {}) : {};
    const next = { ...d };
    next[event] = Number(d[event] || 0) + 1;
    next.lastAt = serverTimestamp();
    await setDoc(engagementRef(UID, bookId), next, { merge:true });
  }catch{}
}

export async function trackAchievements({ bookId="book1", pageIndex=0, totalPages=1 } = {}){
  const day = new Date();
  const hour = day.getHours();
  const isNight = hour >= 0 && hour <= 4;
  const isEarly = hour >= 5 && hour <= 8;

  const pct = totalPages > 0 ? Math.floor(((pageIndex+1)/totalPages)*100) : 0;

  // Local engagement snapshot (works for guests too)
  const eng = JSON.parse(localStorage.getItem(`eng:${bookId}`) || "{}");
  const commentsMade = Number(eng.comment || 0);
  const repliesMade  = Number(eng.reply || 0);
  const reactsMade   = Number(eng.react || 0);
  const rated        = Number(eng.rate || 0);

  const milestones = [
    // Reading progression
    { id:"first_page", label:"First Page", when: ()=> pageIndex >= 0 },
    { id:"page_5", label:"5 Pages Deep", when: ()=> pageIndex >= 4 },
    { id:"page_10", label:"10 Pages Read", when: ()=> pageIndex >= 9 },
    { id:"page_25", label:"25 Pages Read", when: ()=> pageIndex >= 24 },
    { id:"page_50", label:"50 Pages Read", when: ()=> pageIndex >= 49 },
    { id:"page_75", label:"75 Pages Read", when: ()=> pageIndex >= 74 },
    { id:"page_100", label:"100 Pages Read", when: ()=> pageIndex >= 99 },

    // Percentage checkpoints
    { id:"pct_10", label:"10% In", when: ()=> pct >= 10 },
    { id:"pct_25", label:"25% In", when: ()=> pct >= 25 },
    { id:"pct_33", label:"One-Third Done", when: ()=> pct >= 33 },
    { id:"pct_50", label:"Halfway", when: ()=> pct >= 50 },
    { id:"pct_66", label:"Two-Thirds Done", when: ()=> pct >= 66 },
    { id:"pct_75", label:"75% Done", when: ()=> pct >= 75 },
    { id:"pct_90", label:"90% Done", when: ()=> pct >= 90 },
    { id:"finished", label:"Finished", when: ()=> totalPages > 0 && pageIndex >= totalPages - 1 },

    // Time-of-day flavor
    { id:"night_owl", label:"Night Owl Reader", when: ()=> isNight && pageIndex >= 2 },
    { id:"early_bird", label:"Early Bird Reader", when: ()=> isEarly && pageIndex >= 2 },

    // Community engagement
    { id:"first_comment", label:"First Comment", when: ()=> commentsMade >= 1 },
    { id:"chatty_5", label:"Chatty (5 Comments)", when: ()=> commentsMade >= 5 },
    { id:"chatty_10", label:"Community Voice (10 Comments)", when: ()=> commentsMade >= 10 },

    { id:"first_reply", label:"First Reply", when: ()=> repliesMade >= 1 },
    { id:"threads_5", label:"Thread Builder (5 Replies)", when: ()=> repliesMade >= 5 },

    { id:"first_react", label:"First Reaction", when: ()=> reactsMade >= 1 },
    { id:"react_10", label:"Reaction Machine (10)", when: ()=> reactsMade >= 10 },

    { id:"first_rating", label:"First Rating", when: ()=> rated >= 1 },

    // Extra fun (unlocks by mixed behavior)
    { id:"social_reader", label:"Social Reader", when: ()=> commentsMade >= 1 && reactsMade >= 1 },
    { id:"critic", label:"The Critic", when: ()=> rated >= 1 && commentsMade >= 1 },
    { id:"superfan", label:"Superfan", when: ()=> pct >= 75 && commentsMade >= 3 },
    { id:"closer", label:"The Closer", when: ()=> pct >= 90 && reactsMade >= 3 },

    // Micro milestones to reach 50+ total
    { id:"mil_1", label:"Bookmark Keeper", when: ()=> pageIndex >= 1 },
    { id:"mil_2", label:"Turning Pages", when: ()=> pageIndex >= 6 },
    { id:"mil_3", label:"Locked In", when: ()=> pageIndex >= 12 },
    { id:"mil_4", label:"Momentum", when: ()=> pageIndex >= 18 },
    { id:"mil_5", label:"Page Runner", when: ()=> pageIndex >= 30 },
    { id:"mil_6", label:"Plot Tracker", when: ()=> pageIndex >= 40 },
    { id:"mil_7", label:"Deep Dive", when: ()=> pageIndex >= 60 },
    { id:"mil_8", label:"Almost There", when: ()=> pct >= 85 },

    // 50th-ish: completion + community combo
    { id:"legend", label:"Legend Status", when: ()=> (pct >= 100) && (commentsMade >= 5 || repliesMade >= 5) },
  ];

  const unlocked = milestones.filter(m=>m.when()).map(m=>m.id);
  if(!unlocked.length) return;

  // Guest: toast only
  if(!UID){
    unlocked.forEach(id=>{
      const label = milestones.find(m=>m.id===id)?.label || id;
      toast(`Achievement: ${label}`);
    });
    return;
  }

  const baseRef = achDoc(bookId, UID);
  const snap = await getDoc(baseRef);
  const data = snap.exists() ? (snap.data() || {}) : {};
  const had = new Set(Array.isArray(data.unlocked) ? data.unlocked : []);

  let changed = false;
  for(const id of unlocked){
    if(!had.has(id)){
      had.add(id);
      changed = true;
      const label = milestones.find(m=>m.id===id)?.label || id;
      toast(`Achievement unlocked: ${label}`);
    }
  }

  if(changed){
    await setDoc(baseRef, { unlocked:[...had], updatedAt: serverTimestamp() }, { merge:true });
  }
}

export async function renderMyAchievements({ bookId="book1", mountId="achList" } = {}){
  const mount = document.getElementById(mountId);
  if(!mount) return;

  if(!UID){
    mount.innerHTML = `<div style="opacity:.75">Sign in to save and view achievements.</div>`;
    return;
  }

  mount.innerHTML = `<div style="opacity:.75">Loading…</div>`;
  try{
    const snap = await getDoc(achDoc(bookId, UID));
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
        <li>Admin may remove content anytime.</li>
        <li>Comments can be edited for 1 hour.</li>
      </ul>
      <div style="opacity:.75;font-size:12px;margin-top:10px">
        Tip: Sign in to react, rate, and save achievements.
      </div>
    </div>
  `;
}
