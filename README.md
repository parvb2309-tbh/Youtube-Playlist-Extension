# YouTube Playlist Toolkit

A Chrome (Manifest V3) extension that adds a panel to the left sidebar of any YouTube playlist page, under the playlist title.

## Features
- **Sort by views**: click once for most viewed first, click again for least viewed first. More sorts: duration, upload date, likes (needs an API key), title and channel.
- Sorting is **visual only**: your real playlist is never modified. **Reset order** restores the original order.
- Total duration, average video length and time left at 1x, 1.25x, 1.5x and 2x (watched progress is taken into account).
- Video count, total views and a watched-progress bar.
- Copy links, copy titles and download a CSV of the playlist, in the order you currently see it.
- Optional YouTube Data API key for exact numbers: see [API_KEY_GUIDE.md](API_KEY_GUIDE.md).

## Install
1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder (`C:\chrome-youtube-extension`).
4. Open any playlist, e.g. `https://www.youtube.com/playlist?list=...`. The panel appears under the playlist title.

After changing the code, click the reload icon on the extension card and refresh the YouTube tab.

## Notes
- YouTube loads long playlists 100 videos at a time. Sorting automatically scrolls to load the whole playlist first, then returns you to where you were. Totals show a `+` while the list is only partially loaded.
- Unavailable (private or deleted) videos are listed last and are excluded from totals.
- Without an API key, view counts are rounded by YouTube, so videos with similar counts (e.g. two at "1.2M") keep their original relative order.
- If YouTube changes its page layout, the selectors at the top of `content.js` (`SEL`) are the only thing that should need updating.

## Tests
```
node tests/parse.test.js
```
