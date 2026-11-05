// Service worker: talks to the YouTube Data API on behalf of the content script.
// The API key never leaves the browser except in requests to googleapis.com.

const API = 'https://www.googleapis.com/youtube/v3/videos';

async function fetchBatch(ids, key) {
  const url = `${API}?part=statistics,contentDetails,snippet&maxResults=50&id=${ids.join(',')}&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || `HTTP ${res.status}`;
    const reason = json && json.error && json.error.errors && json.error.errors[0] && json.error.errors[0].reason;
    throw new Error(reason ? `${msg} (${reason})` : msg);
  }
  const out = {};
  for (const item of json.items || []) {
    const st = item.statistics || {};
    out[item.id] = {
      views: st.viewCount != null ? Number(st.viewCount) : null,
      likes: st.likeCount != null ? Number(st.likeCount) : null,
      comments: st.commentCount != null ? Number(st.commentCount) : null,
      duration: item.contentDetails ? item.contentDetails.duration : null, // ISO 8601
      publishedAt: item.snippet ? item.snippet.publishedAt : null,
    };
  }
  return out;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'ypt:openOptions') {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (!msg || msg.type !== 'ypt:fetchVideos') return;
  (async () => {
    try {
      const { apiKey } = await chrome.storage.sync.get('apiKey');
      if (!apiKey) throw new Error('No API key saved');
      const ids = msg.ids || [];
      const result = {};
      for (let i = 0; i < ids.length; i += 50) {
        Object.assign(result, await fetchBatch(ids.slice(i, i + 50), apiKey));
      }
      sendResponse({ ok: true, data: result });
    } catch (e) {
      sendResponse({ ok: false, error: String(e.message || e) });
    }
  })();
  return true; // async response
});
