/* Parsing helpers. Loaded as a content script (global YPTParse) and by Node tests (module.exports). */
(function (root) {
  const SUFFIX = { k: 1e3, m: 1e6, b: 1e9 };

  // "1.2M views" -> 1200000, "1,234 views" -> 1234, "No views" -> 0, unknown -> null
  function parseViews(text) {
    if (text == null) return null;
    const s = String(text).trim().toLowerCase();
    if (!s) return null;
    if (/^no\s+views?/.test(s)) return 0;
    // Accept "1.2M views", "1,234 views" and the bare form used by the new playlist layout ("19m", "204K").
    const m = s.match(/([\d.,]+)\s*([kmb])?\s*views?/) || s.match(/^([\d.,]+)\s*([kmb])?$/);
    if (!m) return null;
    let num = m[1];
    // Treat "1,234" as thousands separator, "1.2" as decimal.
    if (/,/.test(num) && !/\./.test(num)) num = num.replace(/,/g, '');
    else num = num.replace(/,/g, '');
    const val = parseFloat(num);
    if (isNaN(val)) return null;
    return Math.round(val * (m[2] ? SUFFIX[m[2]] : 1));
  }

  // "1:02:03" -> 3723, "4:05" -> 245, "0:45" -> 45, unknown -> null
  function parseDuration(text) {
    if (text == null) return null;
    const s = String(text).trim();
    if (!/^\d+(:\d{1,2}){1,2}$/.test(s)) return null;
    const parts = s.split(':').map(Number);
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }

  // ISO 8601 "PT1H2M3S" -> 3723
  function parseISODuration(iso) {
    const m = String(iso || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
    if (!m) return null;
    const [, d, h, mi, s] = m.map((x) => (x ? Number(x) : 0));
    return d * 86400 + h * 3600 + mi * 60 + s;
  }

  const UNIT_MS = {
    second: 1e3,
    minute: 6e4,
    hour: 36e5,
    day: 864e5,
    week: 6048e5,
    month: 2629800000,
    year: 31557600000,
  };

  // "3 years ago", "Streamed 2 weeks ago" -> approximate epoch ms, unknown -> null
  function parseRelativeDate(text, now) {
    if (!text) return null;
    // Long ("3 years ago") and short ("1 yr ago", "9 mo ago", "2 wk ago") forms.
    const m = String(text)
      .toLowerCase()
      .match(/(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|mos?|years?|yrs?)\s+ago/);
    if (!m) return null;
    const u = m[2];
    const unit = /^(sec)/.test(u) ? 'second' : /^(min)/.test(u) ? 'minute' : /^(h)/.test(u) ? 'hour'
      : /^(d)/.test(u) ? 'day' : /^(w)/.test(u) ? 'week' : /^(mo)/.test(u) ? 'month' : 'year';
    return (now || Date.now()) - Number(m[1]) * UNIT_MS[unit];
  }

  // 3723 -> "1:02:03", 245 -> "4:05"
  function formatDuration(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  // 93784 -> "1d 2h 3m" ; 3723 -> "1h 2m 3s"
  function formatLong(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const out = [];
    if (d) out.push(`${d}d`);
    if (h) out.push(`${h}h`);
    if (m) out.push(`${m}m`);
    if (s && !d) out.push(`${s}s`);
    return out.length ? out.join(' ') : '0s';
  }

  // 1234567 -> "1.23M"
  function formatCount(n) {
    if (n == null) return '–';
    if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.?0+$/, '') + 'K';
    return n.toLocaleString('en-US');
  }

  function csvEscape(v) {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  const api = {
    parseViews,
    parseDuration,
    parseISODuration,
    parseRelativeDate,
    formatDuration,
    formatLong,
    formatCount,
    csvEscape,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.YPTParse = api;
})(typeof self !== 'undefined' ? self : this);
