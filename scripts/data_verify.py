#!/usr/bin/env python3
"""Audit the exported replay against coverage, binary and race invariants."""
import argparse
import base64
import gzip
import hashlib
import json
import math
import pathlib
import struct

ROOT = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--turso-url", help="Also audit persisted raw data and replay chunks against the export")
args = parser.parse_args()
metadata = json.loads((ROOT / "public/replay/metadata.json").read_text())
quality = json.loads((ROOT / "data/replay-quality.json").read_text())
binary = (ROOT / "public/replay/samples.bin").read_bytes()
assert metadata["stride"] == 12
assert len(binary) == metadata["byte_length"] == quality["byte_length"]
assert hashlib.sha256(binary).hexdigest() == quality["sha256"]
assert gzip.decompress((ROOT / "public/replay/samples.bin.gz").read_bytes()) == binary
assert gzip.decompress((ROOT / "public/replay/metadata.json.gz").read_bytes()) == (ROOT / "public/replay/metadata.json").read_bytes()
assert metadata["session"]["session_key"] == 9869, "POC should replay the latest completed Brazil race as of 2026-10-13"
assert metadata["session"]["year"] == 2025
assert metadata["total_laps"] == 71
assert len(metadata["drivers"]) == 20
assert len({d["driver_number"] for d in metadata["drivers"]}) == 20
assert metadata["quality"]["recorded_locations"] and not metadata["quality"]["synthetic_laps"]
assert 5500 < metadata["duration"] < 5700, "Entire 92 minute race and last finisher must be present"
assert 3800 < metadata["track"]["length_m"] < 4800
assert len(metadata["track"]["points"]) > 200
assert len(metadata["events"]) > 40
assert all(0 <= d["active_until"] <= metadata["duration"] for d in metadata["drivers"])
offset, count = 0, 0
for driver in metadata["drivers"]:
    assert driver["offset"] == offset, "Driver sample arrays must be contiguous"
    end = offset + driver["count"] * 12
    samples = list(struct.iter_unpack("<12f", binary[offset * 4 : end * 4]))
    assert samples and len(samples) == driver["count"]
    assert all(math.isfinite(f) for row in samples for f in row)
    assert all(a[0] < b[0] for a, b in zip(samples, samples[1:])), "Timestamps must be strictly increasing"
    assert 0 <= samples[0][0] < 1, f"{driver['name_acronym']} missing race start"
    assert samples[-1][0] >= driver["active_until"] - 1, f"{driver['name_acronym']} missing final racing position"
    assert samples[-1][0] <= metadata["duration"] + .001
    assert all(0 <= row[4] < 400 for row in samples)
    assert max(row[4] for row in samples) > 120, "Real racing telemetry must be present"
    assert all(0 <= row[5] <= 100 and 0 <= row[6] <= 100 for row in samples)
    assert all(0 <= row[7] <= 8 for row in samples)
    assert all(1 <= row[10] <= 20 for row in samples)
    assert all(1 <= row[11] <= 71 for row in samples)
    if not driver["retired"]:
        assert max(row[11] for row in samples) == driver["result"]["number_of_laps"]
        assert driver["active_until"] > 5500
    assert driver["retired"] == driver["result"]["dnf"]
    assert driver["lap_events"] and driver["position_events"] and driver["stints"]
    print(f"{driver['name_acronym']}: {len(samples):,} positions; {'retired' if driver['retired'] else 'finished'} at {driver['active_until']:.3f}s; max source gap {driver['max_location_gap']:.3f}s")
    offset = end
    count += len(samples)
assert offset * 4 == len(binary)
assert count == metadata["sample_count"]
winner = min([d for d in metadata["drivers"] if d["result"]["position"]], key=lambda d: d["result"]["position"])
assert winner["driver_number"] == 4 and winner["result"]["number_of_laps"] == 71
assert abs(winner["active_until"] - winner["result"]["duration"]) < 1
if args.turso_url:
    from data_ingest import Turso, stamp
    store = Turso(args.turso_url)
    def blob(value):
        encoded = value["base64"]
        return base64.b64decode(encoded + "=" * (-len(encoded) % 4))
    for name in ["samples.bin.gz", "metadata.json"]:
        rows = store.execute("SELECT sha256, payload FROM replay_assets WHERE session_key = ? AND name = ?", [9869, name])["rows"]
        assert len(rows) == 1
        expected_hash = rows[0][0]["value"]
        manifest = json.loads(blob(rows[0][1]))
        chunks = store.execute("SELECT payload FROM replay_asset_chunks WHERE session_key = ? AND name = ? ORDER BY part", [9869, name])["rows"]
        assert len(chunks) == manifest["chunk_count"]
        persisted = b"".join(blob(row[0]) for row in chunks)
        assert len(persisted) == manifest["byte_length"]
        assert hashlib.sha256(persisted).hexdigest() == expected_hash
        assert persisted == (ROOT / "public/replay" / name).read_bytes()
    # Check independently against stored OpenF1 locations, beyond the export's own manifest.
    start = stamp(metadata["race_start"])
    source_rows = store.execute("SELECT url, payload FROM openf1_responses WHERE url LIKE '%/location?%'")["rows"]
    assert len(source_rows) == 20
    drivers = {d["driver_number"]: d for d in metadata["drivers"]}
    for row in source_rows:
        raw = json.loads(gzip.decompress(blob(row[1])))
        num = raw[0]["driver_number"]
        driver = drivers[num]
        source = [r for r in raw if 0 <= stamp(r["date"]) - start <= metadata["duration"]]
        assert source
        # The middle source timestamp is matched by a retained source location in the binary.
        p = source[len(source) // 2]
        source_time = stamp(p["date"]) - start
        samples = struct.iter_unpack("<12f", binary[driver["offset"] * 4 : (driver["offset"] + driver["count"] * 12) * 4])
        matched = min(samples, key=lambda sample: abs(sample[0] - source_time))
        assert abs(matched[0] - source_time) < .002
        for index, coordinate in enumerate(["x", "y", "z"], 1):
            expected = (p[coordinate] - metadata["origin"][coordinate]) * .1
            assert abs(matched[index] - expected) < .002, f"{num} does not match recorded OpenF1 position"
    total = store.execute("SELECT COUNT(*) AS endpoints, SUM(record_count) AS records FROM openf1_responses")["rows"][0]
    print(f"Turso PASS: {total[0]['value']} raw endpoint responses, {total[1]['value']} source records; both exported assets match persisted chunks; 20 independent location traces match")
print(f"PASS: all 20 drivers, {count:,} recorded positions, 71 laps, {metadata['duration']:.3f}s complete race. SHA-256 {quality['sha256']}")
