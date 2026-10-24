# BuoyPlot | Sailing mark setter

A free, installable web app for planning a sailing course, positioning start-line points and buoys, previewing manually entered wind direction, and navigating to course positions using an iPhone.

**Version 3** adds a nearly full-screen map on iPhone with a draggable control panel, interactive course moving and automatic wind-relative course updates. Version 2 also introduced wind flow, a start boat/pin end, start-line alignment and windward/leeward mark placement. Existing Version 1 and Version 2 saved courses remain available when you update the same website.

## Install
4. Open `https://staple3791.github.io/BouyPlot/` on the iPhone using Safari. Your actual URL uses your selected repository name.
5. In Safari, use **Share > Add to Home Screen** and enable **Open as Web App** if offered. Allow location access when prompted.


## Map-first layout (iPhone)

- The map fills the available screen. The panel at the bottom opens in three positions: **peek**, **half open**, or **full open**. Drag the small grey handle vertically to resize it, or tap the handle to cycle through positions.
- The map remains draggable and pinch-zoomable in the exposed area above the panel, independently of scrolling inside the open panel. Map-centering and **Fit all** account for the panel so planned marks remain visible.
- The point-type selector and **Add point** stay above the bottom panel. Select a point, expand the panel to edit its details, then use **Move on map** to collapse the panel and tap its new position.
- The desktop view keeps the side panel.

## Course planning (Version 3)

1. Place the **Start boat** and **Pin end** and open **Wind & course**.
2. Set the wind direction *from* true north and desired **start-line length**, **windward leg**, and **leeward offset**.
3. Press **Place W/L marks** once. With **Automatically update generated marks** enabled, future changes to wind or leg lengths automatically reposition these two marks relative to the start-line midpoint.
4. Use **Square line around centre** to turn the start line perpendicular to the wind without moving its midpoint. Alternatively, **Align pin across wind** keeps the start boat in place while repositioning the pin.
5. If you enable **Keep start line square to wind changes**, adjusting wind direction automatically rotates both start-line endpoints around their midpoint.
6. Enable **Move course** from the map's four-way arrow button (or the planning panel). Drag anywhere along the start line, its centre handle, or either endpoint to move the **start boat, pin and generated windward/leeward marks together**. Manually added orange buoys remain where you placed them.
7. You can still drag an individual generated buoy. Doing so switches off automatic mark alignment to preserve your manual change. Turn it back on when you want to recalculate linked positions.

These are planning tools, not live observations of wind or exact buoy locations. Check water depth, obstructions and the actual conditions before placing marks.

## Use

- Choose **Orange mark**, **Pin end**, or **Start boat** from the Add point menu, then tap **Add point** and tap the map. Each course can have one pin end and one start boat, plus orange buoys.
- Tap a point on the chart or in the list to select it. **Drag** a map marker to reposition it, or use **Move on map** if touch dragging is difficult.
- Edit point type, name, and exact latitude/longitude in **Details**. With GPS enabled you can use **Set to my GPS** to capture your live position.
- Tap the crosshair button to start high-accuracy GPS updates and centre the map on the current boat location.
- Select the next target. The app displays **metres / nautical miles** and **true bearing** from the current GPS fix to that target.
- When you place a buoy, tap **Record mark laid here** to save the actual position and show the difference from the target. You can also record where the start boat is anchored.
- In **Wind & course**, set wind direction in **degrees true, FROM** (e.g. 090° means an easterly blowing west). The flowing arrows show where it blows **towards**. This visual is **not a forecast** and the app does not download wind data.
- Place a start boat and pin end to draw a start line. Set a desired line length, then tap **Align pin across wind** to position the pin perpendicular to the entered wind direction while keeping the boat fixed. The app preserves whichever side the pin was previously on.
- Set **Windward leg (m)** and **Leeward offset (m)**, then tap **Place W/L marks** to add two orange marks along the wind direction from the start-line midpoint. This can also update previously generated W/L marks with confirmation. With automatic alignment enabled, subsequent changes to wind direction and leg lengths update them without needing to generate again. All coordinates can still be individually adjusted.
- Export the current course's planned course points as GPX, or export/import all courses (including wind layout settings) as JSON.

## Things to know

- This is a **prototype**, not certified marine navigation software. Use your normal lookout, charts and navigation methods.
- Coordinate entry uses signed **decimal degrees**, e.g. `-33.820000, 151.235000`. Longitude east of Greenwich is positive, latitude south of the equator is negative.
- Bearings are relative to **true north**, not magnetic north. GPS accuracy can vary and the buoy itself can move due to anchor scope, currents and wind.
- Course data stays in local browser storage on the device and does **not automatically sync** to other devices. Back it up with the JSON export. Clearing website data can erase saved courses.
- Wind arrows are manually configured, animated symbols showing direction only. They do **not** use real wind forecasts, wind speed, current, or gusts. Keep checking actual conditions before laying marks.
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
