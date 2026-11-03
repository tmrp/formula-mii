# Formula Mii

**This project is entirely vibe coded.**

A complete, playable 3D reconstruction of the **2025 São Paulo Grand Prix** in a
playful Wii Sports inspired world, presented in the style of the Wii Menu, with
every driver as a Mii. The POC uses the latest completed Brazilian Grand Prix
available through [OpenF1](https://github.com/br-g/openf1) as of 13 October
2026: session **9869**, 9 November 2025.

All **20 drivers**, **71 laps** and **93 minutes 11 seconds** are included. The
replay preserves **423,520 recorded positions**, with real speed, pedal, gear,
lap, position and tyre data. It uses recorded race trajectories rather than
repeating a generated lap.

## Run

Install Node.js 22+ and Rust with the WebAssembly target:

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run build:wasm
npm run dev
```

Open the printed local URL (normally <http://localhost:5173>). The exported race
bundle and compiled WASM are checked in, so the browser does not need a live
OpenF1 API or database connection. Rebuilding WASM is only required after
changing the engine.

For a production build:

```sh
npm run build
npm run preview
```

## Controls

| Control                      | Behavior                                           |
| ---------------------------- | -------------------------------------------------- |
| Space / play button          | Play or pause                                      |
| Timeline / ← and →           | Scrub / seek 10 seconds                            |
| Lap input / [ and ]          | Jump to a driver's lap                             |
| Driver list                  | Follow any of the 20 entrants                      |
| Camera buttons / 1–5 / C     | Aerial, chase, onboard, driver close-up, trackside |
| Trackside selector           | Eight fixed stations, or an automatic director     |
| Drag / scroll in aerial view | Orbit / zoom; right-drag to pan                    |
| Speed selector               | 0.25× through 64× playback                         |
| F / fullscreen button        | Fullscreen with playback controls                  |
| Settings                     | Sound, engines, picture, effects, Performance mode |

The standings, gaps, tyre compound, throttle/brake indicators, selected driver's
speed and mini map follow the replay time. Retirements remain visible in the
order; select another driver to continue following the race.

## Architecture and performance

- **Rust → WebAssembly:** the complete sample buffer lives in WASM memory and is
  cleaned once at load (see [Fidelity](#fidelity)). Each frame runs binary
  searches and smooth Catmull-Rom interpolation for every driver, without
  allocations. Random and backwards seeks work independently of previous frames.
  There is no Rust build service or backend requirement at runtime.
- **Three.js / WebGL:** the renderer consumes one fixed 16-float record per
  driver. Nearby cars are drawn by one instanced layer per part (chassis, suit,
  skin, face and one per hairstyle), with each driver's colours and face per
  instance; distant cars use simplified models. Static shadows render once and
  moving cars use lightweight contact shadows; trees and clouds are also
  instanced and static scenery is merged by material. The canvas stops drawing
  when playback and the camera are still. Pixel ratio is capped and
  automatically reduces when frames are slow, with an optional performance mode.
- **Compact data:** native gzip exports transfer about 6.9 MB of telemetry and
  metadata. The loader supports both HTTP gzip decoding and explicit browser
  decompression. WASM is approximately 27 KB.
- **Turso:** raw API responses and chunked export assets are stored in a
  persistent local Turso development database at
  `.cache/openf1/turso-replays.db`. The installed CLI was signed out, so this
  database is **not synced to Turso Cloud**. The hosted POC uses immutable
  exports and needs no database credentials. See
  [the data pipeline](docs/data-pipeline.md) to reproduce acquisition or
  re-export the data.

`src/scene.ts` owns rendering and cameras, `src/venue.ts` builds the circuit and
its surroundings from `public/replay/venue.json`, `src/main.ts` owns the player
UI, `src/mii.ts` builds the Miis, `src/wii.ts` draws the Wii Menu chrome, and
`engine/src/lib.rs` owns interpolation, acceleration and driver availability.

## The Miis and the Wii look

Each driver is a Mii made to resemble them, built from the Wii's own palettes:
six skin tones, eight hair colours, six eye colours and twelve favourite
colours. Their racing suit is the favourite colour closest to the team colour,
as Mii suits are in Mario Kart Wii. Heads use the Mii faceline, the hairstyles
are parametric 3D shells, and eyes, brows, the nose line, mouths and facial hair
are 2D face parts drawn into a texture atlas. The icons in the race order are
renders of the 3D Miis, the same way the Wii makes Mii icons. Per-driver looks
live in the `LOOKS` table in `src/mii.ts`.

The interface follows the Wii Menu and Wii Shop Channel: the pinstriped
background, channel-tile frames, glossy buttons with the blue pointer glow, the
curved bottom bar with its segmented clock (race time) and date (race day), the
Message Board (race control messages), the hand pointer and synthesised menu
sounds, which can be turned off in Settings.

The race has the soft depth of field of Wii Sports: whoever the camera follows
stays crisp while the scenery behind melts into a gentle blur, strongest in the
Driver and Trackside views and only on the far horizon from the air. Like the
Wii, `src/dof.ts` blurs a low-resolution copy of the frame and blends it back by
depth, keeping in-focus pixels out of the blur so Miis never smear into the
background. Its strength can be set or the effect turned off in Settings, and it
is skipped in Performance mode.

Cars racing hard get the effects of a Wii kart racer, drawn by `src/race-fx.ts`
in one instanced draw each. A car using its battery trails a crackling Wii-blue
streak, twinkling sparks and a pool of blue light on the road; a car in
another's tow is wrapped in the white wind lines of a kart slipstreaming. With
the throttle flat out, the rear wheels burst into cartoon fire, tongues of flame
with puffs breaking off and cooling as they rise; braking hard from above about
80 km/h (OpenF1 reports the brake as simply on or off), puffy white smoke
billows from the front tyres and drifts away behind. With DRS open (OpenF1's DRS
field reads 10, 12 or 14), the car rides inside a see-through cone of rushing
wind, rings of air sliding back from a point ahead of its nose; this 2025 race
predates the 2026 low-drag straight-line mode, so DRS is the signal. OpenF1 has
no energy data, so the boost is an estimate: a car at full throttle that is
still pulling hard (acceleration from the recorded speeds, worked out in Rust)
is shown deploying, and the boost fades as it tops out at the end of a straight,
as real cars run out of deployment. The slipstream comes from the cars' recorded
positions: within 60 m behind another car going the same way, nearly in line,
above 150 km/h and on the throttle.

Settings, behind the gear in the header, is laid out like Wii Settings: a Sound
page for the music, the engines, their volumes and the menu sounds, and a
Picture page for depth of field, blur strength, race effects and Performance
mode, with a live preview of the race. Changes apply at once and are remembered
on this device.

Every car has a whisper-quiet toy-kart engine in the spirit of Wii racers,
synthesised in `src/engine-sound.ts` from the car's real revs, throttle and
gears: a soft, hollow hum at half a V6's firing rate that putt-putts gently at
low revs, opens a little on throttle and gives a tiny pop as the driver lifts or
changes down. It sits beneath the music rather than over it. Like a racing game,
the chase view listens just behind the followed car and the aerial view near
what it looks at; like TV, the trackside cameras have microphones at the edge of
the track. The nearest eight cars are heard with distance, stereo and Doppler,
so a pass goes "neeeoowm". Engines are quiet while the replay is paused or
faster than 8×.

The soundtrack, “Bossa de Interlagos”, is an original 32-bar bossa nova written
for this replay in the style of the Wii's channel music (and the race's home
city): vibraphone, electric piano, bass and light percussion, synthesised live
with Web Audio in `src/music.ts`, so there are no audio files and no Nintendo
music. It starts on the first click or key press, since browsers only allow
sound after an interaction, and can be turned off or down from the header or
Settings. Python acquisition scripts use only the standard library.

## Verify

```sh
npm run build
npm test
python3 scripts/data_verify.py
npm run test:browser
```

The WASM integration check compares **111,860 driver frames** across the entire
race against an independent sample lookup, so every car stays on its recorded
trace. It then plays the whole race at 60 fps, checking that no moving car goes
backwards, snaps round or strays from its recorded speed, checks retirements and
reverse seeks, and reports a 10,000-frame interpolation benchmark. Browser
checks run the production preview in Chromium, verifying playback, the race
finish/restart, lap seeks, all drivers and camera modes, trackside stations,
mobile layout, fullscreen and keyboard controls. They save screenshots in
ignored `artifacts/`. Set `CHROMIUM_PATH` for a system Chromium executable, or
install Playwright's browser with `npx playwright install chromium`.

For source/Turso hash verification, start the database as described in the data
pipeline and run:

```sh
python3 scripts/data_verify.py --turso-url http://127.0.0.1:8097
```

## Fidelity

OpenF1 locations are approximate and do not capture accurate lateral
wheel-to-wheel placement. Cars may overlap; this is a recorded telemetry
reconstruction, not a collision simulation or broadcast replica. The track, cars
and terrain follow the recorded elevation. The pit lane, lake, buildings,
streets, woods and the three mapped main-straight grandstands come from
OpenStreetMap, fitted to the reference lap within about 7 m; the stands at the
corners are placed at Interlagos's spectator areas rather than surveyed, and
building heights, trees and spectators are illustrative. The eight trackside
camera towers are placed so each sees the whole stretch of track the automatic
director uses it for, over the buildings, crests and woods, clearing only the
few trees that would stand in the way. OpenF1 stamps locations with a clock that
wobbles by about a tenth of a second, and now and then delivers one behind or
beside where the car already was. The engine drops those (189 of 423,520) and
re-times the rest so each car covers its recorded path at its recorded speed,
keeping to the recorded clock on average over a few seconds; cars therefore
drive smoothly instead of surging, stalling or reversing. Short recorded gaps
are held and longer gaps hide cars rather than inventing a trajectory. Race
start/finish and retirement cutoffs are derived from OpenF1 timing, with
documented timing precision in the data pipeline.

Venue map data ©
[OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available
under the Open Database License; `public/replay/venue.json` is an extract of it
under the same licence.

The bundled Zen Kaku Gothic New font stands in for the Wii's system typeface and
is licensed under the SIL Open Font License; the notice is in `public/fonts/`.

## Disclaimer

Formula Mii is a fan-made hobby project. It is not affiliated with, endorsed by,
sponsored by or in any way connected to Nintendo or Formula 1.

Nintendo, Wii, Mii and related names are trademarks of Nintendo and are used
here only to describe the style that inspired the project. No Nintendo assets
are included: the 3D models, Miis, interface art, music and sounds are all made
in code for this project.

F1, Formula 1 and related marks are trademarks of Formula One Licensing B.V.
Team and driver names are used only to identify the real race being replayed,
and no official Formula 1 logos, footage or other assets are included. The race
data comes from OpenF1, an unofficial community project.
