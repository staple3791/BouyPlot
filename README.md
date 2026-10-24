# BuoyPlot v4 | Sailing mark setter

BuoyPlot is a small free, installable web app for planning sailing courses, laying buoys by GPS and recording where they were actually dropped. It uses a full-screen map on iPhone with a swipeable controls panel. All your course points are stored locally in the browser, and you can export them as GPX or back them up in JSON.

## What's new in v4

- **Delete one point:** Tap the small red × beside it in the course list, or select it and tap **Delete** under Details. Either way, you must confirm before deleting.
- **Clear all:** Tap **Clear all** beside **Course points** to remove *every point in the current course* after confirmation. Other saved courses remain untouched.
- **Yellow pin:** The pin end is now yellow on the map and in the list, visually different from your usual orange course buoys. The start boat has its own symbol.
- **Start-line length:** The length between start boat and pin is displayed in metres on the map and in the Wind & course panel. While in Add point mode with Pin end selected, moving the pointer previews a yellow dashed line and estimated length before placing a pin. On iPhone, the final line length stays prominently visible as soon as both endpoints exist.
- **Satellite imagery:** Tap **SAT** in the vertical map toolbar to switch from OpenStreetMap to **Esri World Imagery** (the button changes to **MAP**). A data connection is required to fetch imagery, and service availability and terms depend on Esri and its data providers. Esri imagery is not a navigational chart. Providers are credited on the map. If imagery access is unavailable, select MAP to return to OpenStreetMap.
- **Triangle racecourse:** Under **Wind & course**, change **Course layout** to **Triangle**, choose **Port (left)** or **Starboard (right)**, and specify the **Wing offset** as a percentage of the windward leg. Tap **Place port triangle** or **Place starboard triangle**. This creates generated Windward 1, Wing 2 and Leeward 3 buoys, visually joined on the map. Port positions the wing to the left when looking upwind; starboard puts it to the right. The existing windward/leeward layout option remains available.
- **Drift check:** Record a mark's actual laid position (using **Record mark laid here**) while alongside the buoy. On a later visit, go back alongside that same buoy, select it and tap **Check at my GPS**. The app saves that second GPS observation and compares it with the original laid position. It shows the observed separation in metres, a GPS uncertainty threshold, and either **Possible drift** or **Within GPS error**. This is a *manual observation tool*, not remote or automatic buoy tracking; even an apparent movement larger than the threshold should be rechecked. Clear just the last observation without deleting the original laid position using **Clear check**.

## Upgrade from v1, v2 or v3

1. In your existing deployed BuoyPlot, click **Backup JSON** and save the download before upgrading.
2. Upload/replace all files in the ZIP in the same GitHub Pages repository at its root, keeping the **same web address**.
3. Reload the website in Safari. If you installed it as a Home Screen app, fully close and reopen it. The new service worker cache version is **buoyplot-v4**.
4. Your existing browser-stored courses should be retained because the storage key is unchanged: `buoyplot-courses-v1`. Backups made with previous versions can also be imported from the **Import** button.

## Publish a new installation (GitHub Pages)

1. Make a new public GitHub repository (e.g. `buoyplot`).
2. Upload all files *inside* `sailing-mark-setter` directly to the repository root (`index.html`, `app.js`, `styles.css`, `sw.js`, icons, etc.).
3. In GitHub, open **Settings → Pages → Build and deployment**, choose **Deploy from a branch** and `main` / `/ (root)`.
4. Open your published URL, normally `https://YOUR-USERNAME.github.io/buoyplot/`, in iPhone Safari.
5. Use **Share → Add to Home Screen**. Allow Location Services when requested. GPS needs HTTPS, which GitHub Pages supplies.

## Laying a course

1. On the map, use the type selector beside **Add point** to place an orange buoy, yellow pin or start boat. Pan and pinch to zoom. Tap a point to select it; use the bottom swipe-up panel for its details.
2. Place the start boat and pin. The map shows the **actual planned start-line length** and bearing. You can square the line to a manually entered wind direction or align the pin while holding the boat in place.
3. Choose **Windward / leeward** or **Triangle** under **Course layout**. Enter wind direction as **where the wind comes FROM, degrees true**. Enter windward leg length, leeward offset and optionally triangle wing offset and rounding side. Tap the generate button. Wind arrows show the resulting downwind flow, not live weather.
4. To reposition the entire course, use the four-way-arrow map button for **Move course** and drag the start line. Individual pins/marks can still be dragged. If an individual generated buoy is manually moved, automatic alignment pauses to retain your modification.
5. Start GPS with the crosshair control, select your target buoy and navigate using the distance and true bearing readouts. Recording the buoy's actual laid location is separate from its target location.
6. At a later time, check drift by going alongside the same buoy and capturing a new GPS observation, as described above.

## Important limitations

- **Drift:** A phone cannot remotely tell if an unattended buoy has moved. Drift checking needs a return visit and a fresh location reading taken beside the buoy in a consistent position. GPS accuracy, the boat's distance from the buoy and anchor movement can all influence the measured difference. The comparison threshold is the larger of 10 metres or the *sum* of the two reported GPS accuracy values. This is an indicative threshold only, not a statistical confidence guarantee.
- **Satellite:** Esri World Imagery is an external tiled imagery service, available subject to [Esri's terms](https://www.esri.com/en-us/legal/terms/web-site-service) and imagery licensors' restrictions. Noncommercial use is generally treated differently from paid/commercial use; some uses may require an account or additional permissions. The satellite imagery should not be regarded as free for arbitrary redistribution or unrestricted commercial deployment.
- **Maps and safety:** Imagery and street basemaps are **not nautical charts**. Verify hazards, depth, local restrictions and conditions separately. BuoyPlot is not certified marine navigation equipment. Neither satellite nor street tiles are guaranteed to work without internet; the map may display a blank grid, though locally stored course points and GPS calculations can continue to work if the phone can still obtain a GPS fix. The app cannot guarantee GPS updates when iOS locks or suspends the app.
- **Local data:** Courses live in browser storage, not a cloud account. Clearing that site data, switching domain or using a different device may lose access without a JSON backup. Export a backup regularly. Nothing is shared automatically between devices.
- **True vs magnetic:** All wind bearings, route bearings and alignments are **true north**. There is no magnetic-variation calculation or live wind feed.

## Technical notes

The app uses native HTML/CSS/JavaScript with no frameworks or build step. It displays public tiled imagery and streets on an HTML Canvas using a slippy-map Web Mercator scheme; range/bearing and destination coordinates use spherical great-circle equations. Each course holds up to 250 points, stored under an unchanged browser localStorage key. The service worker caches the local app shell, **not** all remote basemap tiles.

To serve locally for testing (GPS may require HTTPS on mobile):

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000` from the same computer.
