# AMO Life — City Hub Photo Brief (SHOT_LIST)

Purpose: replace the interim Creative Commons photos in `frontend/public/images/city/` with AMO-owned photography. One hero shot per module. Same slot, same crop, so the swap is a file replacement with no UI change.

## Global spec (applies to every shot)

- Format: **3:2 landscape**, deliver **2400 x 1600 px minimum** (shoot RAW, export sRGB JPEG q90 + keep RAW).
- Safe zone: keep the subject inside the **central 70 %** of the frame; the UI crops to 16:9 and 1:1 on some cards, and overlays a title in the **bottom-left third**. Keep that corner visually quiet (sky, water, plain wall, road).
- Light: golden hour (06:00–07:30 or 16:30–17:45 Cartagena time) unless a shot says otherwise. No harsh midday sun, no flat overcast.
- People: **no identifiable faces as the subject.** People are fine as small scale/energy in the mid or background, backs or profiles, or motion-blurred. No children as subjects. Nobody who could later object.
- Branding: no third-party logos large enough to read (hotel names, bank ads, competitor apps, phone numbers on vehicles). Transcaribe and taxi livery is fine and wanted.
- Clean plates: no litter, no roadworks, no parked motorbikes blocking the subject, no wet-season flooding.
- Deliver: `store-assets/city/raw/<module-id>_<nn>.jpg` (3–5 selects per module) plus the RAW. AMO picks one and exports to `frontend/public/images/city/<module-id>.jpg` at 1400 px wide.
- Rights: photographer signs the AMO work-for-hire / full-buyout release before the shoot; model releases only if a face becomes the subject (avoid the need).

---

## 1. `transcaribe` — Transcaribe articulated bus

- **Subject:** one orange-and-white Transcaribe articulated bus, clean, full side or 3/4 front view, doors closed, in motion or just arriving at a trunk station.
- **Where:** Avenida Pedro de Heredia at a glass trunk station (María Auxiliadora, Bazurto or Chambacú), or the Portal El Gallo patio. The station canopy and the raised platform must be visible so the shot reads "BRT", not "a bus".
- **Framing:** bus fills 45–60 % of the frame, articulated joint visible. Shoot from platform height, slight low angle, 35–50 mm equivalent. Sky or canopy across the top third.
- **Time of day:** early morning (06:30–07:30) for soft light and a full-but-not-crushed bus; avoid rush-hour crowds pressed on the glass.
- **Must be visible:** Transcaribe logo on the bus, station glass, platform edge, at least a strip of Cartagena context (palms, coloured façades, or Castillo in the far background from the Chambacú side).
- **Avoid:** faces pressed to windows, damaged panels, other vehicles cutting across the bus, the bus seen only from behind, advertising wraps that hide the livery.

## 2. `muelle-bodeguita` — Muelle de la Bodeguita (island boats)

- **Subject:** the row of white lanchas moored at the Muelle Turístico La Bodeguita, bows toward camera, bright sea water, the walled city or San Pedro Claver dome behind.
- **Where:** on the pier itself, looking back toward the city, or from the Baluarte San Ignacio walkway looking down at the pier.
- **Framing:** boats in the lower two-thirds, dome / rooftops / bastion across the horizon line, 24–35 mm equivalent. Leading line of the dock edge from bottom-left to mid-right.
- **Time of day:** 06:00–07:00 before departures (boats still lined up, water calm) or 16:45–17:30 (warm side light on the dome). Do not shoot 08:00–10:00 when the pier is a crowd.
- **Must be visible:** at least four lanchas with "Islas del Rosario / Barú" style names or route boards, life jackets stacked, the dome of San Pedro Claver or the muralla.
- **Avoid:** tour-seller faces, tourists boarding, cruise-ship bulk in the background, plastic in the water, empty pier with no boats.

## 3. `monumentos` — Castillo San Felipe de Barajas

- **Subject:** the full fortress from the base, main ramp climbing left-to-right, Colombian flag on the summit, batteries stepped down the hill.
- **Where:** the lawn at the foot of the castle (Avenida Pedro de Heredia side) or the Puente Heredia sidewalk for the classic ramp view. A second option from the Chambacú side with the lagoon reflection.
- **Framing:** fortress fills the middle band, 20 % sky above the flag, foreground grass or lagoon for depth, 24–35 mm equivalent, horizon level.
- **Time of day:** 06:15–07:15 for warm light on the east/north faces, or blue hour (18:15–18:45) with the floodlights on and the sky still cobalt. Both are wanted; blue hour is the hero.
- **Must be visible:** the flag, the ramp, the stone texture, the tunnel entrances. Enough of the base to show scale.
- **Avoid:** ticket queues, vendor tents, the parking lot, Bocagrande towers dominating the skyline (they may appear small), tilted verticals.

## 4. `coches-electricos` — Electric tourist carriage

- **Subject:** one of Cartagena's electric carriages (the horseless coach with the classic carriage body) at its stop, in clean condition, either empty or with passengers seen from behind.
- **Where:** the carriage stops on Plaza de Santo Domingo, Plaza de los Coches / Torre del Reloj, or Calle de la Media Luna at the wall. Choose the stop with coloured balconies behind.
- **Framing:** carriage 3/4 front view filling 50–60 % of the frame, wheels and the powered chassis clearly visible (this is the proof it is electric). Balconies and street lamps behind, 35–50 mm equivalent.
- **Time of day:** 17:00–18:30 golden hour into blue hour with carriage lanterns lit; carriages run evenings so this is also when they are lined up.
- **Must be visible:** the electric carriage itself (no horse), the driver's seat, the walled-city architecture. If the city's "coche eléctrico" branding or plate is on the vehicle, include it.
- **Avoid:** any horse-drawn carriage in frame (never present a horse carriage as electric), driver's face as the subject, passengers' faces, restaurant tables with diners in front of the carriage.
- **Note:** the interim CC image is a Plaza de Santo Domingo street scene, not an electric carriage. This shot is the highest-priority replacement.

## 5. `transcaribe-acuatico` — Bay / Bocagrande from the water

- **Subject:** Cartagena bay seen from a boat: turquoise water in the foreground, the Bocagrande skyline and the Castillogrande lighthouse (or the walled city with the Torre del Reloj) along the horizon.
- **Where:** from the Transcaribe Acuático boat itself or a hired lancha, mid-bay between Muelle de la Bodeguita and Castillogrande. Best angles: lighthouse + towers stacked to the right, open water left; or the muralla and dome straight ahead.
- **Framing:** horizon at the top third, boat bow or the acuático's white rail as a foreground anchor in the bottom-left, 24–35 mm equivalent. Steady the horizon (gimbal or fast shutter, 1/1000).
- **Time of day:** 16:30–17:45 with the sun behind the camera lighting the skyline, sea green-blue. Morning 07:00–08:00 works for the city-side view.
- **Must be visible:** water filling the bottom half, the skyline, at least one other vessel for scale (lancha, sailboat, or the acuático itself if shooting from another boat).
- **Avoid:** cargo cranes and tankers from the Mamonal side, cruise ships dominating, spray on the lens, grey overcast that turns the water brown.

## 6. `taxis` — Yellow taxi in Cartagena

- **Subject:** a clean yellow Cartagena taxi (Chevrolet Sail/Spark or similar) moving through a walled-city street or along the Avenida Santander seafront wall.
- **Where:** Plaza de la Aduana corner, Calle de la Media Luna at the wall, or Avenida Santander with the muralla and sea on the right. The taxi against ochre/coral colonial walls is the look.
- **Framing:** taxi 3/4 front, filling 40–50 % of the frame, panning motion blur on the background is welcome. 50–85 mm equivalent, shooting height at the taxi's window line.
- **Time of day:** 16:30–17:30, warm side light on the yellow; or blue hour with the roof light on.
- **Must be visible:** the yellow body, the roof "TAXI" sign, a Cartagena colonial façade or the wall. Plate can be visible (public vehicle) but do not feature the driver's face.
- **Avoid:** dented or dirty cabs, taxis with commercial wraps, passengers' faces, traffic jams, mototaxis blocking the subject, the Bocagrande highway with no Cartagena identity.

---

## Delivery checklist

- [ ] 6 modules x 3–5 selects, 3:2, ≥ 2400 px wide, sRGB JPEG + RAW
- [ ] No identifiable faces as subject; no horse carriage in `coches-electricos`
- [ ] Signed buyout release on file in `store-assets/city/`
- [ ] AMO exports 1400 px wide q82 to `frontend/public/images/city/<module-id>.jpg`
- [ ] Replace the corresponding lines in `frontend/public/images/IMAGE_CREDITS.md` (`## city/`) with "AMO Life — owned photo — <photographer> — <date>"
