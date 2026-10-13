#!/usr/bin/env python3
"""Export the Interlagos venue from OpenStreetMap, aligned to the replay's track.

Downloads OpenStreetMap map data around the circuit (cached in .cache/osm), fits
the mapped circuit onto the OpenF1 reference lap, and writes the corners, pit
lane, lake, grandstands, buildings, streets and vegetation in replay coordinates
to public/replay/venue.json and venue.json.gz. Requires only the standard
library. Map data © OpenStreetMap contributors, available under the ODbL.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import pathlib
import time
import urllib.request
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "osm"
API = "https://api.openstreetmap.org/api/0.6/map"
# Autódromo José Carlos Pace and the surrounding streets, split into tiles that
# stay under the API's 50,000-node limit.
BBOX = (-46.7105, -23.7120, -46.6890, -23.6960)
TILES = 3
CENTRE = (-23.7036, -46.6997)
CIRCUIT = "Q171387"  # Wikidata id of the circuit relation.
ROADS = {
    "primary": 14, "primary_link": 10, "secondary": 12, "tertiary": 10, "tertiary_link": 8,
    "residential": 8, "unclassified": 8, "living_street": 6, "service": 5,
}
GREEN = {"forest": "forest", "wood": "forest", "scrub": "forest", "grass": "grass", "meadow": "grass", "grassland": "grass"}


def fetch(refresh=False):
    CACHE.mkdir(parents=True, exist_ok=True)
    lon0, lat0, lon1, lat1 = BBOX
    paths = []
    for i in range(TILES):
        for j in range(TILES):
            path = CACHE / f"tile_{i}_{j}.osm"
            paths.append(path)
            if path.exists() and not refresh:
                continue
            a, b = lon0 + (lon1 - lon0) * i / TILES, lon0 + (lon1 - lon0) * (i + 1) / TILES
            c, d = lat0 + (lat1 - lat0) * j / TILES, lat0 + (lat1 - lat0) * (j + 1) / TILES
            url = f"{API}?bbox={a:.5f},{c:.5f},{b:.5f},{d:.5f}"
            req = urllib.request.Request(url, headers={"User-Agent": "formula-mii-venue/1.0"})
            with urllib.request.urlopen(req, timeout=120) as response:
                path.write_bytes(response.read())
            print("fetched", path.name)
            time.sleep(1.5)
    return paths


def parse(paths):
    nodes, ways, rels = {}, {}, {}
    for path in paths:
        root = ET.parse(path).getroot()
        for n in root.iter("node"):
            nodes[n.get("id")] = (float(n.get("lat")), float(n.get("lon")), {t.get("k"): t.get("v") for t in n.iter("tag")})
        for w in root.iter("way"):
            ways[w.get("id")] = ([nd.get("ref") for nd in w.iter("nd")], {t.get("k"): t.get("v") for t in w.iter("tag")})
        for r in root.iter("relation"):
            rels[r.get("id")] = ([(m.get("type"), m.get("ref"), m.get("role")) for m in r.iter("member")], {t.get("k"): t.get("v") for t in r.iter("tag")})
    return nodes, ways, rels


def local(lat, lon):
    r = 6378137.0
    return (math.radians(lon - CENTRE[1]) * r * math.cos(math.radians(CENTRE[0])), math.radians(lat - CENTRE[0]) * r)


def chain(segments):
    """Joins way segments end to end into one ordered line."""
    line, rest = list(segments[0]), [list(s) for s in segments[1:]]
    while rest:
        end = line[-1]
        k = min(range(len(rest)), key=lambda k: min(math.dist(end, rest[k][0]), math.dist(end, rest[k][-1])))
        s = rest.pop(k)
        if math.dist(end, s[-1]) < math.dist(end, s[0]):
            s.reverse()
        line += s[1:]
    return line


def rings(pieces):
    """Assembles multipolygon member ways into closed rings by matching ends."""
    pieces, out = [list(p) for p in pieces if len(p) > 1], []
    while pieces:
        ring = pieces.pop(0)
        while math.dist(ring[0], ring[-1]) > 0.5:
            for k, p in enumerate(pieces):
                if math.dist(ring[-1], p[0]) < 0.5:
                    ring += pieces.pop(k)[1:]
                    break
                if math.dist(ring[-1], p[-1]) < 0.5:
                    ring += pieces.pop(k)[::-1][1:]
                    break
            else:
                break
        out.append(ring)
    return out


def resample(points, n):
    loop = points + [points[0]]
    cum = [0.0]
    for a, b in zip(loop, loop[1:]):
        cum.append(cum[-1] + math.dist(a, b))
    out, j = [], 0
    for k in range(n):
        s = cum[-1] * k / n
        while cum[j + 1] < s:
            j += 1
        t = (s - cum[j]) / max(1e-9, cum[j + 1] - cum[j])
        out.append((loop[j][0] + (loop[j + 1][0] - loop[j][0]) * t, loop[j][1] + (loop[j + 1][1] - loop[j][1]) * t))
    return out


def fit(source, target, n=300):
    """Rigid fit (rotation and translation) of the mapped circuit onto the lap,
    searching start offset, direction and mirroring. Returns (rms, transform)."""
    a = resample(target, n)
    ax, ay = sum(p[0] for p in a) / n, sum(p[1] for p in a) / n
    best = None
    for mirror in (False, True):
        for direction in (1, -1):
            pts = [(-x, y) if mirror else (x, y) for x, y in source][::direction]
            b0 = resample(pts, n)
            bx, by = sum(p[0] for p in b0) / n, sum(p[1] for p in b0) / n
            for off in range(n):
                b = b0[off:] + b0[:off]
                sxx = sum((q[0] - bx) * (p[0] - ax) + (q[1] - by) * (p[1] - ay) for p, q in zip(a, b))
                sxy = sum((q[0] - bx) * (p[1] - ay) - (q[1] - by) * (p[0] - ax) for p, q in zip(a, b))
                th = math.atan2(sxy, sxx)
                c, s = math.cos(th), math.sin(th)
                err = sum((c * (q[0] - bx) - s * (q[1] - by) + ax - p[0]) ** 2 + (s * (q[0] - bx) + c * (q[1] - by) + ay - p[1]) ** 2 for p, q in zip(a, b))
                rms = math.sqrt(err / n)
                if best is None or rms < best[0]:
                    best = (rms, mirror, th, bx, by)
    rms, mirror, th, bx, by = best
    c, s = math.cos(th), math.sin(th)

    def transform(x, y):
        if mirror:
            x = -x
        return (c * (x - bx) - s * (y - by) + ax, s * (x - bx) + c * (y - by) + ay)

    return rms, mirror, transform


def simplify(points, tolerance):
    """Douglas-Peucker line simplification."""
    if len(points) < 3:
        return points
    a, b = points[0], points[-1]
    if math.dist(a, b) < 1e-6:
        # A closed ring: split it at the point farthest from the start.
        k = max(range(len(points)), key=lambda i: math.dist(a, points[i]))
        return simplify(points[: k + 1], tolerance)[:-1] + simplify(points[k:], tolerance)
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy) or 1e-9
    k, far = 0, -1.0
    for i in range(1, len(points) - 1):
        d = abs(dy * (points[i][0] - a[0]) - dx * (points[i][1] - a[1])) / length
        if d > far:
            k, far = i, d
    if far <= tolerance:
        return [a, b]
    return simplify(points[: k + 1], tolerance)[:-1] + simplify(points[k:], tolerance)


def rect(points):
    """Oriented bounding rectangle from the footprint's principal axes."""
    pts = points[:-1] if len(points) > 3 and points[0] == points[-1] else points
    mx, my = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    sxx = sum((p[0] - mx) ** 2 for p in pts)
    syy = sum((p[1] - my) ** 2 for p in pts)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
    angle = 0.5 * math.atan2(2 * sxy, sxx - syy)
    c, s = math.cos(angle), math.sin(angle)
    u = [(p[0] - mx) * c + (p[1] - my) * s for p in pts]
    v = [-(p[0] - mx) * s + (p[1] - my) * c for p in pts]
    cu, cv = (max(u) + min(u)) / 2, (max(v) + min(v)) / 2
    return [mx + cu * c - cv * s, my + cu * s + cv * c, max(u) - min(u), max(v) - min(v), angle]


def inside(point, ring):
    x, y = point
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[-1:] + ring[:-1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def area(ring):
    return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:] + ring[:1]))) / 2


def round_pts(points):
    return [[round(x, 1), round(y, 1)] for x, y in points]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Refetch OpenStreetMap instead of reading the cache")
    parser.add_argument("--radius", type=float, default=900, help="Export radius around the track centre, in metres")
    args = parser.parse_args()
    meta = json.loads((ROOT / "public/replay/metadata.json").read_text())
    lap = [(p[0], p[1]) for p in meta["track"]["points"]]
    nodes, ways, rels = parse(fetch(args.refresh))

    def way_local(wid):
        return [local(*nodes[r][:2]) for r in ways[wid][0] if r in nodes]

    circuit = next(r for r in rels.values() if r[1].get("type") == "circuit" and r[1].get("wikidata") == CIRCUIT)
    members = [ref for typ, ref, _ in circuit[0] if typ == "way" and ref in ways and ways[ref][1].get("name") != "Pit Lane"]
    rms, mirror, transform = fit(chain([way_local(w) for w in members]), lap)
    print(f"fitted mapped circuit to the reference lap: rms {rms:.2f} m, mirrored {mirror}")
    if rms > 15:
        raise SystemExit("The mapped circuit does not match the reference lap closely enough.")

    def way_xy(wid):
        return [transform(*local(*nodes[r][:2])) for r in ways[wid][0] if r in nodes]

    # Arc length along the reference lap, for placing named corners.
    cum = [0.0]
    for a, b in zip(lap, lap[1:] + lap[:1]):
        cum.append(cum[-1] + math.dist(a, b))

    def along(point):
        best = (math.inf, 0.0)
        for i, (a, b) in enumerate(zip(lap, lap[1:] + lap[:1])):
            dx, dy = b[0] - a[0], b[1] - a[1]
            t = max(0.0, min(1.0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy or 1)))
            d = math.dist(point, (a[0] + dx * t, a[1] + dy * t))
            if d < best[0]:
                best = (d, cum[i] + math.hypot(dx, dy) * t)
        return best[1]

    length = cum[-1]
    corners = {}
    for wid in members:
        name = ways[wid][1].get("name")
        if not name:
            continue
        for s in (along(p) for p in way_xy(wid)):
            corners.setdefault(name, []).append(s)
    corner_list = []
    for name, ss in corners.items():
        # Unwrap corners that straddle the timing line.
        if max(ss) - min(ss) > length / 2:
            ss = [s + length if s < length / 2 else s for s in ss]
        corner_list.append({"name": name, "from": round(min(ss) % length, 1), "to": round(max(ss) % length, 1), "at": round(((min(ss) + max(ss)) / 2) % length, 1)})
    corner_list.sort(key=lambda c: c["at"])

    pit = next(w for w in members + list(ways) if ways[w][1].get("name") == "Pit Lane" and ways[w][1].get("sport") == "motor")
    pit_lane = way_xy(pit)
    # Entry first: the entry joins the lap near its end, the exit just after the start.
    if along(pit_lane[0]) < along(pit_lane[-1]):
        pit_lane.reverse()

    venue_rel = next(r for r in rels.values() if r[1].get("wikidata") == CIRCUIT and r[1].get("type") == "multipolygon")
    venue_ring = max(rings([way_xy(ref) for typ, ref, role in venue_rel[0] if typ == "way" and role == "outer" and ref in ways]), key=area)

    out = {
        "source": "Map data © OpenStreetMap contributors, ODbL. Fitted to the OpenF1 reference lap.",
        "fit_rms_m": round(rms, 2),
        "track_length_m": round(length, 1),
        "corners": corner_list,
        "pit_lane": round_pts(simplify(pit_lane, 0.5)),
        "venue": round_pts(simplify(venue_ring, 1.0)),
        "grandstands": [],
        "buildings": [],
        "water": [],
        "forest": [],
        "grass": [],
        "paved": [],
        "roads": [],
        "karting": [],
        "trees": [],
    }
    within = lambda pts: math.hypot(sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)) < args.radius
    for wid, (refs, tags) in ways.items():
        pts = way_xy(wid)
        if len(pts) < 2 or not within(pts):
            continue
        closed = refs[0] == refs[-1] and len(pts) > 3
        if "building" in tags and closed:
            r = rect(pts)
            if tags["building"] == "grandstand":
                out["grandstands"].append([round(v, 2) if i == 4 else round(v, 1) for i, v in enumerate(r)])
            elif r[2] * r[3] > 12:
                kind = 1 if inside((r[0], r[1]), venue_ring) else 0
                out["buildings"].append([round(v, 2) if i == 4 else round(v, 1) for i, v in enumerate(r)] + [kind])
        elif tags.get("natural") == "water" and closed and tags.get("water") != "river":
            out["water"].append(round_pts(simplify(pts, 0.8)))
        elif (GREEN.get(tags.get("natural", "")) or GREEN.get(tags.get("landuse", ""))) and closed:
            out[GREEN.get(tags.get("natural", "")) or GREEN[tags["landuse"]]].append(round_pts(simplify(pts, 1.5)))
        elif tags.get("amenity") == "parking" and closed:
            out["paved"].append(round_pts(simplify(pts, 1.0)))
        elif tags.get("highway") == "raceway" and tags.get("sport") == "karting":
            out["karting"].append(round_pts(simplify(pts, 0.6)))
        elif tags.get("highway") in ROADS:
            out["roads"].append([ROADS[tags["highway"]], *round_pts(simplify(pts, 1.0))])
    for lat, lon, tags in nodes.values():
        if tags.get("natural") == "tree":
            p = transform(*local(lat, lon))
            if math.hypot(*p) < args.radius:
                out["trees"].append([round(p[0], 1), round(p[1], 1)])
    out["water"].sort(key=area, reverse=True)
    payload = json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode()
    (ROOT / "public/replay/venue.json").write_bytes(payload)
    (ROOT / "public/replay/venue.json.gz").write_bytes(gzip.compress(payload, 9, mtime=0))
    print(
        f"wrote venue.json ({len(payload) // 1024} KiB): {len(corner_list)} corners, {len(out['grandstands'])} grandstands, "
        f"{len(out['buildings'])} buildings, {len(out['roads'])} streets, {len(out['water'])} lakes, {len(out['trees'])} trees"
    )


if __name__ == "__main__":
    main()
