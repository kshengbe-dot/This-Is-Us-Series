// reader-community.js (FULL FILE — INTEGRATED + CLEAN)

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  getDocs,
  query,
  orderBy,
  limit,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  Timestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// 🔐 set your admin UID
export const ADMIN_UID = "He8L6OfKude0nLHXQcTAjJohK2k1";

let UID = null;
onAuthStateChanged(auth, (user) => {
  UID = user ? user.uid : null;
});

// ---------- helpers ----------
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(text) {
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
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transition = "opacity .35s ease";
  }, 1600);
  setTimeout(() => t.remove(), 2100);
}

function isAdmin() {
  return !!UID && UID === ADMIN_UID;
}

function mustSignIn(actionLabel = "do that") {
  if (UID) return true;
  toast(`Sign in to ${actionLabel}.`);
  return false;
}

function starLine(n) {
  const r = Number(n || 0);
  if (r >= 1 && r <= 5) return "★".repeat(r);
  return "";
}

// ---------- PROFILE CACHE ----------
const profileCache = new Map(); // uid -> { photoURL, displayName }
const profileInFlight = new Map(); // uid -> Promise

function userDoc(uid) {
  return doc(db, "users", uid);
}

async function getProfile(uid) {
  if (!uid) return { photoURL: null, displayName: null };
  if (profileCache.has(uid)) return profileCache.get(uid);

  if (profileInFlight.has(uid)) return await profileInFlight.get(uid);

  const p = (async () => {
    try {
      const snap = await getDoc(userDoc(uid));
      const d = snap.exists() ? (snap.data() || {}) : {};
      const out = {
        photoURL:
          (typeof d.photoURL === "string" && d.photoURL.trim())
            ? d.photoURL.trim()
            : (auth.currentUser?.uid === uid ? (auth.currentUser?.photoURL || null) : null),
        displayName:
          (typeof d.displayName === "string" && d.displayName.trim())
            ? d.displayName.trim()
            : (auth.currentUser?.uid === uid ? (auth.currentUser?.displayName || null) : null)
      };
      profileCache.set(uid, out);
      return out;
    } catch {
      const out = { photoURL: null, displayName: null };
      profileCache.set(uid, out);
      return out;
    } finally {
      profileInFlight.delete(uid);
    }
  })();

  profileInFlight.set(uid, p);
  return await p;
}

function avatarHTML(photoURL) {
  const url = (typeof photoURL === "string" && photoURL.trim()) ? photoURL.trim() : "";
  if (!url) {
    return `
      <div style="
        width:36px;height:36px;border-radius:50%;
        border:1px solid rgba(255,255,255,.14);
        background: rgba(255,255,255,.06);
        display:flex;align-items:center;justify-content:center;
        font-weight:950; opacity:.9;
        flex:none;
      ">👤</div>
    `;
  }
  return `
    <div style="
      width:36px;height:36px;border-radius:50%;
      border:1px solid rgba(255,255,255,.14);
      background: rgba(255,255,255,.06);
      overflow:hidden;
      flex:none;
    ">
      <img src="${escapeHtml(url)}" alt="Profile" style="width:100%;height:100%;object-fit:cover;display:block">
    </div>
  `;
}

// ---------- Firestore refs ----------
function commentsCol(bookId) {
  return collection(db, "books", bookId, "comments");
}
function commentDoc(bookId, id) {
  return doc(db, "books", bookId, "comments", id);
}
function repliesCol(bookId, commentId) {
  return collection(db, "books", bookId, "comments", commentId, "replies");
}
function replyDoc(bookId, commentId, replyId) {
  return doc(db, "books", bookId, "comments", commentId, "replies", replyId);
}
function ratingsDoc(bookId, uid) {
  return doc(db, "books", bookId, "ratings", uid);
}
function achDoc(bookId, uid) {
  return doc(db, "users", uid, "achievements", bookId);
}
function reactDoc(bookId, commentId, uid) {
  return doc(db, "books", bookId, "comments", commentId, "reactions", uid);
}

// ---------- Edit window (1 hour) ----------
function canEdit(d) {
  const now = Date.now();
  const editableUntil = d.editableUntil?.toMillis ? d.editableUntil.toMillis() : 0;
  if (editableUntil && now > editableUntil) return false;
  if (isAdmin()) return true;
  if (UID && d.uid && d.uid === UID) return true;
  return false;
}
function timeLeftMinutes(d) {
  const until = d.editableUntil?.toMillis ? d.editableUntil.toMillis() : 0;
  const ms = until - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 60000);
}

// ---------- Engagement tracking ----------
function engagementRef(uid, bookId) {
  return doc(db, "users", uid, "meta", `engagement_${bookId}`);
}
async function trackEngagement({ bookId = "book1", event = "read" } = {}) {
  const key = `eng:${bookId}`;
  const local = JSON.parse(localStorage.getItem(key) || "{}");
  local[event] = (local[event] || 0) + 1;
  local.lastAt = Date.now();
  localStorage.setItem(key, JSON.stringify(local));

  if (!UID) return;

  try {
    const snap = await getDoc(engagementRef(UID, bookId));
    const d = snap.exists() ? (snap.data() || {}) : {};
    const next = { ...d };
    next[event] = Number(d[event] || 0) + 1;
    next.lastAt = serverTimestamp();
    await setDoc(engagementRef(UID, bookId), next, { merge: true });
  } catch {}
}

// ---------- Reactions ----------
async function toggleReaction({ bookId, commentId, kind }) {
  if (!mustSignIn("react")) return;
  if (kind !== "like" && kind !== "love") return;

  const cRef = commentDoc(bookId, commentId);
  const rRef = reactDoc(bookId, commentId, UID);

  try {
    await runTransaction(db, async (tx) => {
      const [cSnap, rSnap] = await Promise.all([tx.get(cRef), tx.get(rRef)]);
      if (!cSnap.exists()) throw new Error("Missing comment");

      const c = cSnap.data() || {};
      const likeCount = Number(c.reactLikeCount || 0);
      const loveCount = Number(c.reactLoveCount || 0);

      const prevKind = rSnap.exists() ? (rSnap.data()?.kind || null) : null;

      let nextLike = likeCount;
      let nextLove = loveCount;

      if (prevKind === kind) {
        tx.delete(rRef);
        if (kind === "like") nextLike = Math.max(0, nextLike - 1);
        if (kind === "love") nextLove = Math.max(0, nextLove - 1);
      } else {
        tx.set(rRef, { uid: UID, kind, updatedAt: serverTimestamp() }, { merge: true });

        if (prevKind === "like") nextLike = Math.max(0, nextLike - 1);
        if (prevKind === "love") nextLove = Math.max(0, nextLove - 1);

        if (kind === "like") nextLike += 1;
        if (kind === "love") nextLove += 1;
      }

      tx.update(cRef, {
        reactLikeCount: nextLike,
        reactLoveCount: nextLove,
        reactedAt: serverTimestamp()
      });
    });

    toast(kind === "like" ? "👍 Updated" : "❤️ Updated");
    trackEngagement({ bookId, event: "react" }).catch(() => {});
  } catch {
    toast("Could not react.");
  }
}

// ---------- Replies render ----------
async function renderReplies({ bookId, commentId }) {
  try {
    const qy = query(repliesCol(bookId, commentId), orderBy("createdAt", "asc"), limit(60));
    const snap = await getDocs(qy);
    if (snap.empty) return "";

    const uids = new Set();
    snap.forEach((s) => {
      const d = s.data() || {};
      if (d.uid) uids.add(d.uid);
    });
    await Promise.all([...uids].map((uid) => getProfile(uid)));

    const out = [];
    snap.forEach((s) => {
      const d = s.data() || {};
      const isA = !!d.isAdmin;

      const editOk = canEdit(d);
      const mins = timeLeftMinutes(d);

      const who = escapeHtml(d.name || (isA ? "Admin" : "Reader"));
      const txt = escapeHtml(d.text || "");

      const cached = d.uid ? (profileCache.get(d.uid) || {}) : {};
      const photo = d.photoURL || cached.photoURL || null;

      out.push(`
        <div style="margin-top:10px;margin-left:14px;padding-left:12px;border-left:2px solid rgba(255,255,255,.10)">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
            <div style="display:flex;gap:10px;align-items:center;min-width:0">
              ${avatarHTML(photo)}
              <div style="min-width:0">
                <div style="font-weight:950;opacity:${isA ? 1 : .95};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:52vw">
                  ${isA ? "🛡️ " : ""}${who}
                </div>
              </div>
            </div>
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
          ` : ``}
        </div>
      `);
    });

    return out.join("");
  } catch {
    return "";
  }
}

// ---------- COMMENTS RENDER ----------
export async function renderComments({ bookId = "book1", mountId = "commentsList", max = 30 } = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  mount.innerHTML = `<div style="opacity:.75">Loading comments…</div>`;

  try {
    const qy = query(commentsCol(bookId), orderBy("createdAt", "desc"), limit(max));
    const snap = await getDocs(qy);

    if (snap.empty) {
      mount.innerHTML = `<div style="opacity:.75">No comments yet.</div>`;
      return;
    }

    const uids = new Set();
    snap.forEach((s) => {
      const d = s.data() || {};
      if (d.uid) uids.add(d.uid);
    });
    await Promise.all([...uids].map((uid) => getProfile(uid)));

    const rows = [];
    for (const s of snap.docs) {
      const d = s.data() || {};
      const isA = !!d.isAdmin;

      const name = escapeHtml(d.name || (isA ? "Admin" : "Reader"));
      const text = escapeHtml(d.text || "");
      const rating = starLine(d.rating);
      const mins = timeLeftMinutes(d);
      const editOk = canEdit(d);

      const likeCount = Number(d.reactLikeCount || 0);
      const loveCount = Number(d.reactLoveCount || 0);

      const cached = d.uid ? (profileCache.get(d.uid) || {}) : {};
      const photo = d.photoURL || cached.photoURL || null;

      const replyHtml = await renderReplies({ bookId, commentId: s.id });

      rows.push(`
        <div id="c_${s.id}" style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:16px;padding:12px;margin:10px 0;">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
            <div style="display:flex;gap:10px;align-items:center;min-width:0">
              ${avatarHTML(photo)}
              <div style="min-width:0">
                <div style="font-weight:950;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:52vw">
                  ${isA ? "🛡️ " : ""}${name}
                </div>
              </div>
            </div>
            <div style="opacity:.85">${rating}</div>
          </div>

          <div style="opacity:.92;margin-top:8px;line-height:1.6">${text}</div>

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
          ` : ``}

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

    // Toggle reply box
    mount.querySelectorAll("[data-reply]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!mustSignIn("reply")) return;
        const id = btn.getAttribute("data-reply");
        const box = mount.querySelector(`[data-replybox="${id}"]`);
        if (box) box.style.display = (box.style.display === "none" ? "block" : "none");
      });
    });

    mount.querySelectorAll("[data-replycancel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-replycancel");
        const box = mount.querySelector(`[data-replybox="${id}"]`);
        if (box) box.style.display = "none";
      });
    });

    // Reply send
    mount.querySelectorAll("[data-replysend]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!mustSignIn("reply")) return;

        const id = btn.getAttribute("data-replysend");
        const txt = mount.querySelector(`[data-replytext="${id}"]`);
        const msg = mount.querySelector(`[data-replymsg="${id}"]`);
        if (msg) msg.textContent = "";

        const text = (txt?.value || "").trim();
        if (!text) {
          if (msg) msg.textContent = "Write a reply first.";
          return;
        }

        let photoURL = null;
        let displayName = null;
        if (UID) {
          const p = await getProfile(UID);
          photoURL = p.photoURL || null;
          displayName = p.displayName || null;
        }

        try {
          const editableUntil = Timestamp.fromMillis(Date.now() + 60 * 60 * 1000);
          await addDoc(repliesCol(bookId, id), {
            uid: UID,
            isAdmin: isAdmin(),
            name: isAdmin() ? "Admin" : (displayName || "Reader"),
            text,
            photoURL: photoURL || null,
            createdAt: serverTimestamp(),
            editableUntil
          });

          if (txt) txt.value = "";
          if (msg) msg.textContent = "Sent ✅";

          await renderComments({ bookId, mountId, max });
          trackEngagement({ bookId, event: "reply" }).catch(() => {});
        } catch (e) {
          if (msg) msg.textContent = "Denied: " + (e?.message || String(e));
        }
      });
    });

    // Comment edit
    mount.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-edit");
        const snap = await getDoc(commentDoc(bookId, id));
        if (!snap.exists()) return;
        const d = snap.data() || {};
        if (!canEdit(d)) {
          alert("Edit window ended (1 hour).");
          return;
        }

        const next = prompt("Edit your comment:", d.text || "");
        if (next == null) return;

        const val = next.trim();
        if (!val) {
          alert("Cannot set empty.");
          return;
        }

        try {
          await updateDoc(commentDoc(bookId, id), { text: val, editedAt: serverTimestamp() });
          await renderComments({ bookId, mountId, max });
        } catch (e) {
          alert("Denied: " + (e?.message || String(e)));
        }
      });
    });

    // Comment delete
    mount.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-del");
        const snap = await getDoc(commentDoc(bookId, id));
        if (!snap.exists()) return;
        const d = snap.data() || {};
        if (!canEdit(d) && !isAdmin()) {
          alert("You can’t delete this anymore.");
          return;
        }
        if (!confirm("Delete this comment?")) return;

        try {
          await deleteDoc(commentDoc(bookId, id));
          await renderComments({ bookId, mountId, max });
        } catch (e) {
          alert("Denied: " + (e?.message || String(e)));
        }
      });
    });

    // Reply edit
    mount.querySelectorAll("[data-edit-reply]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const commentId = btn.getAttribute("data-comment");
        const replyId = btn.getAttribute("data-reply");
        if (!commentId || !replyId) return;

        const snap = await getDoc(replyDoc(bookId, commentId, replyId));
        if (!snap.exists()) return;
        const d = snap.data() || {};
        if (!canEdit(d)) {
          alert("Edit window ended (1 hour).");
          return;
        }

        const next = prompt("Edit your reply:", d.text || "");
        if (next == null) return;

        const val = next.trim();
        if (!val) {
          alert("Cannot set empty.");
          return;
        }

        try {
          await updateDoc(replyDoc(bookId, commentId, replyId), { text: val, editedAt: serverTimestamp() });
          await renderComments({ bookId, mountId, max });
        } catch (e) {
          alert("Denied: " + (e?.message || String(e)));
        }
      });
    });

    // Reply delete
    mount.querySelectorAll("[data-del-reply]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const commentId = btn.getAttribute("data-comment");
        const replyId = btn.getAttribute("data-reply");
        if (!commentId || !replyId) return;

        const snap = await getDoc(replyDoc(bookId, commentId, replyId));
        if (!snap.exists()) return;
        const d = snap.data() || {};
        if (!canEdit(d) && !isAdmin()) {
          alert("You can’t delete this anymore.");
          return;
        }
        if (!confirm("Delete this reply?")) return;

        try {
          await deleteDoc(replyDoc(bookId, commentId, replyId));
          await renderComments({ bookId, mountId, max });
        } catch (e) {
          alert("Denied: " + (e?.message || String(e)));
        }
      });
    });

    // Reactions toggle
    mount.querySelectorAll("[data-react]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!mustSignIn("react")) return;
        const kind = btn.getAttribute("data-react");
        const commentId = btn.getAttribute("data-comment");
        if (!commentId) return;

        await toggleReaction({ bookId, commentId, kind });
        await renderComments({ bookId, mountId, max });
      });
    });
  } catch (e) {
    mount.innerHTML = `<div style="color:#ff9b9b">Could not load comments: ${escapeHtml(e?.message || String(e))}</div>`;
  }
}

// ---------- COMMENT FORM ----------
export function setupCommentForm({
  bookId = "book1",
  formId = "commentForm",
  nameId = "cName",
  textId = "cText",
  ratingId = "cRating",
  msgId = "cMsg",
  afterPostReload = true,
  mountId = "commentsList",
  max = 60
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

    if (!mustSignIn("comment")) {
      if (msgEl) msgEl.textContent = "Please sign in to comment.";
      return;
    }

    const text = (textEl?.value || "").trim();
    const rating = Number(ratingEl?.value || 0);

    if (!text) {
      if (msgEl) msgEl.textContent = "Write a comment first.";
      return;
    }

    const p = await getProfile(UID);
    const displayNameFromProfile = p.displayName || null;
    const photoURLFromProfile = p.photoURL || null;

    const typedName = (nameEl?.value || "").trim();
    const finalName = isAdmin()
      ? "Admin"
      : (typedName || displayNameFromProfile || "Reader");

    try {
      const editableUntil = Timestamp.fromMillis(Date.now() + 60 * 60 * 1000);

      await addDoc(commentsCol(bookId), {
        uid: UID,
        isAdmin: isAdmin(),
        name: finalName,
        text,
        photoURL: photoURLFromProfile || null,
        rating: (rating >= 1 && rating <= 5) ? rating : null,
        createdAt: serverTimestamp(),
        editableUntil,
        reactLikeCount: 0,
        reactLoveCount: 0
      });

      if (msgEl) msgEl.textContent = "Posted ✅";
      if (textEl) textEl.value = "";
      if (ratingEl) ratingEl.value = "0";

      if (afterPostReload) await renderComments({ bookId, mountId, max });
      await trackEngagement({ bookId, event: "comment" });
    } catch (e2) {
      if (msgEl) msgEl.textContent = "Could not post: " + (e2?.message || String(e2));
    }
  });
}

// ---------- RATINGS ----------
export async function submitRating({ bookId = "book1", rating = 0 } = {}) {
  if (!mustSignIn("rate")) throw new Error("Please sign in to rate.");

  const r = Number(rating || 0);
  if (!(r >= 1 && r <= 5)) throw new Error("Rating must be 1–5.");

  await setDoc(
    ratingsDoc(bookId, UID),
    { uid: UID, rating: r, updatedAt: serverTimestamp() },
    { merge: true }
  );

  await trackEngagement({ bookId, event: "rate" });
  return true;
}

export async function loadMyRating({ bookId = "book1" } = {}) {
  if (!UID) return 0;
  try {
    const snap = await getDoc(ratingsDoc(bookId, UID));
    const d = snap.exists() ? snap.data() : {};
    return Number(d.rating || 0);
  } catch {
    return 0;
  }
}

export async function renderRatingSummary({ bookId = "book1", mountId = "ratingSummary" } = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  mount.innerHTML = `<div style="opacity:.75">Loading rating…</div>`;

  try {
    const qy = query(collection(db, "books", bookId, "ratings"), limit(800));
    const snap = await getDocs(qy);
    if (snap.empty) {
      mount.innerHTML = `<div style="opacity:.75">No ratings yet.</div>`;
      return;
    }

    let total = 0;
    let count = 0;
    snap.forEach((s) => {
      const d = s.data() || {};
      const r = Number(d.rating || 0);
      if (r >= 1 && r <= 5) {
        total += r;
        count += 1;
      }
    });

    const avg = count ? total / count : 0;

    mount.innerHTML = `
      <div style="font-weight:950">${avg.toFixed(1)} / 5</div>
      <div style="opacity:.75;font-size:12px;margin-top:4px">${count} rating(s)</div>
    `;
  } catch {
    mount.innerHTML = `<div style="color:#ff9b9b">Could not load rating.</div>`;
  }
}

// ---------- COMMENT PREVIEW CAROUSEL (FIXED to match index.css .previewSlide.show) ----------
export async function renderCommentPreviewCarousel({
  bookId = "book1",
  mountId = "commentPreview",
  max = 8,
  intervalMs = 4200
} = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  mount.innerHTML = `<div style="opacity:.75">Loading…</div>`;

  try {
    const qy = query(commentsCol(bookId), orderBy("createdAt", "desc"), limit(max));
    const snap = await getDocs(qy);

    if (snap.empty) {
      mount.innerHTML = `<div style="opacity:.75">No comments yet.</div>`;
      return;
    }

    const uids = new Set();
    snap.forEach((s) => {
      const d = s.data() || {};
      if (d.uid) uids.add(d.uid);
    });
    await Promise.all([...uids].map((uid) => getProfile(uid)));

    const slides = [];
    snap.forEach((s) => {
      const d = s.data() || {};
      const isA = !!d.isAdmin;

      const cached = d.uid ? (profileCache.get(d.uid) || {}) : {};
      const photo = d.photoURL || cached.photoURL || null;

      const who = escapeHtml(d.name || (isA ? "Admin" : "Reader"));
      const raw = String(d.text || "");
      const short = raw.slice(0, 180);
      const txt = escapeHtml(short) + (raw.length > 180 ? "…" : "");
      const like = Number(d.reactLikeCount || 0);
      const love = Number(d.reactLoveCount || 0);

      slides.push(`
        <div class="previewSlide" data-jump="${s.id}">
          <div class="pTop">
            <span class="pPill">Community</span>
            <span>👍 ${like} · ❤️ ${love}</span>
          </div>

          <div class="pName">
            ${avatarHTML(photo)}
            <div class="pWho">${isA ? "🛡️ " : ""}${who}</div>
          </div>

          <div class="pText">${txt}</div>

          <div class="pMeta">
            <span>Tap to open</span>
            <span>Book: ${escapeHtml(bookId)}</span>
          </div>
        </div>
      `);
    });

    mount.innerHTML = slides.join("");

    const list = Array.from(mount.querySelectorAll(".previewSlide"));
    if (!list.length) return;

    let idx = 0;

    function show(n) {
      list.forEach((el, i) => el.classList.toggle("show", i === n));
    }

    show(0);

    mount.querySelectorAll("[data-jump]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-jump");
        location.href = `read.html?book=${encodeURIComponent(bookId)}&open=community&comment=${encodeURIComponent(id)}`;
      });
    });

    if (list.length > 1) {
      setInterval(() => {
        idx = (idx + 1) % list.length;
        show(idx);
      }, Math.max(1800, Number(intervalMs || 4200)));
    }
  } catch {
    mount.innerHTML = `<div style="color:#ff9b9b">Could not load preview.</div>`;
  }
}

// ---------- ACHIEVEMENTS ----------
const ACH = [
  ["first_page", "First Step"],
  ["page_5", "Five Pages Deep"],
  ["page_10", "Ten-Page Lock-in"],
  ["page_25", "Quarter Stack"],
  ["page_50", "Fifty-Page Fighter"],
  ["page_75", "Seventy-Five Strong"],
  ["page_100", "Centurion Reader"],
  ["pct_10", "10% In"],
  ["pct_20", "20% In"],
  ["pct_33", "One-Third Done"],
  ["pct_50", "Halfway Hero"],
  ["pct_66", "Two-Thirds Through"],
  ["pct_75", "75% Done"],
  ["pct_90", "90% Pressure"],
  ["finished", "Book Finished"],
  ["night_owl", "Night Owl Reader"],
  ["early_bird", "Early Bird Reader"],
  ["lunch_break", "Lunch Break Chapter"],
  ["weekend_reader", "Weekend Reader"],
  ["first_comment", "First Comment"],
  ["comment_3", "Comment Trio"],
  ["comment_5", "Chatty (5)"],
  ["comment_10", "Community Voice (10)"],
  ["first_reply", "First Reply"],
  ["reply_3", "Thread Starter (3)"],
  ["reply_5", "Thread Builder (5)"],
  ["first_react", "First Reaction"],
  ["react_5", "Reaction Runner (5)"],
  ["react_10", "Reaction Machine (10)"],
  ["first_rating", "First Rating"]
];

const ACH_MAP = Object.fromEntries(ACH);

export async function trackAchievements({ bookId = "book1", pageIndex = 0, totalPages = 1 } = {}) {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();

  const isNight = hour >= 0 && hour <= 4;
  const isEarly = hour >= 5 && hour <= 8;
  const isLunch = hour >= 11 && hour <= 13;
  const isWeekend = day === 0 || day === 6;

  const pct = totalPages > 0 ? Math.floor(((pageIndex + 1) / totalPages) * 100) : 0;

  const eng = JSON.parse(localStorage.getItem(`eng:${bookId}`) || "{}");
  const commentsMade = Number(eng.comment || 0);
  const repliesMade = Number(eng.reply || 0);
  const reactsMade = Number(eng.react || 0);
  const rated = Number(eng.rate || 0);

  const rules = [
    ["first_page", () => pageIndex >= 0],
    ["page_5", () => pageIndex >= 4],
    ["page_10", () => pageIndex >= 9],
    ["page_25", () => pageIndex >= 24],
    ["page_50", () => pageIndex >= 49],
    ["page_75", () => pageIndex >= 74],
    ["page_100", () => pageIndex >= 99],
    ["pct_10", () => pct >= 10],
    ["pct_20", () => pct >= 20],
    ["pct_33", () => pct >= 33],
    ["pct_50", () => pct >= 50],
    ["pct_66", () => pct >= 66],
    ["pct_75", () => pct >= 75],
    ["pct_90", () => pct >= 90],
    ["finished", () => totalPages > 0 && pageIndex >= totalPages - 1],
    ["night_owl", () => isNight && pageIndex >= 2],
    ["early_bird", () => isEarly && pageIndex >= 2],
    ["lunch_break", () => isLunch && pageIndex >= 2],
    ["weekend_reader", () => isWeekend && pageIndex >= 2],
    ["first_comment", () => commentsMade >= 1],
    ["comment_3", () => commentsMade >= 3],
    ["comment_5", () => commentsMade >= 5],
    ["comment_10", () => commentsMade >= 10],
    ["first_reply", () => repliesMade >= 1],
    ["reply_3", () => repliesMade >= 3],
    ["reply_5", () => repliesMade >= 5],
    ["first_react", () => reactsMade >= 1],
    ["react_5", () => reactsMade >= 5],
    ["react_10", () => reactsMade >= 10],
    ["first_rating", () => rated >= 1]
  ];

  const unlocked = rules.filter(([_, fn]) => { try { return !!fn(); } catch { return false; } }).map(([id]) => id);
  if (!unlocked.length) return;

  if (!UID) {
    unlocked.forEach((id) => toast(`Achievement: ${ACH_MAP[id] || id}`));
    return;
  }

  try {
    const ref = achDoc(bookId, UID);
    const snap = await getDoc(ref);
    const data = snap.exists() ? (snap.data() || {}) : {};
    const had = new Set(Array.isArray(data.unlocked) ? data.unlocked : []);

    let changed = false;
    for (const id of unlocked) {
      if (!had.has(id)) {
        had.add(id);
        changed = true;
        toast(`Achievement unlocked: ${ACH_MAP[id] || id}`);
      }
    }

    if (changed) {
      await setDoc(ref, { unlocked: [...had], updatedAt: serverTimestamp() }, { merge: true });
    }
  } catch {}
}

export async function renderMyAchievements({ bookId = "book1", mountId = "achList" } = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  if (!UID) {
    mount.innerHTML = `<div style="opacity:.75">Sign in to save and view achievements.</div>`;
    return;
  }

  mount.innerHTML = `<div style="opacity:.75">Loading…</div>`;

  try {
    const snap = await getDoc(achDoc(bookId, UID));
    const d = snap.exists() ? snap.data() : {};
    const arr = Array.isArray(d.unlocked) ? d.unlocked : [];

    if (!arr.length) {
      mount.innerHTML = `<div style="opacity:.75">No achievements yet. Keep reading.</div>`;
      return;
    }

    const list = [...arr].slice().reverse();

    mount.innerHTML = list.map((id) => `
      <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:14px;padding:10px;margin:8px 0;">
        <div style="font-weight:950">${escapeHtml(ACH_MAP[id] || id)}</div>
        <div style="opacity:.75;font-size:12px;margin-top:4px">${escapeHtml(id)}</div>
      </div>
    `).join("");
  } catch {
    mount.innerHTML = `<div style="color:#ff9b9b">Could not load achievements.</div>`;
  }
}

export function guidelinesHTML() {
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
