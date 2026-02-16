// reader-community.js (DROP-IN REPLACEMENT)
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore,
  collection, addDoc, serverTimestamp,
  getDocs, query, orderBy, limit,
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  Timestamp,
  runTransaction
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

// --------- EDIT WINDOW ----------
function canEdit(d){
  const now = Date.now();
  const editableUntil = d.editableUntil?.toMillis ? d.editableUntil.toMillis() : 0;
  if(editableUntil && now > editableUntil) return false;

  if(isAdmin()) return true;

  if(UID && d.uid && d.uid === UID) return true;

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

// --------- REACTIONS (COUNTS + TOGGLE) ----------
async function toggleReaction({ bookId, commentId, kind }){
  if(!UID){ toast("Sign in to react."); return; }
  if(kind !== "like" && kind !== "love") return;

  const cRef = commentDoc(bookId, commentId);
  const rRef = reactDoc(bookId, commentId, UID);

  try{
    await runTransaction(db, async (tx)=>{
      const [cSnap, rSnap] = await Promise.all([tx.get(cRef), tx.get(rRef)]);
      if(!cSnap.exists()) throw new Error("Missing comment");

      const c = cSnap.data() || {};
      const likeCount = Number(c.reactLikeCount || 0);
      const loveCount = Number(c.reactLoveCount || 0);

      const prevKind = rSnap.exists() ? (rSnap.data()?.kind || null) : null;

      let nextLike = likeCount;
      let nextLove = loveCount;

      // If same kind -> remove reaction (toggle off)
      if(prevKind === kind){
        tx.delete(rRef);
        if(kind === "like") nextLike = Math.max(0, nextLike - 1);
        if(kind === "love") nextLove = Math.max(0, nextLove - 1);
      }else{
        // switching kinds or adding new
        tx.set(rRef, { uid: UID, kind, updatedAt: serverTimestamp() }, { merge:true });

        // remove previous
        if(prevKind === "like") nextLike = Math.max(0, nextLike - 1);
        if(prevKind === "love") nextLove = Math.max(0, nextLove - 1);

        // add new
        if(kind === "like") nextLike += 1;
        if(kind === "love") nextLove += 1;
      }

      tx.update(cRef, { reactLikeCount: nextLike, reactLoveCount: nextLove, reactedAt: serverTimestamp() });
    });

    toast(kind === "like" ? "👍 Updated" : "❤️ Updated");
    trackEngagement({ bookId, event: "react" }).catch(()=>{});
  }catch{
    toast("Could not react.");
  }
}

// --------- REPLIES RENDER ----------
async function renderReplies({ bookId, commentId }){
  try{
    const qy = query(repliesCol(bookId, commentId), orderBy("createdAt","asc"), limit(60));
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
              <button
                data-edit-reply="1"
                data-comment="${commentId}"
                data-reply="${s.id}"
                style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:inherit;border-radius:999px;padding:7px 10px;font:900 12px ui-sans-serif,system-ui;cursor:pointer"
              >Edit</button>

              <button
                data-del-reply="1"
                data-comment="${commentId}"
                data-reply="${s.id}"
                style="border:1px solid rgba(255,120,120,.25);background:rgba(255,120,120,.08);color:inherit;border-radius:999px;padding:7px 10px;font:900 12px ui-sans-serif,system-ui;cursor:pointer"
              >Delete</button>
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

// --------- COMMENTS RENDER ----------
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

      const likeCount = Number(d.reactLikeCount || 0);
      const loveCount = Number(d.reactLoveCount || 0);

      const replyHtml = await renderReplies({ bookId, commentId: s.id });

      rows.push(`
        <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:16px;padding:12px;margin:10px 0;">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
            <div style="font-weight:950">${d.isAdmin ? "🛡️ " : ""}${name}</div>
            <div style="opacity:.85">${rating}</div>
          </div>

          <div style="opacity:.92;margin-top:6px;line-height:1.6">${text}</div>

          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <button
              data-reply="${s.id}"
              style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:inherit;border-radius:999px;padding:7px 10px;font:900 12px ui-sans-serif,system-ui;cursor:pointer"
            >Reply</button>

            <button
              data-react="like"
              data-comment="${s.id}"
              style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:inherit;border-radius:999px;padding:7px 10px;font:900 12px ui-sans-serif,system-ui;cursor:pointer"
            >👍 Like <span style="opacity:.8">(${likeCount})</span></button>

            <button
              data-react="love"
              data-comment="${s.id}"
              style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:inherit;border-radius:999px;padding:7px 10px;font:900 12px ui-sans-serif,system-ui;cursor:pointer"
            >❤️ Love <span style="opacity:.8">(${loveCount})</span></button>

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

    // Reply open/close
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

    // Reply send
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

    // Comment edit
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

    // Comment delete
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

    // Reply edit
    mount.querySelectorAll("[data-edit-reply]").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const commentId = btn.getAttribute("data-comment");
        const replyId = btn.getAttribute("data-reply");
        if(!commentId || !replyId) return;

        const snap = await getDoc(replyDoc(bookId, commentId, replyId));
        if(!snap.exists()) return;
        const d = snap.data() || {};
        if(!canEdit(d)){ alert("Edit window ended (1 hour)."); return; }

        const next = prompt("Edit your reply:", d.text || "");
        if(next == null) return;
        const val = next.trim();
        if(!val){ alert("Cannot set empty."); return; }

        try{
          await updateDoc(replyDoc(bookId, commentId, replyId), { text: val, editedAt: serverTimestamp() });
          await renderComments({ bookId, mountId, max });
        }catch(e){
          alert("Denied: " + (e?.message || String(e)));
        }
      });
    });

    // Reply delete
    mount.querySelectorAll("[data-del-reply]").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const commentId = btn.getAttribute("data-comment");
        const replyId = btn.getAttribute("data-reply");
        if(!commentId || !replyId) return;

        const snap = await getDoc(replyDoc(bookId, commentId, replyId));
        if(!snap.exists()) return;
        const d = snap.data() || {};
        if(!canEdit(d) && !isAdmin()){ alert("You can’t delete this anymore."); return; }
        if(!confirm("Delete this reply?")) return;

        try{
          await deleteDoc(replyDoc(bookId, commentId, replyId));
          await renderComments({ bookId, mountId, max });
        }catch(e){
          alert("Denied: " + (e?.message || String(e)));
        }
      });
    });

    // Reactions toggle (with counts)
    mount.querySelectorAll("[data-react]").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const kind = btn.getAttribute("data-react");
        const commentId = btn.getAttribute("data-comment");
        if(!commentId) return;
        await toggleReaction({ bookId, commentId, kind });
        await renderComments({ bookId, mountId, max }); // refresh counts
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
        editableUntil,

        // reaction counts stored on comment doc
        reactLikeCount: 0,
        reactLoveCount: 0
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
    const qy = query(collection(db,"books",bookId,"ratings"), limit(800));
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

// ---------- COMMENT PREVIEW (LIBRARY WIDGET) ----------
export async function renderCommentPreview({ bookId="book1", mountId="commentPreview", max=4 } = {}){
  const mount = document.getElementById(mountId);
  if(!mount) return;

  mount.innerHTML = `<div style="opacity:.75">Loading…</div>`;
  try{
    const qy = query(commentsCol(bookId), orderBy("createdAt","desc"), limit(max));
    const snap = await getDocs(qy);
    if(snap.empty){
      mount.innerHTML = `<div style="opacity:.75">No comments yet.</div>`;
      return;
    }

    const rows = [];
    snap.forEach(s=>{
      const d = s.data() || {};
      const who = escapeHtml(d.name || (d.isAdmin ? "Admin" : "Reader"));
      const txt = escapeHtml((d.text || "").slice(0, 140)) + ((d.text||"").length > 140 ? "…" : "");
      const like = Number(d.reactLikeCount || 0);
      const love = Number(d.reactLoveCount || 0);

      rows.push(`
        <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:16px;padding:12px;margin:10px 0;">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
            <div style="font-weight:950">${d.isAdmin ? "🛡️ " : ""}${who}</div>
            <div style="opacity:.75;font:900 12px ui-sans-serif,system-ui">👍 ${like} · ❤️ ${love}</div>
          </div>
          <div style="opacity:.90;margin-top:6px;line-height:1.55">${txt}</div>
        </div>
      `);
    });

    mount.innerHTML = rows.join("");
  }catch{
    mount.innerHTML = `<div style="color:#ff9b9b">Could not load preview.</div>`;
  }
}

// ---------- ENGAGEMENT ----------
function engagementRef(uid, bookId){
  return doc(db, "users", uid, "meta", `engagement_${bookId}`);
}

async function trackEngagement({ bookId="book1", event="read" } = {}){
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

// ---------- ACHIEVEMENTS (50+ UNIQUE) ----------
const ACH = [
  // Reading
  ["first_page","First Step"],
  ["page_5","Five Pages Deep"],
  ["page_10","Ten-Page Lock-in"],
  ["page_25","Quarter Stack"],
  ["page_50","Fifty-Page Fighter"],
  ["page_75","Seventy-Five Strong"],
  ["page_100","Centurion Reader"],

  ["pct_10","10% In"],
  ["pct_20","20% In"],
  ["pct_33","One-Third Done"],
  ["pct_50","Halfway Hero"],
  ["pct_66","Two-Thirds Through"],
  ["pct_75","75% Done"],
  ["pct_90","90% Pressure"],
  ["finished","Book Finished"],

  // Time flavor
  ["night_owl","Night Owl Reader"],
  ["early_bird","Early Bird Reader"],
  ["lunch_break","Lunch Break Chapter"],
  ["weekend_reader","Weekend Reader"],

  // Community
  ["first_comment","First Comment"],
  ["comment_3","Comment Trio"],
  ["comment_5","Chatty (5)"],
  ["comment_10","Community Voice (10)"],
  ["first_reply","First Reply"],
  ["reply_3","Thread Starter (3)"],
  ["reply_5","Thread Builder (5)"],
  ["first_react","First Reaction"],
  ["react_5","Reaction Runner (5)"],
  ["react_10","Reaction Machine (10)"],
  ["first_rating","First Rating"],

  // Mixes
  ["social_reader","Social Reader"],
  ["critic","The Critic"],
  ["superfan","Superfan"],
  ["closer","The Closer"],
  ["hype_team","Hype Team"],
  ["deep_thinker","Deep Thinker"],
  ["peacekeeper","Peacekeeper"],
  ["loyal_reader","Loyal Reader"],

  // Progress mini-milestones
  ["mil_1","Bookmark Keeper"],
  ["mil_2","Turning Pages"],
  ["mil_3","Locked In"],
  ["mil_4","Momentum"],
  ["mil_5","Page Runner"],
  ["mil_6","Plot Tracker"],
  ["mil_7","Deep Dive"],
  ["mil_8","Almost There"],
  ["mil_9","Final Stretch"],
  ["mil_10","No Skips"],

  // Extra “cool” ones
  ["mood_vibes","Vibes Only"],
  ["heart_on_sleeve","Heart on Sleeve"],
  ["sharp_eye","Sharp Eye"],
  ["storm_chaser","Storm Chaser"],
  ["quiet_support","Quiet Support"],
  ["scene_breaker","Scene Breaker"],
  ["glow_up","Glow Up"],
  ["legend","Legend Status"],
];

const ACH_MAP = Object.fromEntries(ACH);

export async function trackAchievements({ bookId="book1", pageIndex=0, totalPages=1 } = {}){
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0 Sun

  const isNight = hour >= 0 && hour <= 4;
  const isEarly = hour >= 5 && hour <= 8;
  const isLunch = hour >= 11 && hour <= 13;
  const isWeekend = (day === 0 || day === 6);

  const pct = totalPages > 0 ? Math.floor(((pageIndex+1)/totalPages)*100) : 0;

  const eng = JSON.parse(localStorage.getItem(`eng:${bookId}`) || "{}");
  const commentsMade = Number(eng.comment || 0);
  const repliesMade  = Number(eng.reply || 0);
  const reactsMade   = Number(eng.react || 0);
  const rated        = Number(eng.rate || 0);

  const rules = [
    // pages
    ["first_page", ()=> pageIndex >= 0],
    ["page_5", ()=> pageIndex >= 4],
    ["page_10", ()=> pageIndex >= 9],
    ["page_25", ()=> pageIndex >= 24],
    ["page_50", ()=> pageIndex >= 49],
    ["page_75", ()=> pageIndex >= 74],
    ["page_100", ()=> pageIndex >= 99],

    // pct
    ["pct_10", ()=> pct >= 10],
    ["pct_20", ()=> pct >= 20],
    ["pct_33", ()=> pct >= 33],
    ["pct_50", ()=> pct >= 50],
    ["pct_66", ()=> pct >= 66],
    ["pct_75", ()=> pct >= 75],
    ["pct_90", ()=> pct >= 90],
    ["finished", ()=> totalPages > 0 && pageIndex >= totalPages - 1],

    // time
    ["night_owl", ()=> isNight && pageIndex >= 2],
    ["early_bird", ()=> isEarly && pageIndex >= 2],
    ["lunch_break", ()=> isLunch && pageIndex >= 2],
    ["weekend_reader", ()=> isWeekend && pageIndex >= 2],

    // community counters
    ["first_comment", ()=> commentsMade >= 1],
    ["comment_3", ()=> commentsMade >= 3],
    ["comment_5", ()=> commentsMade >= 5],
    ["comment_10", ()=> commentsMade >= 10],

    ["first_reply", ()=> repliesMade >= 1],
    ["reply_3", ()=> repliesMade >= 3],
    ["reply_5", ()=> repliesMade >= 5],

    ["first_react", ()=> reactsMade >= 1],
    ["react_5", ()=> reactsMade >= 5],
    ["react_10", ()=> reactsMade >= 10],

    ["first_rating", ()=> rated >= 1],

    // mixes
    ["social_reader", ()=> commentsMade >= 1 && reactsMade >= 1],
    ["critic", ()=> rated >= 1 && commentsMade >= 1],
    ["superfan", ()=> pct >= 75 && commentsMade >= 3],
    ["closer", ()=> pct >= 90 && reactsMade >= 3],
    ["hype_team", ()=> reactsMade >= 5 && commentsMade >= 1],
    ["deep_thinker", ()=> commentsMade >= 3 && repliesMade >= 1],
    ["peacekeeper", ()=> repliesMade >= 3],
    ["loyal_reader", ()=> pct >= 50 && (isWeekend || isNight || isEarly)],

    // minis
    ["mil_1", ()=> pageIndex >= 1],
    ["mil_2", ()=> pageIndex >= 6],
    ["mil_3", ()=> pageIndex >= 12],
    ["mil_4", ()=> pageIndex >= 18],
    ["mil_5", ()=> pageIndex >= 30],
    ["mil_6", ()=> pageIndex >= 40],
    ["mil_7", ()=> pageIndex >= 60],
    ["mil_8", ()=> pct >= 85],
    ["mil_9", ()=> pct >= 95],
    ["mil_10", ()=> pct >= 10 && pageIndex >= 10],

    // fun
    ["mood_vibes", ()=> reactsMade >= 1 && pageIndex >= 5],
    ["heart_on_sleeve", ()=> (commentsMade >= 1 && loveCountLocal(bookId) >= 1)],
    ["sharp_eye", ()=> commentsMade >= 1 && pct >= 20],
    ["storm_chaser", ()=> pct >= 33 && isNight],
    ["quiet_support", ()=> repliesMade >= 1 && reactsMade >= 1],
    ["scene_breaker", ()=> pageIndex >= 8],
    ["glow_up", ()=> pct >= 50 && reactsMade >= 3],

    ["legend", ()=> (pct >= 100) && (commentsMade >= 5 || repliesMade >= 5)],
  ];

  const unlocked = rules.filter(([id,fn])=>{
    try{ return !!fn(); }catch{ return false; }
  }).map(([id])=>id);

  if(!unlocked.length) return;

  // Guest: toast only
  if(!UID){
    unlocked.forEach(id=>{
      const label = ACH_MAP[id] || id;
      toast(`Achievement: ${label}`);
    });
    return;
  }

  const ref = achDoc(bookId, UID);
  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() || {}) : {};
  const had = new Set(Array.isArray(data.unlocked) ? data.unlocked : []);

  let changed = false;
  for(const id of unlocked){
    if(!had.has(id)){
      had.add(id);
      changed = true;
      toast(`Achievement unlocked: ${ACH_MAP[id] || id}`);
    }
  }

  if(changed){
    await setDoc(ref, { unlocked:[...had], updatedAt: serverTimestamp() }, { merge:true });
  }
}

// helper for one “fun” achievement
function loveCountLocal(bookId){
  // approximate using engagement, you can expand later
  const eng = JSON.parse(localStorage.getItem(`eng:${bookId}`) || "{}");
  return Number(eng.react || 0);
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

    // newest first if you want (optional)
    const list = [...arr].slice().reverse();

    mount.innerHTML = list.map(id=>`
      <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:14px;padding:10px;margin:8px 0;">
        <div style="font-weight:950">${escapeHtml(ACH_MAP[id] || id)}</div>
        <div style="opacity:.75;font-size:12px;margin-top:4px">${escapeHtml(id)}</div>
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
