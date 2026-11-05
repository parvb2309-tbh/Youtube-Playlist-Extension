# How to create a YouTube Data API key (optional, free)

The extension works **without** a key: it reads view counts from the playlist page, which YouTube rounds (e.g. "1.2M views"). Adding a key makes the data exact and unlocks a few features.

## What a key gives you

| Feature | Without key | With key |
|---|---|---|
| Sort by views | Works, using rounded counts | Works, using exact counts (breaks ties between "1.2M" videos correctly) |
| Sort by likes | Not available (the playlist page doesn't show likes) | Available |
| Sort by upload date | Approximate ("3 years ago") | Exact timestamp |
| Duration | From the thumbnail badge | Exact, from the API |
| CSV export | Views, duration | Also exact views, likes and upload date |

The key does **not** let the extension change your playlists. It only reads public video statistics.

## Create the key

1. Go to <https://console.cloud.google.com/> and sign in with a Google account.
2. Click the project picker at the top, then **New project**. Name it (e.g. "YouTube Playlist Toolkit") and click **Create**. Make sure it is selected.
3. Open **APIs & Services → Library**, search for **YouTube Data API v3**, open it and click **Enable**.
4. Open **APIs & Services → Credentials → Create credentials → API key**. Copy the key (it starts with `AIza`).
5. Click **Edit API key** (or "Restrict key") and set:
   - **API restrictions → Restrict key → YouTube Data API v3**.
   - **Application restrictions: None.** Do **not** use "Websites (HTTP referrers)": the extension makes requests from its background worker, which sends no referrer, so those requests would be rejected.
6. Save.

## Add it to the extension

1. Open `chrome://extensions`, find **YouTube Playlist Toolkit** and click **Details → Extension options** (or click **Settings** in the panel on any playlist page).
2. Paste the key, click **Test key**, then **Save**.
3. Reload any open YouTube tabs. The panel header changes from "Page data" to "API data".

## Quota

- Free quota: **10,000 units per day** per project.
- The extension calls `videos.list`, which costs **1 unit per call**, and each call covers up to 50 videos. A 500-video playlist costs about 10 units.
- If you exceed the quota you will see an `API error ... quotaExceeded` note in the panel and the extension falls back to page data. The quota resets daily (midnight Pacific time).

## Security

- The key is stored in your browser through Chrome's extension storage (synced to your Google account if Chrome sync is on). It is only ever sent to `googleapis.com`.
- Don't share the key or commit it to a repository. Because it's restricted to the YouTube Data API, the worst case if it leaks is someone using up your free quota.
- To rotate it: create a new key in the Credentials page, save it in the settings and delete the old one. To remove it from the extension, click **Clear** in the settings.

## Troubleshooting

| Message | Meaning |
|---|---|
| `API key not valid` | Typo in the key, or the key was deleted. |
| `accessNotConfigured` / `has not been used in project` | YouTube Data API v3 isn't enabled for the project (step 3). |
| `ipRefererBlocked` / `referer ... are blocked` | You added an HTTP-referrer restriction. Set application restrictions to **None**. |
| `quotaExceeded` | Daily quota used up; try again tomorrow. |
