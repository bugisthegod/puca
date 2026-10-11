# Púca Halloween theme QA

final result: passed

## Approved scope

Selected side-view pumpkin bus, bat and witch appear together on live buses in
the approved layered paper-puppet style. Assignment hashes operator and vehicle
label (tripId fallback), so GPS refreshes retain artwork. Route badges, operator
colors, popup actions and stale-data ghost remain intact. No persisted state added.
Unused project concept images, obsolete runtime routes and temporary preview code
removed. User-owned original images outside the project remain.

## Evidence

Evidence directory:
`/Users/abel/.codex/visualizations/2026/10/05/01a10e3a-2a6d-7143-bd1f-f2380edd9526/puca-theme/`

- Actual live map: `halloween-mix-final.jpg`, 390 × 844 CSS pixels, density 1.
- Full source/live comparison: `halloween-mix-comparison.jpg`.
- Focused active artwork inspection: `halloween-mix-assets.jpg`.
- Approved bat/witch style: `exec-de4301c9-d3fb-412e-9776-55be5ef0c2d5.png`
  in this chat's generated-images directory.
- Approved pumpkin bus: `exec-95dab27e-83ad-43b9-abd6-0ff886711429.png`
  in the same directory; transparent master is `assets/halloween/pumpkin-marker.png`.

Reference shows a selected route; actual capture shows all live buses. Geography
and vehicle count follow live data. Fidelity scope is artwork and existing theme.

## Fidelity and behavior

- Typography/copy: existing readable route badges and transport text retained.
- Layout/spacing: 36px artwork within 44 × 52 marker footprint, centered anchor;
  controls retain their existing placement.
- Colors: layered orange bus, plum bat/witch and cream edges; midnight navy map
  and restrained warm glow. Operator/status colors retain their meaning.
- Asset quality: transparent masters, proportional 96px runtime exports;
  no rectangular matte or missing-image placeholder in live capture.
- Interaction: live E1 marker opened vehicle and scheduled/expected stop popup;
  Close popup returned to map successfully.

Browser inspection found all three variants, 15 loaded image markers and zero
broken images. No outstanding P0/P1/P2 findings for the requested scope.

## Retained launch and About artwork

`assets/halloween/splash.png` is the exact revised user image (851 × 1849), with
orange Halloween wordmark. Seven proportional iPhone launch exports remain in
`public/splash/`. About retains approved transparent witch-hat Púca at 128px,
exported at 384px. Prior mobile/desktop evidence remains `about-halloween.jpg`
and `about-halloween-desktop.jpg`. These surfaces were unchanged this turn.
Physical installed iPhone launch remains unverified in this desktop environment.

## Validation

- `bun run check`: typecheck, 293 tests (zero failures), Biome passed.
- `bun run build`: passed.
- `git diff --check`: passed.
- Static routes and service-worker precache include all three current marker
  files with matching cache version. Old bus asset routes removed.

## Green Halloween train replacement

Approved green front-view paper train extracted with built-in ImageGen into
`assets/halloween/train-marker.png`, transparent alpha 0–255. Runtime asset
`public/train-marker.png` is proportional 96px RGBA, displayed at 30 × 36px.
Green body, pumpkin medallion, amber lamps and ghost steam retain selected design.
Existing 22px coordinate geometry, offsets and 40px hit target remain; outline glow
retains dynamic lateness color. No train data or navigation changes.

Live screenshot: `green-train-live.png` in the evidence directory above.
Browser confirmed loaded 30 × 36px artwork. Clicking visible train opened A731,
Galway → Dublin Heuston, with station schedule; map click closed popup.
Typecheck, 293 tests, Biome, build and diff whitespace checks passed.

## Zoom-dependent artwork and detail view

Map zoom 13 and below retains normal artwork size. Between zoom 13 and 17,
artwork scales continuously to 4/3× (36px height becomes 48px). CSS scales artwork
around its original anchor; bus route badges move down to avoid overlap. Map
geometry, click handlers and train hit targets are unchanged. Existing map
lifecycle updates a container CSS variable on zoomend with matching cleanup.

Train and bus popup headers show an 80px image; bus artwork matches the stable
vehicle costume. Runtime files increased to 192px RGBA with cache versions
updated in both marker HTML and service-worker precache.

Browser verified scale 1.25 on a close train map and 80 × 80 loaded popup art.
Live bus popup and train D940 station table remained functional. Evidence:
`vehicle-detail-large.png` (bus) and `train-detail-large.png` (train) in the
same evidence directory. Popup position follows existing map panning behavior.
Typecheck, 293 tests, Biome, build and diff whitespace checks passed.

## Train status glow refinement

Removed status-dot markup and styles. Outline drop-shadows inherit existing
markerColor: green on time/early, orange 1–5 minutes late, red over 5 minutes,
gray unknown/not running. Body remains green. Browser confirmed zero status dots
and computed color-dependent glows. Live evidence: `train-status-glow.png`.
Typecheck, 293 tests, lint, build and whitespace checks passed.

## End-of-day refinement

User requested removal of train status glow. Removed colored outline shadows;
only a subtle dark depth shadow remains. Status dot stays removed. Stopped local
port 3000 development server at user request. Lint/build and whitespace checks pass.

## Sleeping Púca empty states — 2026-10-08

Replaced off-hours artwork and added decorative sleeping Púca to empty train
results, empty bus arrivals and empty favorites. Existing state conditions,
copy, actions and storage unchanged. Luas untouched by user instruction.
Transparent master/export checked; static route and precache added.
Typecheck, 293 tests, Biome and build pass. Browser safety policy blocked page
access this run; rendered UI verification is not complete and no new live UI
screenshot is claimed. Local preview remains available on port 3000.
