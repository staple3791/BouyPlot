# BuoyPlot | Sailing mark setter

A free, installable web app for planning a sailing course and navigating to mark positions on an iPhone.

## Install / publish (GitHub Pages)

1. Create a **public** GitHub repository named `buoyplot` (or another name).
2. Upload every file in this folder into the repository root, including `index.html`, `app.js`, `styles.css`, icons, `sw.js` and `manifest.webmanifest`.
3. Open the repository's **Settings > Pages**. Under **Build and deployment**, choose **Deploy from a branch**, the `main` branch and the `/ (root)` folder, then save.
4. Open `https://YOUR-USERNAME.github.io/buoyplot/` on the iPhone using Safari. Your actual URL uses your selected repository name.
5. In Safari, use **Share > Add to Home Screen** and enable **Open as Web App** if offered. Allow location access when prompted.

GPS location requires a secure (HTTPS) origin. Opening `index.html` as a local `file://` page is useful for viewing but may not allow GPS or service workers. GitHub Pages serves over HTTPS.

## Use

- Tap **Add mark**, then tap the chart to place a mark. Repeat for as many marks as needed.
- Select a mark in the list or by tapping its symbol on the map.
- Edit the name or exact latitude and longitude in **Details**, or tap **Move selected** to reposition it.
- Tap the crosshair button to start high-accuracy GPS updates and centre the map on the current boat location.
- Select the next target. The app displays **metres / nautical miles** and **true bearing** from the current GPS fix to that target.
- When you place a buoy, tap **Record buoy laid here** to save the actual position and show the difference from the target.
- Export the current course's target marks as GPX, or export/import all courses as JSON.

## Things to know

- This is a **prototype**, not certified marine navigation software. Use your normal lookout, charts and navigation methods.
- Coordinate entry uses signed **decimal degrees**, e.g. `-33.820000, 151.235000`. Longitude east of Greenwich is positive, latitude south of the equator is negative.
- Bearings are relative to **true north**, not magnetic north. GPS accuracy can vary and the buoy itself can move due to anchor scope, currents and wind.
- Course data stays in local browser storage on the device and does **not automatically sync** to other devices. Back it up with the JSON export. Clearing website data can erase saved courses.
- The app shell is cached for offline use *after it has loaded over HTTPS*. **OpenStreetMap tiles are online**. When disconnected, the app can show a blank grid instead of a coastline; marks, target ranges and bearings are still drawn when device geolocation remains available. Mobile browsers may suspend GPS updates when the phone is locked or the app moves into the background.
- The app does not predownload or bulk-cache OpenStreetMap tiles. For offline nautical charts in a future version, use a properly licensed chart source or tiles under a suitable licence.
- The first map view is Sydney Harbour; use GPS or pan/zoom to choose a different location.

## No subscription or backend

Only static files and free online OpenStreetMap tiles are used. No paid API key, server/database, account, or login is required. GitHub Pages hosts a static public repository on its free plan.

## Development

Run a local HTTP server in this directory (for map planning only):

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000` on the **same machine**. Browser geolocation on an iPhone still needs an HTTPS deployment.
