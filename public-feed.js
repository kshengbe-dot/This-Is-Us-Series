// public-feed.js (Library page: announcements + subscribe)
// Safe init: reuses existing Firebase app if already initialized.

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, serverTimestamp,
  getDocs, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);

// ---------- Announcements ----------
export async function renderAnnouncements({ mountId = "announcementsMount", max = 3 } = {}) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  mount.innerHTML = `<div style="opacity:.75">Loading announcements…</div>`;

  try {
    const q = query(collection(db, "announcements"), orderBy("createdAt", "desc"), limit(max));
    const snap = await getDocs(q);

    if (snap.empty) {
      mount.innerHTML = `<div style="opacity:.75">No announcements yet.</div>`;
      return;
    }

    const cards = [];
    snap.forEach(docu => {
      const d = docu.data() || {};
      const title = (d.title || "Announcement").toString();
      const body = (d.body || "").toString();
      cards.push(`
        <div style="border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:16px;padding:12px;margin:10px 0;">
          <div style="font-weight:950">${escapeHtml(title)}</div>
          <div style="opacity:.85;margin-top:6px;line-height:1.5">${escapeHtml(body)}</div>
        </div>
      `);
    });

    mount.innerHTML = cards.join("");
  } catch (e) {
    mount.innerHTML = `<div style="color:#ff9b9b">Could not load announcements: ${escapeHtml(e?.message || String(e))}</div>`;
  }
}

// ---------- Subscribe (default setup: STORE subscribers) ----------
export async function setupSubscribeForm({
  formId = "subscribeForm",
  emailId = "subEmail",
  phoneId = "subPhone",
  msgId = "subMsg",
  bookId = "book1"
} = {}) {
  const form = document.getElementById(formId);
  if (!form) return;

  const emailEl = document.getElementById(emailId);
  const phoneEl = document.getElementById(phoneId);
  const msgEl = document.getElementById(msgId);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (msgEl) msgEl.textContent = "";

    const email = (emailEl?.value || "").trim();
    const phone = (phoneEl?.value || "").trim();

    // Require at least one
    if (!email && !phone) {
      if (msgEl) msgEl.textContent = "Add an email or phone number.";
      return;
    }

    // Basic email/phone sanity (not strict)
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (msgEl) msgEl.textContent = "That email doesn’t look right.";
      return;
    }

    try {
      await addDoc(collection(db, "subscribers"), {
        email: email || null,
        phone: phone || null,
        bookId,
        createdAt: serverTimestamp(),
        source: location.pathname
      });

      if (msgEl) msgEl.textContent = "Subscribed! (We’ll notify you on updates.)";
      if (emailEl) emailEl.value = "";
      if (phoneEl) phoneEl.value = "";
    } catch (e2) {
      if (msgEl) msgEl.textContent = "Could not subscribe: " + (e2?.message || String(e2));
    }
  });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
