/* YouTube Playlist Toolkit – content script. Runs on youtube.com, active only on /playlist?list=... */
(() => {
  'use strict';
  const P = self.YPTParse;
  if (!P || window.__yptLoaded) return;
  window.__yptLoaded = true;

  // ---- Selectors (YouTube changes its DOM; keep them in one place) ----------------------
  // Two layouts are supported: the current one (yt-lockup-view-model rows) and the legacy
  // one (ytd-playlist-video-renderer rows).
  const SEL = {
    // Scoped to the visible playlist page: YouTube keeps previously visited pages (e.g. Home) hidden in the DOM.
    row: 'ytd-browse[page-subtype="playlist"]:not([hidden]) #primary yt-lockup-view-model, ytd-browse[page-subtype="playlist"]:not([hidden]) ytd-playlist-video-renderer',
    title: 'a[class*="ytLockupMetadataViewModelTitle"], #video-title',
    duration: '.ytBadgeShapeText, ytd-thumbnail-overlay-time-status-renderer',
    metaSpans: 'span.ytAttributedStringHost, #video-info span',
    legacyMeta: '#video-info',
    legacyChannel: 'ytd-channel-name',
    progress: '[class*="ProgressBar"] [style*="width"], ytd-thumbnail-overlay-resume-playback-renderer #progress',
    continuation: 'ytd-continuation-item-renderer',
    // Left-column header. YouTube uses different headers per playlist type (regular vs. "Course"/immersive).
    headerContent: 'yt-page-header-renderer .ytPageHeaderViewModelContent, ytd-playlist-header-renderer .metadata-wrapper',
  };

  const SORT_DEFAULT_DIR = { title: 'asc', channel: 'asc' };

  const SORTS = {
    views: { label: 'Views', get: (v) => v.views, num: true },
    likes: { label: 'Likes', get: (v) => v.likes, num: true, needsApi: true },
    duration: { label: 'Duration', get: (v) => v.duration, num: true },
    date: { label: 'Upload date', get: (v) => v.date, num: true },
    title: { label: 'Title', get: (v) => v.title, num: false },
    channel: { label: 'Channel', get: (v) => v.channel, num: false },
  };

  // ---- State ----------------------------------------------------------------------------
  const state = {
    listId: null,
    apiKey: '',
    defaultSort: 'views',
    meta: {}, // videoId -> API data
    sortKey: null, // currently applied sort, or null for original order
    dir: 'desc',
    loading: false,
    note: '',
    noteErr: false,
    panel: null,
  };

  const safe = (fn) => {
    try {
      return fn();
    } catch (_) {
      return undefined;
    }
  };

  // ---- Settings -------------------------------------------------------------------------
  function loadSettings() {
    return safe(() =>
      chrome.storage.sync.get(['apiKey', 'defaultSort']).then((s) => {
        state.apiKey = s.apiKey || '';
        if (s.defaultSort) state.defaultSort = s.defaultSort;
      })
    );
  }
  safe(() =>
    chrome.storage.onChanged.addListener((ch) => {
      if (ch.apiKey) state.apiKey = ch.apiKey.newValue || '';
      if (ch.defaultSort) state.defaultSort = ch.defaultSort.newValue || 'views';
      if (state.panel) render();
    })
  );

  // ---- Page helpers -----------------------------------------------------------------------
  const isPlaylistPage = () =>
    location.pathname === '/playlist' && new URL(location.href).searchParams.has('list');
  const currentListId = () => new URL(location.href).searchParams.get('list');

  // Only real videos: the page also shows "recommended playlist" cards that use the same component.
  // Video cards carry an 11-character video id in their `content-id-…` class; playlist cards carry a longer list id.
  const isVideoRow = (r) => {
    if (r.tagName.toLowerCase() === 'ytd-playlist-video-renderer') return true;
    const host = r.querySelector('[class*="content-id-"]');
    if (host) return /content-id-[\w-]{11}(?:\s|$)/.test(String(host.className));
    return Array.from(r.querySelectorAll('a[href]')).some((a) => /^\/watch\?v=[\w-]{11}(?:&|$)/.test(a.getAttribute('href') || ''));
  };
  const $rows = () => Array.from(document.querySelectorAll(SEL.row)).filter(isVideoRow);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // The element that is a direct child of the list container (what we apply CSS `order` to).
  function wrapperOf(row) {
    let n = row;
    while (n.parentElement && n.parentElement.id !== 'contents') n = n.parentElement;
    return n.parentElement ? n : row;
  }

  function extractRow(row, idx) {
    const a = row.querySelector(SEL.title);
    const href = a && a.getAttribute('href');
    let id = null;
    const cm = row.querySelector('[class*="content-id-"]');
    const cidMatch = cm && String(cm.className).match(/content-id-([\w-]{11})/);
    if (cidMatch) id = cidMatch[1];
    else if (href) {
      const m = href.match(/[?&]v=([\w-]{11})/);
      if (m) id = m[1];
    }
    const durEl = row.querySelector(SEL.duration);
    const durText = durEl ? (durEl.textContent.match(/\d+(?::\d{1,2}){1,2}/) || [])[0] : null;

    // Metadata: channel / views / age appear as separate text spans (new layout) or one line (legacy).
    const spans = Array.from(row.querySelectorAll(SEL.metaSpans))
      .filter((s) => !s.closest(SEL.title))
      .map((s) => s.textContent.trim())
      .filter(Boolean);
    const legacy = row.querySelector(SEL.legacyMeta);
    const metaTexts = spans.length ? spans : legacy ? [legacy.textContent] : [];
    let pageViews = null;
    let pageDate = null;
    for (const t of metaTexts) {
      if (pageDate == null) pageDate = P.parseRelativeDate(t);
      if (pageViews == null) pageViews = P.parseViews(t);
      if (pageDate != null && pageViews != null) break;
    }
    // "3 years ago" must not be read as a view count and vice-versa (parseViews rejects "ago" text).
    const chEl = row.querySelector(SEL.legacyChannel);
    const channel = chEl
      ? chEl.textContent.trim()
      : metaTexts.find((t) => P.parseViews(t) == null && P.parseRelativeDate(t) == null && !/^and \d+ more$/i.test(t)) || '';
    const progEl = row.querySelector(SEL.progress);
    const progress = progEl ? parseFloat(progEl.style.width) || 0 : 0;
    const titleText = a ? (a.getAttribute('title') || a.textContent || '').trim() : '';

    const api = id ? state.meta[id] : null;
    const pageDur = P.parseDuration(durText);

    return {
      el: row,
      wrap: wrapperOf(row),
      idx,
      id,
      title: titleText,
      channel,
      url: id ? `https://www.youtube.com/watch?v=${id}` : '',
      available: !!id && pageDur != null,
      views: api && api.views != null ? api.views : pageViews,
      likes: api ? api.likes : null,
      duration: api && api.duration ? P.parseISODuration(api.duration) : pageDur,
      date: api && api.publishedAt ? Date.parse(api.publishedAt) : pageDate,
      progress,
    };
  }

  const collect = () => $rows().map(extractRow);

  function expectedCount() {
    const hdr = headerContent();
    const txt = hdr ? hdr.textContent : '';
    const m = txt.match(/([\d,]+)\s+videos?/i);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  }

  // ---- Loading all rows (YouTube lazy-loads ~100 at a time) -------------------------------
  // Loaded = we have as many rows as the header promises, or scrolling has already stopped producing new rows
  // (private/deleted videos are counted in the header but never rendered).
  const allLoaded = () => {
    const n = $rows().length;
    const exp = expectedCount();
    return (exp != null && n >= exp) || state.settledCount === n;
  };

  async function loadAll() {
    if (state.loading) return;
    if (allLoaded()) return; // nothing to scroll for: no page jumping, no waiting
    state.loading = true;
    const startY = window.scrollY;
    let last = -1;
    let stable = 0;
    try {
      while (stable < 5 && isPlaylistPage() && !allLoaded()) {
        const n = $rows().length;
        if (n !== last) {
          setNote(`Loading videos… ${n}${expectedCount() ? ' / ' + expectedCount() : ''}`);
          renderStats();
        }
        // Jump straight to the continuation spinner: this is what makes YouTube fetch the next page.
        const cont = document.querySelector(SEL.continuation);
        if (cont) cont.scrollIntoView({ block: 'end' });
        else window.scrollTo(0, document.documentElement.scrollHeight);
        await sleep(350);
        const now = $rows().length;
        stable = now === last ? stable + 1 : 0;
        last = now;
      }
      if (stable >= 5) state.settledCount = $rows().length; // list stopped growing
    } finally {
      window.scrollTo(0, startY);
      state.loading = false;
      setNote('');
      state.statsKey = null;
      renderStats();
    }
  }

  // ---- YouTube Data API (optional) --------------------------------------------------------
  async function enrichFromApi() {
    if (!state.apiKey) return;
    const ids = collect()
      .map((v) => v.id)
      .filter((id) => id && !state.meta[id]);
    if (!ids.length) return;
    setNote('Fetching exact stats from the YouTube API…');
    const res = await safe(() => chrome.runtime.sendMessage({ type: 'ypt:fetchVideos', ids }));
    if (!res) return setNote('Extension was reloaded – refresh this page.', true);
    if (!res.ok) {
      setNote(`API error: ${res.error}. Using page data instead.`, true);
      return;
    }
    Object.assign(state.meta, res.data);
    setNote('');
  }

  // ---- Sorting (visual only: CSS `order`, DOM is never reordered) -------------------------
  // The element whose direct children are the video rows (or their wrappers).
  function listContainer() {
    const first = $rows()[0];
    return first ? wrapperOf(first).parentElement : null;
  }

  function ensureFlex() {
    const c = listContainer();
    if (!c) return null;
    if (!c.classList.contains('ypt-flex')) {
      c.classList.add('ypt-flex');
      c.style.display = 'flex';
      c.style.flexDirection = 'column';
    }
    return c;
  }

  function clearOrder() {
    document.querySelectorAll('.ypt-flex').forEach((c) => {
      Array.from(c.children).forEach((ch) => {
        ch.style.order = '';
        delete ch.dataset.yptVal;
      });
      c.classList.remove('ypt-flex');
      c.style.display = '';
      c.style.flexDirection = '';
    });
  }

  function applySort() {
    if (!state.sortKey) return;
    const c = ensureFlex();
    if (!c) return;
    const def = SORTS[state.sortKey];
    const sign = state.dir === 'asc' ? 1 : -1;
    const items = collect();
    const known = [];
    const unknown = [];
    for (const v of items) {
      const val = def.get(v);
      (val == null || val === '' || !v.available ? unknown : known).push(v);
    }
    known.sort((a, b) => {
      const x = def.get(a);
      const y = def.get(b);
      const cmp = def.num ? x - y : String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true });
      return cmp !== 0 ? sign * cmp : a.idx - b.idx; // stable
    });
    let o = 0;
    known.forEach((v) => {
      v.wrap.style.order = o++;
      v.wrap.dataset.yptVal = def.get(v); // exposed for debugging / tests
    });
    unknown.forEach((v) => {
      v.wrap.style.order = o++;
      delete v.wrap.dataset.yptVal;
    });
    // spinner / non-row children always last
    const wraps = new Set(items.map((v) => v.wrap));
    Array.from(c.children).forEach((ch) => {
      if (!wraps.has(ch)) ch.style.order = 100000;
    });
  }

  async function doSort(key, dir) {
    if (state.loading) return;
    if (SORTS[key].needsApi && !state.apiKey) {
      return setNote('Sorting by likes needs a YouTube API key – open Settings.', true);
    }
    await loadAll();
    await enrichFromApi();
    state.sortKey = key;
    state.dir = dir;
    applySort();
    render();
    // bring the list into view so the user sees the result
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetOrder() {
    state.sortKey = null;
    clearOrder();
    render();
  }

  // ---- Panel UI ---------------------------------------------------------------------------
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'class') n.className = v;
        else if (k === 'onclick') n.addEventListener('click', v);
        else if (k === 'onchange') n.addEventListener('change', v);
        else if (v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
      }
    }
    kids.flat().forEach((k) => k != null && n.append(k.nodeType ? k : document.createTextNode(k)));
    return n;
  }

  function setNote(msg, isErr) {
    state.note = msg || '';
    state.noteErr = !!isErr;
    const n = state.panel && state.panel.querySelector('.ypt-note');
    if (n) {
      n.textContent = state.note;
      n.className = 'ypt-note' + (state.noteErr ? ' ypt-err' : '');
    }
  }

  function buildPanel() {
    const panel = el('div', { id: 'ypt-panel' });
    state.panel = panel;
    render();
    return panel;
  }

  function render() {
    const p = state.panel;
    if (!p) return;
    p.textContent = '';

    const viewsActive = state.sortKey === 'views';
    const arrow = state.dir === 'desc' ? '↓' : '↑';

    const sortSelect = el(
      'select',
      {
        'aria-label': 'More sort options',
        onchange: (e) => {
          const k = e.target.value;
          if (k) doSort(k, k === 'title' || k === 'channel' ? 'asc' : 'desc');
        },
      },
      el('option', { value: '' }, 'More sorts…'),
      Object.entries(SORTS)
        .filter(([k]) => k !== 'views')
        .map(([k, d]) => {
          const label = d.label + (d.needsApi && !state.apiKey ? ' (needs API key)' : '');
          const o = el('option', { value: k, selected: state.sortKey === k }, label);
          return o;
        })
    );
    if (state.sortKey && state.sortKey !== 'views') sortSelect.value = state.sortKey;

    p.append(
      el(
        'div',
        { class: 'ypt-head' },
        el('span', { class: 'ypt-title' }, 'Playlist Toolkit'),
        el(
          'span',
          { class: 'ypt-mode' },
          state.apiKey ? 'API data · ' : 'Page data · ',
          el(
            'a',
            { onclick: openOptions },
            'Settings'
          )
        )
      ),
      el(
        'div',
        { class: 'ypt-row' },
        el(
          'button',
          {
            class: 'ypt-primary' + (viewsActive ? ' ypt-active' : ''),
            id: 'ypt-sort-views',
            disabled: state.loading,
            onclick: () => doSort('views', viewsActive && state.dir === 'desc' ? 'asc' : 'desc'),
          },
          viewsActive ? `Sort by views ${arrow}` : 'Sort by views'
        ),
        sortSelect,
        state.sortKey
          ? el(
              'button',
              {
                id: 'ypt-dir',
                title: 'Toggle ascending / descending',
                onclick: () => doSort(state.sortKey, state.dir === 'desc' ? 'asc' : 'desc'),
              },
              arrow
            )
          : null,
        state.sortKey ? el('button', { id: 'ypt-reset', onclick: resetOrder }, 'Reset order') : null
      ),
      el('div', { class: 'ypt-sep' }),
      el('dl', { class: 'ypt-stats' }),
      el('div', { class: 'ypt-bar' }, el('i')),
      el('div', { class: 'ypt-sep' }),
      el(
        'div',
        { class: 'ypt-row' },
        el('button', { id: 'ypt-load', onclick: async () => { await loadAll(); renderStats(); } }, 'Load all videos'),
        el('button', { id: 'ypt-copy-links', onclick: (e) => copyOut(e.target, 'links') }, 'Copy links'),
        el('button', { id: 'ypt-copy-titles', onclick: (e) => copyOut(e.target, 'titles') }, 'Copy titles'),
        el('button', { id: 'ypt-csv', onclick: downloadCsv }, 'Download CSV')
      ),
      el('div', { class: 'ypt-note' + (state.noteErr ? ' ypt-err' : '') }, state.note)
    );
    renderStats();
  }

  function openOptions() {
    // Content scripts can't call chrome.runtime.openOptionsPage in all cases; ask background.
    safe(() => chrome.runtime.sendMessage({ type: 'ypt:openOptions' }));
  }

  function renderStats() {
    const p = state.panel;
    if (!p) return;
    const dl = p.querySelector('.ypt-stats');
    if (!dl) return;
    const items = collect();
    const avail = items.filter((v) => v.available);
    const total = avail.reduce((s, v) => s + (v.duration || 0), 0);
    const remaining = avail.reduce((s, v) => s + (v.duration || 0) * (1 - Math.min(v.progress, 100) / 100), 0);
    const views = avail.reduce((s, v) => s + (v.views || 0), 0);
    const watched = avail.filter((v) => v.progress >= 90).length;
    const exp = expectedCount();
    const partial = !allLoaded();
    const hidden = exp != null && !partial && items.length < exp ? exp - items.length : 0;

    const rows = [
      ['Videos', `${items.length}${exp != null && exp !== items.length && !hidden ? ' / ' + exp : ''}` + (items.length - avail.length ? ` (${items.length - avail.length} unavailable)` : '') + (hidden ? ` (+${hidden} not shown)` : '')],
      ['Total duration', P.formatLong(total) + (partial ? '+' : '')],
      ['Average length', avail.length ? P.formatDuration(total / avail.length) : '–'],
      ['Total views', P.formatCount(views) + (partial ? '+' : '')],
      ['Watched', `${watched} / ${avail.length}`],
      ['Time left @1x', P.formatLong(remaining)],
      ['Time left @1.25x', P.formatLong(remaining / 1.25)],
      ['Time left @1.5x', P.formatLong(remaining / 1.5)],
      ['Time left @2x', P.formatLong(remaining / 2)],
    ];
    // Only touch the DOM when something changed (avoids flicker and observer feedback loops).
    const key = JSON.stringify(rows);
    if (key !== state.statsKey || !dl.firstChild) {
      state.statsKey = key;
      dl.textContent = '';
      rows.forEach(([k, v]) => dl.append(el('dt', null, k), el('dd', null, v)));
    }
    const bar = p.querySelector('.ypt-bar > i');
    if (bar) bar.style.width = avail.length ? Math.round((watched / avail.length) * 100) + '%' : '0%';
    const load = p.querySelector('#ypt-load');
    if (load) {
      load.disabled = state.loading || !partial;
      load.style.display = partial || state.loading ? '' : 'none';
    }
    const sortBtn = p.querySelector('#ypt-sort-views');
    if (sortBtn) sortBtn.disabled = state.loading;
  }

  // ---- Export -----------------------------------------------------------------------------
  async function copyOut(btn, what) {
    await loadAll();
    const items = collect().filter((v) => v.available);
    const ordered = orderedItems(items);
    const text = ordered.map((v) => (what === 'links' ? v.url : v.title)).join('\n');
    const old = btn.textContent;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = `Copied ${ordered.length}!`;
    } catch (_) {
      btn.textContent = 'Copy failed';
    }
    setTimeout(() => (btn.textContent = old), 1500);
  }

  // Items in the order the user currently sees them.
  function orderedItems(items) {
    if (!state.sortKey) return items.slice().sort((a, b) => a.idx - b.idx);
    const ord = (v) => parseInt(v.wrap.style.order, 10) || 0;
    return items.slice().sort((a, b) => ord(a) - ord(b) || a.idx - b.idx);
  }

  async function downloadCsv() {
    await loadAll();
    await enrichFromApi();
    const items = orderedItems(collect().filter((v) => v.available));
    const head = ['#', 'Title', 'URL', 'Channel', 'Views', 'Likes', 'Duration', 'Duration (s)', 'Uploaded'];
    const lines = [head.join(',')];
    items.forEach((v, i) => {
      lines.push(
        [
          i + 1,
          v.title,
          v.url,
          v.channel,
          v.views,
          v.likes,
          P.formatDuration(v.duration),
          v.duration,
          v.date ? new Date(v.date).toISOString().slice(0, 10) : '',
        ]
          .map(P.csvEscape)
          .join(',')
      );
    });
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `playlist-${currentListId()}.csv` });
    document.body.append(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  // ---- Injection / lifecycle --------------------------------------------------------------
  const visible = (n) => n && n.getBoundingClientRect().width > 0;

  // The visible left-column header (YouTube renders several, some hidden).
  function headerContent() {
    return Array.from(document.querySelectorAll(SEL.headerContent)).find(visible) || null;
  }

  function findAnchor() {
    return headerContent();
  }

  function ensurePanel() {
    if (!isPlaylistPage()) {
      removePanel();
      return;
    }
    const id = currentListId();
    if (state.listId !== id) {
      // switched playlist (SPA navigation)
      state.listId = id;
      state.sortKey = null;
      state.meta = {};
      state.note = '';
      state.statsKey = null;
      state.settledCount = null;
      lastRowCount = -1;
      removePanel();
    }
    if (state.panel && document.contains(state.panel)) return;
    const anchor = findAnchor();
    if (!anchor || !$rows().length) return; // wait until header and list exist
    const panel = state.panel || buildPanel();
    // Place directly after the header's title block when we can identify it.
    const place = locateInsertion(anchor);
    place.parent.insertBefore(panel, place.before);
    render();
  }

  function locateInsertion(hdr) {
    // Immersive/"Course" header: right under the Play/Shuffle buttons, above the (long) description.
    const playMenu = Array.from(hdr.children).find((c) => c.classList.contains('play-menu'));
    if (playMenu) return { parent: hdr, before: playMenu.nextSibling };
    // Regular header: end of the left column.
    return { parent: hdr, before: null };
  }

  function removePanel() {
    clearOrder();
    if (state.panel) {
      state.panel.remove();
      state.panel = null;
    }
  }

  // Keep list and panel consistent when YouTube adds rows / re-renders.
  let debounce = null;
  let lastRowCount = -1;
  function onMutation() {
    // Throttle (not debounce): YouTube mutates the DOM constantly while loading, which would keep
    // postponing a debounce and delay the panel by seconds.
    if (debounce) return;
    debounce = setTimeout(() => {
      debounce = null;
      if (!isPlaylistPage()) {
        if (state.panel) removePanel();
        return;
      }
      ensurePanel();
      if (!state.panel || state.loading) return;
      const rows = $rows();
      // Re-sort / re-compute only when the list actually changed (new rows loaded, rows re-created).
      const unsorted = state.sortKey && rows.some((r) => wrapperOf(r).style.order === '');
      if (rows.length !== lastRowCount || unsorted) {
        lastRowCount = rows.length;
        if (state.sortKey) applySort();
        renderStats();
      }
    }, 250);
  }

  async function boot() {
    await loadSettings();
    ensurePanel();
    new MutationObserver((records) => {
      // Ignore our own panel updates, otherwise every refresh would trigger another one.
      const panel = state.panel;
      if (panel && records.every((r) => panel.contains(r.target))) return;
      onMutation();
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('yt-navigate-finish', onMutation);
    setInterval(onMutation, 3000); // cheap watchdog
  }
  boot();
})();
