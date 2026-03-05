# SignalStream RSS Studio

SignalStream RSS Studio is a professional light-mode RSS dashboard where users can add custom feeds and get periodic updates automatically.

## Live App

- GitHub Pages: https://lelouch29-21.github.io/rss-feed-studio/

## Highlights

- Professional colorful UI with responsive layout
- Add RSS/Atom feeds by URL
- Per-feed accent color and custom naming
- Automatic periodic refresh (configurable)
- Manual refresh for all feeds or individual feeds
- Feed-level error visibility
- Search across headlines, summaries, and sources
- Feed filter + article explorer
- Local persistence with `localStorage`

## How Periodic Updates Work

- Auto-refresh runs while the app tab is open.
- You can configure refresh cadence from 1 to 180 minutes.
- A live countdown shows time to next automatic sync.

## Run Locally

```bash
cd rss-feed-studio
python3 -m http.server 4173
```

Then open:
- `http://127.0.0.1:4173/`

## Notes

- Some feed servers block direct browser requests due to CORS.
- The app attempts multiple fetch strategies (direct, proxy, JSON fallback) to improve reliability.
