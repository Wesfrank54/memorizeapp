# Publishing Memorize (installable PWA)

The app is a static, offline-first PWA. Building produces a `dist/` folder you can
host anywhere that serves static files at a domain root. Friends open the link,
tap **Install / Add to Home Screen**, and it runs fully offline after the first visit.

## 1. Build

```
cd C:\Users\weslf\Claude\memorize-app
npm run build
```

Output goes to `dist/` (includes `manifest.webmanifest`, `sw.js`, and the icons).

## 2. Publish (pick one — all free)

**Netlify Drop — easiest, no CLI**
1. Go to https://app.netlify.com/drop
2. Drag the `dist` folder onto the page.
3. Copy the `*.netlify.app` URL and share it. (Sign in to keep it permanent / rename it.)

**Cloudflare Pages / Vercel** — connect a Git repo or drag `dist`; both serve at a root URL.

**GitHub Pages** — works too, but a *project* page is served under a sub-path
(`user.github.io/repo/`). For that, set `base: '/repo/'` in `vite.config.ts` and rebuild,
or use a user/org page (root) and no change is needed.

## 3. How recipients install it

- **iPhone/iPad (Safari):** Share → *Add to Home Screen*.
- **Android (Chrome):** menu → *Install app* (or the install prompt).
- **Desktop (Chrome/Edge):** install icon in the address bar.

After first load it's cached, so it opens offline like a native app.

## Updating

Re-run `npm run build` and re-publish `dist/`. The service worker is set to
`autoUpdate`, so installed users get the new version automatically on next open.

## Good to know

- **Data is local to each device.** Progress is stored in the browser (`localStorage`),
  per person, per device. No accounts, no cross-device sync. Clearing site data wipes it.
- **Decks:** first run seeds the small sample decks. To give friends specific decks,
  either send them a `.csv` to load via the **Import** tab, or bake decks into the
  first-run seed (ask and I'll wire it in).
- **Sync bar:** the top sync controls are dev-facing and do nothing without a server —
  say the word and I'll hide them for the friends-and-family build.
