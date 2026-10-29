# OpenF1 replay data

The POC uses the **2025 São Paulo Grand Prix**, OpenF1 session **9869**, held at
Interlagos on **9 November 2025**. It is the latest completed Brazilian Grand
Prix available as of **13 October 2026**. OpenF1 lists the November 2026 and
2027 races as future sessions, so the importer filters by completed date rather
than using the largest session key.
[Session source](https://api.openf1.org/v1/sessions?country_name=Brazil&session_name=Race),
[OpenF1 repository](https://github.com/br-g/openf1).

`public/replay/samples.bin` contains recorded positions for all 20 entrants
through the complete race, including its three retirements. It preserves
OpenF1's approximately 3.7 Hz location cadence; no repeated synthetic laps
replace the recorded race. Each location receives the nearest recorded car
telemetry sample. Position and lap use the most recent recorded timing event.
[Location documentation](https://openf1.org/docs/#location),
[car telemetry documentation](https://openf1.org/docs/#car-data).

The timeline begins at the common first-lap start from the laps endpoint. It
ends at the last classified finisher's final lap start plus that lap's duration.
OpenF1 says lap start timestamps are approximate, so there can be a fraction of
a second difference between this timeline and the official result duration.
Finished drivers have their final lap end as `active_until`; retired drivers use
the final telemetry sample at or above 25 km/h because garage telemetry may
continue after retirement. Classification remains the endpoint's recorded `dnf`
value. The source counts, maximum gaps and export hashes are in
`data/replay-quality.json`. [Laps](https://openf1.org/docs/#laps),
[results](https://openf1.org/docs/#session-result).

## Reproduce

The importer uses Python's standard library. Start Turso locally in one
terminal:

```sh
mkdir -p .cache/openf1
turso dev --db-file .cache/openf1/turso-replays.db --port 8097
```

In another terminal:

```sh
python3 scripts/data_ingest.py --as-of 2026-10-13
python3 scripts/data_verify.py
python3 scripts/data_verify.py --turso-url http://127.0.0.1:8097
```

The first run downloads the full race. Requests are spaced by at least 2.1
seconds, below OpenF1's free-tier limit of 30 requests per minute; transient
failures receive bounded retries. Later runs read the recorded raw responses
from Turso. `--refresh` explicitly refetches them. `--session 9869` pins the
POC, while omitting it selects the latest completed Brazilian race.
[OpenF1 access limits](https://openf1.org/#get-access).

All persistent raw response payloads and the finished replay exports are stored
in the **local Turso development database**, using the schema in
`data/schema.sql`. The ignored database contains compressed endpoint payloads.
Replay assets use 512 KiB chunks to respect the server's per-binding size limit;
`replay_assets.payload` holds the chunk manifest and its `sha256` column
verifies the joined bytes. Public assets are immutable exports of that store for
fast browser loading, so playback needs neither a running database nor
credentials. The installed Turso CLI was logged out of Turso Cloud; these
records are **not synced to Turso Cloud**. `turso dev --db-file` provides
persistent local storage without sign-in.
[Turso local development](https://github.com/tursodatabase/turso-docs/blob/main/local-development.mdx),
[Turso HTTP protocol](https://github.com/tursodatabase/turso/blob/main/serverless/PROTOCOL.md).

## Binary interface

The buffer is little-endian interleaved Float32, with 12 values per record:

`samples.bin.gz` is the gzip representation of the same buffer, for smaller
network transfer. A browser can stream it through `DecompressionStream('gzip')`
before passing its resulting ArrayBuffer to WASM; `compressed_sample_file` names
it in metadata.

`metadata.json.gz` is also available, reducing transfer of the lap and interval
histories. The original raw response store contains occasional out-of-range
pedal values (104) and an invalid gear (57). The export bounds throttle/brake to
0–100 and substitutes neutral (0) for invalid gear values; quality metadata
records the anomaly counts. Recorded locations, times, speed and classifications
remain source data.

| Index | Value                | Unit               |
| ----- | -------------------- | ------------------ |
| 0     | Time from race start | seconds            |
| 1     | Normalized x         | metres, horizontal |
| 2     | Normalized y         | metres, horizontal |
| 3     | Normalized z         | metres, elevation  |
| 4     | Speed                | km/h               |
| 5     | Throttle             | source percentage  |
| 6     | Brake                | source 0 or 100    |
| 7     | Gear                 | 0–8                |
| 8     | RPM                  | revolutions/minute |
| 9     | DRS                  | source status code |
| 10    | Race position        | 1–20               |
| 11    | Current lap          | 1–71               |

Drivers occupy contiguous blocks. `drivers[].offset` is an offset in **floats**,
so the byte offset is `offset * 4`; `count` is the record count. The normalized
point is `(raw - origin) * 0.1`, preserving the source coordinate directions.
Source x and y are metres east and north. The 3D scene is y-up and right-handed,
so it maps source x to world x, source y to world −z and source z to elevation;
mapping y to +z would mirror the circuit. The track route is an actual fast
non-pit lap, in the same normalized coordinates. `metadata.json` includes the
origin, bounds, route points, driver blocks, timing events, intervals, tyre
stints, weather, pit records, race-control messages and final results.

## Venue

`public/replay/venue.json` (and its gzip twin) holds Interlagos and its
surroundings in the same replay coordinates. `scripts/venue_ingest.py` downloads
OpenStreetMap map data around the circuit through the
[OSM API](https://wiki.openstreetmap.org/wiki/API_v0.6) in nine tiles, below the
API's 50,000-node limit, and caches them in the ignored `.cache/osm/`. It chains
the circuit relation ([Wikidata Q171387](https://www.wikidata.org/wiki/Q171387))
into a lap and fits it to the reference lap with a rigid rotation and
translation, searching start point, direction and mirroring. The current fit is
6.9 m RMS with no mirroring, and the mapped lap is 4,313 m against the official
4,309 m. The script exports the named corners as distances along the lap, the
pit lane (entry first), the venue boundary, grandstands, buildings as oriented
rectangles, lakes, woods, grass, parking, streets, the karting track and mapped
trees.

```sh
python3 scripts/venue_ingest.py            # reads the cache once it exists
python3 scripts/venue_ingest.py --refresh  # refetches OpenStreetMap
```

Map data is © OpenStreetMap contributors and available under the
[Open Database License](https://www.openstreetmap.org/copyright); the exported
`venue.json` is a derivative database under the same licence.

## Source limits

OpenF1's recorded position is approximate and explicitly lacks accurate lateral
placement within the track. A stylized 3D reconstruction can show progress,
pits, retirements and timing; wheel-to-wheel distances and contact geometry
should not be interpreted as broadcast accuracy. The renderer holds short
telemetry gaps and can hide long gaps rather than inventing lap trajectories.
OpenF1 location timestamps are shared by all 20 cars and are often about 0.1 s
off, so plain interpolation makes cars surge and stall. When loading, the WASM
engine drops the few locations that sit behind or beside where a car already
was, and re-times the rest so the car covers its recorded path at its recorded
speed, matching the recorded clock on average over a few seconds. The exported
samples stay as recorded.
[OpenF1 location caveat](https://openf1.org/docs/#location).

The starting-grid endpoint returned HTTP 404 for session 9869 during import. The
export therefore derives its start ordering from the recorded pre-start position
events and labels those records accordingly. Raw primary responses remain in
Turso for inspection.
