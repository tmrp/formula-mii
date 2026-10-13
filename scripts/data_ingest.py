#!/usr/bin/env python3
"""Export a complete OpenF1 race, retaining recorded car locations at source cadence.

Requires only Python's standard library and a running `turso dev` instance. The
Turso store caches every fetched response and the generated replay assets.
"""
from __future__ import annotations

import argparse
import base64
import bisect
import datetime as dt
import gzip
import hashlib
import json
import math
import pathlib
import struct
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
API = "https://api.openf1.org/v1"
FIELDS = ["time", "x", "y", "z", "speed", "throttle", "brake", "gear", "rpm", "drs", "position", "lap"]


def stamp(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def iso(value):
    return dt.datetime.fromtimestamp(value, dt.timezone.utc).isoformat()


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


class Turso:
    def __init__(self, url):
        self.url = url.rstrip("/") + "/v2/pipeline"
        self.execute("CREATE TABLE IF NOT EXISTS openf1_responses (url TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, sha256 TEXT NOT NULL, record_count INTEGER NOT NULL, payload BLOB NOT NULL)")
        self.execute("CREATE TABLE IF NOT EXISTS replay_assets (session_key INTEGER NOT NULL, name TEXT NOT NULL, sha256 TEXT NOT NULL, payload BLOB NOT NULL, PRIMARY KEY(session_key, name))")
        self.execute("CREATE TABLE IF NOT EXISTS replay_asset_chunks (session_key INTEGER NOT NULL, name TEXT NOT NULL, part INTEGER NOT NULL, payload BLOB NOT NULL, PRIMARY KEY(session_key, name, part))")

    def execute(self, sql, args=()):
        def arg(v):
            if isinstance(v, bytes):
                return {"type": "blob", "base64": base64.b64encode(v).decode()}
            if isinstance(v, int):
                return {"type": "integer", "value": str(v)}
            return {"type": "text", "value": str(v)}
        req = urllib.request.Request(self.url, data=encode({"requests": [{"type": "execute", "stmt": {"sql": sql, "args": [arg(v) for v in args]}}, {"type": "close"}]}), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=90) as response:
            body = json.load(response)
        result = body["results"][0]
        if result["type"] != "ok":
            raise RuntimeError("Turso: " + str(result))
        return result["response"]["result"]

    def get(self, url):
        rows = self.execute("SELECT payload FROM openf1_responses WHERE url = ?", [url])["rows"]
        if not rows:
            return None
        value = rows[0][0]["base64"]
        return json.loads(gzip.decompress(base64.b64decode(value + "=" * (-len(value) % 4))))

    def put(self, url, records):
        payload = encode(records)
        self.execute("INSERT OR REPLACE INTO openf1_responses VALUES (?, ?, ?, ?, ?)", [url, iso(time.time()), hashlib.sha256(payload).hexdigest(), len(records), gzip.compress(payload, mtime=0)])

    def asset(self, session, name, payload):
        # The HTTP API caps individual SQL bindings; keep assets in bounded parts.
        chunk_size = 512 * 1024
        self.execute("DELETE FROM replay_asset_chunks WHERE session_key = ? AND name = ?", [session, name])
        for part, offset in enumerate(range(0, len(payload), chunk_size)):
            self.execute("INSERT INTO replay_asset_chunks VALUES (?, ?, ?, ?)", [session, name, part, payload[offset:offset + chunk_size]])
        manifest = encode({"chunk_size": chunk_size, "chunk_count": math.ceil(len(payload) / chunk_size), "byte_length": len(payload)})
        self.execute("INSERT OR REPLACE INTO replay_assets VALUES (?, ?, ?, ?)", [session, name, hashlib.sha256(payload).hexdigest(), manifest])


class OpenF1:
    def __init__(self, turso, refresh=False):
        self.turso = turso
        self.refresh = refresh
        self.last_request = 0

    def get(self, endpoint, **params):
        url = f"{API}/{endpoint}?" + urllib.parse.urlencode(sorted(params.items()))
        if not self.refresh:
            cached = self.turso.get(url)
            if cached is not None:
                print(f"cached {endpoint}: {len(cached):,}", flush=True)
                return cached
        for attempt in range(5):
            time.sleep(max(0, 2.1 - (time.monotonic() - self.last_request)))
            self.last_request = time.monotonic()
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Formula-Mii-POC/1.0", "Accept-Encoding": "gzip"})
                with urllib.request.urlopen(req, timeout=180) as response:
                    payload = response.read()
                    if response.headers.get("Content-Encoding") == "gzip":
                        payload = gzip.decompress(payload)
                    records = json.loads(payload)
                if not isinstance(records, list):
                    raise RuntimeError(f"{endpoint} returned a non-list response")
                self.turso.put(url, records)
                print(f"fetched {endpoint} {params.get('driver_number', '')}: {len(records):,}", flush=True)
                return records
            except (urllib.error.URLError, TimeoutError) as error:
                if isinstance(error, urllib.error.HTTPError) and error.code in [400, 401, 403, 404]:
                    raise
                if attempt == 4:
                    raise
                delay = max(5 * (attempt + 1), int(error.headers.get("Retry-After", "0")) if isinstance(error, urllib.error.HTTPError) else 0)
                print(f"retry {endpoint} in {delay}s: {error}", flush=True)
                time.sleep(delay)
        raise AssertionError("unreachable")


def timeline(records, start, field="date"):
    return sorted([dict(r, time=round(stamp(r[field]) - start, 3)) for r in records if r.get(field)], key=lambda r: r["time"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--turso-url", default="http://127.0.0.1:8097")
    parser.add_argument("--session", type=int, help="Default: latest completed Brazilian Grand Prix")
    parser.add_argument("--as-of", default=dt.datetime.now(dt.timezone.utc).date().isoformat())
    parser.add_argument("--refresh", action="store_true", help="Refetch OpenF1 instead of reading Turso cache")
    args = parser.parse_args()
    store = Turso(args.turso_url)
    api = OpenF1(store, args.refresh)
    sessions = api.get("sessions", country_name="Brazil", session_name="Race")
    cutoff = stamp(args.as_of + "T23:59:59+00:00")
    completed = [s for s in sessions if stamp(s["date_end"]) < cutoff and not s.get("is_cancelled")]
    session = next(s for s in sessions if s["session_key"] == args.session) if args.session else max(completed, key=lambda s: s["date_start"])
    key = session["session_key"]
    print(f"Exporting session {key}: {session['date_start']}", flush=True)
    metadata = {e: api.get(e, session_key=key) for e in ["drivers", "laps", "position", "intervals", "race_control", "stints", "pit", "session_result", "weather"]}
    try:
        metadata["starting_grid"] = api.get("starting_grid", session_key=key)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        print("Starting grid endpoint unavailable; using recorded pre-race positions", flush=True)
        metadata["starting_grid"] = []
    meeting = api.get("meetings", meeting_key=session["meeting_key"])[0]
    laps = metadata["laps"]
    race_start = min(stamp(l["date_start"]) for l in laps if l.get("date_start") and l["lap_number"] == 1)
    results = {r["driver_number"]: r for r in metadata["session_result"]}
    # Use actual final lap timing, which includes lapped finishers, instead of the scheduled session end.
    classified = [l for l in laps if not results[l["driver_number"]].get("dnf") and l.get("lap_duration") and l.get("date_start")]
    race_end = max(stamp(l["date_start"]) + l["lap_duration"] for l in classified)
    duration = round(race_end - race_start, 3)
    filters = {"date>": iso(race_start - 2), "date<": iso(race_end + 2)}
    if not metadata["starting_grid"]:
        for driver in metadata["drivers"]:
            positions = [p for p in metadata["position"] if p["driver_number"] == driver["driver_number"] and stamp(p["date"]) <= race_start]
            if positions:
                prior = max(positions, key=lambda p: p["date"])
                metadata["starting_grid"].append({"driver_number": driver["driver_number"], "position": prior["position"], "source": "Recorded pre-race OpenF1 position"})
    locations, cars = {}, {}
    for driver in metadata["drivers"]:
        num = driver["driver_number"]
        locations[num] = timeline(api.get("location", session_key=key, driver_number=num, **filters), race_start)
        cars[num] = timeline(api.get("car_data", session_key=key, driver_number=num, **filters), race_start)
        if not locations[num] or not cars[num]:
            raise RuntimeError(f"Missing race telemetry for driver {num}")
    # Pick a fast non-pit lap and retain its actual GPS trace as circuit geometry.
    clean = sorted([l for l in classified if l["lap_number"] > 2 and not l.get("is_pit_out_lap") and l.get("lap_duration")], key=lambda l: l["lap_duration"])
    route_lap, route = None, []
    for candidate in clean:
        a = stamp(candidate["date_start"]) - race_start
        b = a + candidate["lap_duration"]
        route = [p for p in locations[candidate["driver_number"]] if a <= p["time"] <= b and any(p[c] != 0 for c in ["x", "y", "z"])]
        if len(route) > 150:
            route_lap = candidate
            break
    if route_lap is None:
        raise RuntimeError("No complete clean lap location trace available")
    origin = {c: (max(p[c] for p in route) + min(p[c] for p in route)) / 2 for c in ["x", "y", "z"]}
    def xyz(p):
        return [round((p[c] - origin[c]) * .1, 3) for c in ["x", "y", "z"]]
    route_points = [xyz(p) for p in route]
    route_length = sum(math.dist(p, q) for p, q in zip(route_points, route_points[1:] + route_points[:1]))
    output = bytearray()
    drivers, gaps = [], []
    corrections = {"throttle_out_of_range": 0, "brake_out_of_range": 0, "gear_out_of_range": 0}
    all_points = []
    for driver in metadata["drivers"]:
        num = driver["driver_number"]
        own_laps = timeline([l for l in laps if l["driver_number"] == num], race_start, "date_start")
        for lap in own_laps:
            lap["end_time"] = round(lap["time"] + lap["lap_duration"], 3) if lap.get("lap_duration") else None
        own_pos = timeline([p for p in metadata["position"] if p["driver_number"] == num], race_start)
        own_intervals = [{k: p[k] for k in ["time", "gap_to_leader", "interval"]} for p in timeline([p for p in metadata["intervals"] if p["driver_number"] == num], race_start)]
        car = cars[num]
        anomalies = {
            "throttle_out_of_range": sum(not 0 <= p.get("throttle", 0) <= 100 for p in car),
            "brake_out_of_range": sum(not 0 <= p.get("brake", 0) <= 100 for p in car),
            "gear_out_of_range": sum(not 0 <= p.get("n_gear", 0) <= 8 for p in car),
        }
        for field, value in anomalies.items():
            corrections[field] += value
        car_times = [r["time"] for r in car]
        lap_times = [r["time"] for r in own_laps]
        pos_times = [r["time"] for r in own_pos]
        loc = [p for p in locations[num] if any(p[c] != 0 for c in ["x", "y", "z"])]
        result = results[num]
        if not result.get("dnf"):
            last_lap = max([l for l in own_laps if l.get("lap_duration")], key=lambda l: l["lap_number"])
            active_until = min(duration, last_lap["time"] + last_lap["lap_duration"])
        else:
            # Retired drivers may continue publishing stationary garage telemetry. Stop at their final movement.
            moving = [p["time"] for p in car if p.get("speed", 0) >= 25]
            active_until = min(duration, max(moving) if moving else loc[-1]["time"])
        loc = [p for p in loc if -1 <= p["time"] <= duration]
        offset = len(output) // 4
        max_gap = 0
        telem_max_distance = 0
        for i, p in enumerate(loc):
            t = p["time"]
            j = min(len(car) - 1, bisect.bisect_left(car_times, t))
            if j > 0 and abs(car_times[j - 1] - t) < abs(car_times[j] - t):
                j -= 1
            telem = car[j]
            telem_max_distance = max(telem_max_distance, abs(telem["time"] - t))
            pi = max(0, bisect.bisect_right(pos_times, t) - 1)
            li = max(0, bisect.bisect_right(lap_times, t) - 1)
            point = xyz(p)
            all_points.append(point)
            gear = telem.get("n_gear", 0)
            fields = [max(0, t), *point, telem.get("speed", 0), max(0, min(100, telem.get("throttle", 0))), max(0, min(100, telem.get("brake", 0))), gear if 0 <= gear <= 8 else 0, telem.get("rpm", 0), telem.get("drs", 0), own_pos[pi]["position"] if own_pos else (result["position"] or 20), own_laps[li]["lap_number"]]
            # Multiple pre-start records would clamp to the same time; retain only the final one.
            if t < 0 and i < len(loc) - 1 and loc[i + 1]["time"] < 0:
                continue
            output.extend(struct.pack("<12f", *fields))
            if i:
                gap = t - loc[i - 1]["time"]
                max_gap = max(max_gap, gap)
                if gap > 2:
                    gaps.append({"driver_number": num, "from": loc[i - 1]["time"], "to": t, "seconds": round(gap, 3)})
        count = (len(output) // 4 - offset) // 12
        drivers.append(dict(driver, offset=offset, count=count, start=max(0, loc[0]["time"]), end=loc[-1]["time"], active_until=round(active_until, 3), retired=bool(result.get("dnf")), result=result, lap_events=own_laps, position_events=own_pos, intervals=own_intervals, stints=[s for s in metadata["stints"] if s["driver_number"] == num], max_location_gap=round(max_gap, 3), max_telemetry_time_distance=round(telem_max_distance, 3), source_telemetry_anomalies=anomalies))
        print(f"packed {driver['name_acronym']}: {count:,} samples, active until {active_until:.3f}s, max gap {max_gap:.3f}s", flush=True)
    bounds = {c: [round(min(p[i] for p in all_points), 2), round(max(p[i] for p in all_points), 2)] for i, c in enumerate(["x", "y", "z"])}
    compressed = gzip.compress(bytes(output), compresslevel=9, mtime=0)
    payload = {"version": 1, "title": f"São Paulo Grand Prix {session['year']}", "session": session, "meeting": meeting, "source": {"name": "OpenF1", "url": "https://openf1.org", "repository": "https://github.com/br-g/openf1", "api": API, "exported_at": iso(time.time()), "as_of": args.as_of, "storage": "Local Turso development database"}, "race_start": iso(race_start), "duration": duration, "total_laps": max(r["number_of_laps"] for r in results.values()), "stride": 12, "fields": FIELDS, "sample_file": "samples.bin", "compressed_sample_file": "samples.bin.gz", "compressed_byte_length": len(compressed), "byte_length": len(output), "sample_count": len(output) // 48, "coordinate_scale": .1, "coordinate_system": "Normalized metres. x and y horizontal, z elevation. World maps x to x, y to z, z to y.", "origin": origin, "bounds": bounds, "track": {"driver_number": route_lap["driver_number"], "lap_number": route_lap["lap_number"], "lap_duration": route_lap["lap_duration"], "points": route_points, "length_m": round(route_length, 3)}, "drivers": drivers, "events": timeline(metadata["race_control"], race_start), "pit": timeline(metadata["pit"], race_start), "weather": timeline(metadata["weather"], race_start), "starting_grid": metadata["starting_grid"], "quality": {"location_cadence_hz": 3.7, "recorded_locations": True, "telemetry_matching": "nearest recorded sample", "synthetic_laps": False, "gaps_over_two_seconds": gaps, "location_caveat": "OpenF1 location is approximate and does not represent detailed lateral placement."}}
    out = ROOT / "public" / "replay"
    out.mkdir(parents=True, exist_ok=True)
    payload["quality"]["source_telemetry_anomalies"] = corrections
    payload["quality"]["telemetry_corrections"] = "Pedals clamped to 0–100; invalid gear values replaced with 0. Raw source unchanged in Turso."
    metadata_bytes = encode(payload)
    (out / "samples.bin").write_bytes(output)
    (out / "samples.bin.gz").write_bytes(compressed)
    (out / "metadata.json").write_bytes(metadata_bytes)
    (out / "metadata.json.gz").write_bytes(gzip.compress(metadata_bytes, mtime=0))
    # Persist the immutable export in Turso as well as its public static copies.
    store.asset(key, "samples.bin.gz", compressed)
    store.asset(key, "metadata.json", metadata_bytes)
    report = {"session_key": key, "race_start": iso(race_start), "duration": duration, "driver_count": len(drivers), "sample_count": len(output) // 48, "byte_length": len(output), "sha256": hashlib.sha256(output).hexdigest(), "metadata_sha256": hashlib.sha256(metadata_bytes).hexdigest(), "track_length_m": round(route_length, 3), "location_gaps": gaps, "drivers": [{k: d[k] for k in ["driver_number", "name_acronym", "count", "start", "end", "active_until", "max_location_gap", "max_telemetry_time_distance"]} for d in drivers]}
    (ROOT / "data" / "replay-quality.json").write_bytes(encode(report))
    print(f"Export complete: {len(drivers)} drivers, {len(output) // 48:,} recorded samples, {duration:.3f}s, {len(output):,} bytes", flush=True)


if __name__ == "__main__":
    main()
