const $ = (id) => document.getElementById(id);
const status = (msg, cls) => {
  const el = $('status');
  el.textContent = msg;
  el.className = cls || '';
};

chrome.storage.sync.get(['apiKey', 'defaultSort']).then(({ apiKey, defaultSort }) => {
  if (apiKey) $('apiKey').value = apiKey;
  if (defaultSort) $('defaultSort').value = defaultSort;
});

$('toggle').onclick = () => {
  const inp = $('apiKey');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  $('toggle').textContent = show ? 'Hide' : 'Show';
};

$('save').onclick = async () => {
  const key = $('apiKey').value.trim();
  if (!key) return status('Enter a key first, or use Clear.', 'err');
  await chrome.storage.sync.set({ apiKey: key });
  status('Saved. Reload open YouTube tabs to use it.', 'ok');
};

$('clear').onclick = async () => {
  await chrome.storage.sync.remove('apiKey');
  $('apiKey').value = '';
  status('Key removed. The extension will use page data.', 'ok');
};

$('test').onclick = async () => {
  const key = $('apiKey').value.trim();
  if (!key) return status('Enter a key to test.', 'err');
  status('Testing…');
  try {
    // dQw4w9WgXcQ is just a well-known public video id.
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=dQw4w9WgXcQ&key=${encodeURIComponent(key)}`
    );
    const json = await res.json();
    if (!res.ok) {
      const e = json.error || {};
      const reason = e.errors && e.errors[0] && e.errors[0].reason;
      return status(`Key rejected: ${e.message || res.status}${reason ? ' (' + reason + ')' : ''}`, 'err');
    }
    status('Key works ✔', 'ok');
  } catch (e) {
    status('Network error: ' + e.message, 'err');
  }
};

$('saveDefaults').onclick = async () => {
  await chrome.storage.sync.set({ defaultSort: $('defaultSort').value });
  status('Defaults saved.', 'ok');
};
