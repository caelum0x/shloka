(() => {
  "use strict";

  const ICONS = {
    heart: `<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-10-9.3C.5 8.2 2.3 5 5.6 5 7.9 5 9.6 6.3 12 9c2.4-2.7 4.1-4 6.4-4 3.3 0 5.1 3.2 3.6 6.7C19.5 16.4 12 21 12 21z"/></svg>`,
    note: `<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    share: `<svg viewBox="0 0 24 24"><path d="M12 3v12M12 3l4 4M12 3 8 7M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>`,
  };

  const LS_LIKES = "shloka:likes";
  const LS_NOTES = "shloka:notes";
  const LS_LAST = "shloka:lastIndex";

  const onboarding = document.getElementById("onboarding");
  const startBtn = document.getElementById("startBtn");
  const feedEl = document.getElementById("feed");
  const sheet = document.getElementById("sheet");
  const sheetBackdrop = document.getElementById("sheetBackdrop");
  const sheetClose = document.getElementById("sheetClose");
  const browseBtn = document.getElementById("browseBtn");
  const browse = document.getElementById("browse");
  const browseClose = document.getElementById("browseClose");
  const browseSearch = document.getElementById("browseSearch");
  const browseResults = document.getElementById("browseResults");
  const browseChapters = document.getElementById("browseChapters");
  const browseMoreTexts = document.getElementById("browseMoreTexts");

  let verses = [];
  let chapters = [];
  let renderedCount = 0;
  const BATCH = 16;
  let sentinel = null;
  let io = null;
  let progressBar = null;
  let savePositionTimer = null;

  function loadSet(key) {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
    } catch (e) {
      return new Set();
    }
  }
  function saveSet(key, set) {
    localStorage.setItem(key, JSON.stringify([...set]));
  }
  function loadNotes() {
    try {
      return JSON.parse(localStorage.getItem(LS_NOTES) || "{}");
    } catch (e) {
      return {};
    }
  }
  function saveNotes(notes) {
    localStorage.setItem(LS_NOTES, JSON.stringify(notes));
  }

  const likes = loadSet(LS_LIKES);
  const notes = loadNotes();

  const lastIndexRaw = localStorage.getItem(LS_LAST);
  if (lastIndexRaw !== null && parseInt(lastIndexRaw, 10) > 0) {
    startBtn.textContent = "Continue reading";
  }

  async function fetchData() {
    const res = await fetch("/data/gita.json");
    if (!res.ok) throw new Error("failed to load verses");
    return res.json();
  }

  async function fetchChapters() {
    try {
      const res = await fetch("/data/chapters.json");
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      return [];
    }
  }

  function cardHtml(v, idx) {
    const liked = likes.has(v.id);
    return `
      <section class="verse-card" data-id="${v.id}" data-idx="${idx}">
        <div class="verse-inner" data-open="${v.id}">
          <div class="verse-chapter-tag">Chapter ${v.chapter} &middot; ${escapeHtml(v.chapterTitle)}</div>
          <p class="verse-text">${escapeHtml(v.translation)}</p>
          <p class="verse-sanskrit-preview">${escapeHtml(truncate(v.sanskrit, 70))}</p>
        </div>
        <div class="verse-tap-hint">Tap to read Sanskrit &amp; context</div>
        <div class="verse-actions">
          <button class="action-btn like-btn ${liked ? "liked" : ""}" data-id="${v.id}" aria-label="Like">
            ${ICONS.heart}
            <span class="action-count">${liked ? "Saved" : "Like"}</span>
          </button>
          <button class="action-btn note-btn" data-id="${v.id}" aria-label="Note">
            ${ICONS.note}
            <span class="action-count">${notes[v.id] ? "Noted" : "Note"}</span>
          </button>
          <button class="action-btn share-btn" data-id="${v.id}" aria-label="Share">
            ${ICONS.share}
            <span class="action-count">Share</span>
          </button>
        </div>
      </section>
    `;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function truncate(s, n) {
    return s.length > n ? s.slice(0, n).trim() + "…" : s;
  }

  function renderNextBatch() {
    if (renderedCount >= verses.length) return;
    const end = Math.min(renderedCount + BATCH, verses.length);
    let html = "";
    for (let i = renderedCount; i < end; i++) {
      html += cardHtml(verses[i], i);
    }
    if (sentinel) sentinel.remove();
    feedEl.insertAdjacentHTML("beforeend", html);
    renderedCount = end;
    attachSentinel();
    observeCards();
  }

  function attachSentinel() {
    sentinel = document.createElement("div");
    sentinel.style.height = "1px";
    sentinel.id = "sentinel";
    feedEl.appendChild(sentinel);
    if (io) io.observe(sentinel);
  }

  let cardObserver = null;
  function observeCards() {
    const cards = feedEl.querySelectorAll(".verse-card:not([data-observed])");
    cards.forEach((c) => {
      c.setAttribute("data-observed", "1");
      if (cardObserver) cardObserver.observe(c);
    });
  }

  function setupObservers() {
    io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) renderNextBatch();
      });
    }, { root: feedEl, threshold: 0 });

    cardObserver = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting && e.intersectionRatio > 0.6) {
          const idx = parseInt(e.target.getAttribute("data-idx"), 10);
          updateProgress(idx);
          saveLastPosition(idx);
        }
      });
    }, { root: feedEl, threshold: [0.6] });
  }

  function updateProgress(idx) {
    if (!progressBar) return;
    const pct = ((idx + 1) / verses.length) * 100;
    progressBar.style.width = pct.toFixed(2) + "%";
  }

  function saveLastPosition(idx) {
    clearTimeout(savePositionTimer);
    savePositionTimer = setTimeout(() => {
      localStorage.setItem(LS_LAST, String(idx));
    }, 400);
  }

  function jumpToIndex(idx) {
    if (idx == null || idx < 0 || idx >= verses.length) return;
    while (renderedCount <= idx && renderedCount < verses.length) {
      renderNextBatch();
    }
    requestAnimationFrame(() => {
      const el = feedEl.querySelector(`.verse-card[data-idx="${idx}"]`);
      if (el) el.scrollIntoView({ block: "start" });
    });
  }

  function openSheet(id) {
    const v = verses.find((x) => x.id === id);
    if (!v) return;
    sheet.querySelector(".sheet-kicker").textContent =
      `Chapter ${v.chapter} · Verse ${v.verse} · ${v.chapterSanskritName}`;
    sheet.querySelector(".sheet-chapter-title").textContent = v.chapterTitle;
    sheet.querySelector(".sheet-chapter-summary").textContent = v.chapterSummary;
    sheet.querySelector(".sheet-sanskrit").textContent = v.sanskrit;
    sheet.querySelector(".sheet-translation").textContent = v.translation;

    let noteWrap = sheet.querySelector(".sheet-note-wrap");
    if (!noteWrap) {
      noteWrap = document.createElement("div");
      noteWrap.className = "sheet-note-wrap";
      noteWrap.innerHTML = `
        <div class="sheet-divider"></div>
        <div class="sheet-label">Your note (private, saved on this device)</div>
        <textarea class="sheet-note" rows="3" placeholder="Write a private reflection on this verse..."></textarea>
      `;
      sheet.querySelector(".sheet-scroll").appendChild(noteWrap);
    }
    const textarea = noteWrap.querySelector(".sheet-note");
    textarea.value = notes[id] || "";
    textarea.oninput = () => {
      const val = textarea.value;
      if (val.trim()) notes[id] = val; else delete notes[id];
      saveNotes(notes);
      const btn = feedEl.querySelector(`.note-btn[data-id="${id}"] .action-count`);
      if (btn) btn.textContent = notes[id] ? "Noted" : "Note";
    };

    sheet.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeSheet() {
    sheet.hidden = true;
    document.body.style.overflow = "";
  }

  function toggleLike(id) {
    if (likes.has(id)) likes.delete(id); else likes.add(id);
    saveSet(LS_LIKES, likes);
    const btn = feedEl.querySelector(`.like-btn[data-id="${id}"]`);
    if (btn) {
      btn.classList.toggle("liked", likes.has(id));
      btn.querySelector(".action-count").textContent = likes.has(id) ? "Saved" : "Like";
    }
  }

  async function shareVerse(id) {
    const v = verses.find((x) => x.id === id);
    if (!v) return;
    const text = `"${v.translation}"\n— Bhagavad Gita ${v.chapter}.${v.verse}, ${v.chapterTitle}`;
    const url = `${location.origin}/#${id}`;
    if (navigator.share) {
      try {
        await navigator.share({ text, url, title: "Shloka" });
        return;
      } catch (e) { /* user cancelled */ return; }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast("Copied to clipboard");
    } catch (e) {
      toast("Could not copy");
    }
  }

  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.style.position = "fixed";
      el.style.bottom = "calc(32px + env(safe-area-inset-bottom, 0px))";
      el.style.left = "50%";
      el.style.transform = "translateX(-50%)";
      el.style.background = "rgba(20,20,20,0.95)";
      el.style.color = "#f4f1ea";
      el.style.padding = "10px 18px";
      el.style.borderRadius = "999px";
      el.style.fontSize = "13px";
      el.style.zIndex = "50";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = "0"; }, 1800);
  }

  function renderChapterList() {
    if (!chapters.length) {
      browseChapters.innerHTML = `<p class="browse-empty">Chapter list unavailable.</p>`;
      return;
    }
    browseChapters.innerHTML = chapters.map((c) => `
      <div class="browse-chapter-item" data-chapter="${c.chapter}">
        <div class="browse-chapter-num">Chapter ${c.chapter} &middot; ${escapeHtml(c.sanskrit_name)}</div>
        <div class="browse-chapter-title-row">${escapeHtml(c.title)}</div>
        <p class="browse-chapter-sum">${escapeHtml(truncate(c.summary, 150))}</p>
      </div>
    `).join("");
  }

  function renderSearchResults(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      browseResults.hidden = true;
      browseChapters.hidden = false;
      if (browseMoreTexts) browseMoreTexts.hidden = false;
      return;
    }
    browseChapters.hidden = true;
    browseResults.hidden = false;
    if (browseMoreTexts) browseMoreTexts.hidden = true;
    const matches = verses.filter((v) =>
      v.translation.toLowerCase().includes(q) ||
      v.sanskrit.toLowerCase().includes(q) ||
      v.chapterTitle.toLowerCase().includes(q) ||
      v.chapterSanskritName.toLowerCase().includes(q)
    ).slice(0, 40);
    if (!matches.length) {
      browseResults.innerHTML = `<p class="browse-empty">No verses match "${escapeHtml(query)}".</p>`;
      return;
    }
    browseResults.innerHTML = matches.map((v) => `
      <div class="browse-result-item" data-id="${v.id}">
        <div class="browse-result-tag">Chapter ${v.chapter}.${v.verse} &middot; ${escapeHtml(v.chapterTitle)}</div>
        <p class="browse-result-text">${escapeHtml(truncate(v.translation, 150))}</p>
      </div>
    `).join("");
  }

  function openBrowse() {
    if (!browseChapters.childElementCount) renderChapterList();
    browseSearch.value = "";
    renderSearchResults("");
    browse.hidden = false;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => browseSearch.focus());
  }

  function closeBrowse() {
    browse.hidden = true;
    document.body.style.overflow = "";
  }

  function wireBrowseEvents() {
    browseBtn.addEventListener("click", openBrowse);
    browseClose.addEventListener("click", closeBrowse);
    browseSearch.addEventListener("input", () => renderSearchResults(browseSearch.value));
    browseChapters.addEventListener("click", (e) => {
      const item = e.target.closest(".browse-chapter-item");
      if (!item) return;
      const chapterNum = parseInt(item.dataset.chapter, 10);
      let idx = verses.findIndex((v) => v.chapter === chapterNum && v.verse === 1);
      if (idx < 0) idx = verses.findIndex((v) => v.chapter === chapterNum);
      closeBrowse();
      jumpToIndex(idx);
    });
    browseResults.addEventListener("click", (e) => {
      const item = e.target.closest(".browse-result-item");
      if (!item) return;
      const idx = verses.findIndex((v) => v.id === item.dataset.id);
      closeBrowse();
      jumpToIndex(idx);
    });
  }

  function wireFeedEvents() {
    feedEl.addEventListener("click", (e) => {
      const likeBtn = e.target.closest(".like-btn");
      if (likeBtn) { toggleLike(likeBtn.dataset.id); return; }
      const noteBtn = e.target.closest(".note-btn");
      if (noteBtn) { openSheet(noteBtn.dataset.id); return; }
      const shareBtn = e.target.closest(".share-btn");
      if (shareBtn) { shareVerse(shareBtn.dataset.id); return; }
      const openTarget = e.target.closest("[data-open]");
      if (openTarget) { openSheet(openTarget.getAttribute("data-open")); return; }
    });
  }

  function createProgressBar() {
    const wrap = document.createElement("div");
    wrap.className = "feed-progress";
    wrap.innerHTML = `<div class="feed-progress-bar"></div>`;
    document.body.appendChild(wrap);
    progressBar = wrap.querySelector(".feed-progress-bar");
  }

  async function start() {
    startBtn.disabled = true;
    startBtn.textContent = "Loading...";
    try {
      verses = await fetchData();
    } catch (e) {
      startBtn.textContent = "Could not load — tap to retry";
      startBtn.disabled = false;
      return;
    }
    chapters = await fetchChapters();

    onboarding.hidden = true;
    feedEl.hidden = false;
    browseBtn.hidden = false;
    createProgressBar();
    setupObservers();
    wireFeedEvents();
    wireBrowseEvents();
    renderNextBatch();

    const hashId = location.hash.replace("#", "");
    if (hashId) {
      const idx = verses.findIndex((v) => v.id === hashId);
      if (idx >= 0) jumpToIndex(idx);
    } else {
      const lastIdx = parseInt(localStorage.getItem(LS_LAST), 10);
      if (!Number.isNaN(lastIdx) && lastIdx > 0) jumpToIndex(lastIdx);
    }
  }

  startBtn.addEventListener("click", start);
  sheetClose.addEventListener("click", closeSheet);
  sheetBackdrop.addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!sheet.hidden) closeSheet();
    if (!browse.hidden) closeBrowse();
  });
})();
