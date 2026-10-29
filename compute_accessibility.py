"""Prepare green-area and dong-level park-accessibility layers.

Source files are read from the sibling lecture05_Urban_Planning_Index folder.
The web app only receives the clipped green polygons and aggregated dong metrics.
"""

import csv
import ast
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import networkx as nx
import shapefile
from pyproj import Transformer
from shapely import make_valid
from shapely.geometry import Point, shape, mapping
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree


ROOT = Path(__file__).parent
ASSETS = ROOT / "assets"
SOURCE = ROOT.parent / "lecture05_Urban_Planning_Index"
METRIC_CRS = "EPSG:5179"
SPEED_M_PER_MIN = 4000 / 60
THRESHOLD_MIN = 10

TO_METRIC = Transformer.from_crs("EPSG:4326", METRIC_CRS, always_xy=True).transform
GREEN_TO_METRIC = Transformer.from_crs("EPSG:5174", METRIC_CRS, always_xy=True).transform
TO_WGS84 = Transformer.from_crs(METRIC_CRS, "EPSG:4326", always_xy=True).transform


def polygons_only(geom):
    geom = make_valid(geom)
    if geom.geom_type == "Polygon":
        return [geom]
    if geom.geom_type == "MultiPolygon":
        return list(geom.geoms)
    if hasattr(geom, "geoms"):
        return [part for item in geom.geoms for part in polygons_only(item)]
    return []


def read_city_dongs():
    path = SOURCE / "shp" / "bnd_dong_seoul.shp"
    reader = shapefile.Reader(str(path), encoding="utf-8")
    fields = [field[0] for field in reader.fields[1:]]
    dongs = []
    features = []
    for record, shp in zip(reader.records(), reader.shapes()):
        props = dict(zip(fields, record))
        geometry = shape(shp.__geo_interface__)
        dongs.append({
            "code": str(props["ADM_CD"]),
            "name": str(props["ADM_NM"]),
            "geometry": geometry,
        })
        features.append({
            "type": "Feature",
            "properties": {"ADM_CD": str(props["ADM_CD"]), "ADM_NM": str(props["ADM_NM"])},
            "geometry": mapping(transform(TO_WGS84, geometry)),
        })
    (ASSETS / "dongs.geojson").write_text(json.dumps({
        "type": "FeatureCollection", "features": features,
    }, ensure_ascii=False, separators=(",", ":")))
    return dongs


def write_seoul_outline(city_union):
    outline = transform(TO_WGS84, city_union)
    (ASSETS / "seoul-outline.geojson").write_text(json.dumps({
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "properties": {}, "geometry": mapping(outline)}],
    }, ensure_ascii=False, separators=(",", ":")))


def write_green_areas(city_union):
    path = SOURCE / "shp" / "569_UQ111_용도지역(도시지역)_202609" / "UPIS_C_UQ111.shp"
    reader = shapefile.Reader(str(path), encoding="cp949")
    fields = [field[0] for field in reader.fields[1:]]
    name_index = fields.index("DGM_NM")
    features = []
    for record, shp in zip(reader.records(), reader.shapes()):
        name = str(record[name_index] or "")
        if "녹지" not in name:
            continue
        geom = transform(GREEN_TO_METRIC, shape(shp.__geo_interface__))
        if not geom.intersects(city_union):
            continue
        clipped = geom.intersection(city_union)
        for polygon in polygons_only(clipped):
            features.append({
                "type": "Feature",
                "properties": {"zone_name": name},
                "geometry": mapping(transform(TO_WGS84, polygon)),
            })
    collection = {"type": "FeatureCollection", "features": features}
    (ASSETS / "green-areas.geojson").write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")))
    return len(features)


def read_destination_zones():
    destination_geometries = []
    green_areas = json.loads((ASSETS / "green-areas.geojson").read_text())
    for feature in green_areas["features"]:
        geom = make_valid(shape(feature["geometry"]))
        if geom.is_empty:
            continue
        destination_geometries.append(transform(TO_METRIC, geom))
    if not destination_geometries:
        raise RuntimeError("The land-use shapefile did not contain any green-area polygons.")
    return destination_geometries, len(destination_geometries)


def read_population():
    path = SOURCE / "grid" / "2024년_인구_다사_100M.csv"
    populations = {}
    with path.open(encoding="cp949", newline="") as source:
        for row in csv.reader(source):
            if len(row) < 4 or row[2].strip() != "to_in_001":
                continue
            try:
                populations[row[1].strip()] = float(row[3].replace(",", ""))
            except ValueError:
                populations[row[1].strip()] = 0.0
    return populations


def build_walk_graph(node_points):
    graph = nx.MultiGraph()
    for filename in sorted(ASSETS.glob("walk-network-*.geojson")):
        if filename.name == "walk-network-manifest.json":
            continue
        raw = json.loads(filename.read_text().replace("NaN", "null"))
        for feature in raw["features"]:
            edge_id = feature["id"]
            if isinstance(edge_id, str):
                edge_id = ast.literal_eval(edge_id)
            u, v, key = edge_id
            coords = feature["geometry"]["coordinates"]
            xs, ys = zip(*coords)
            mx, my = TO_METRIC(xs, ys)
            points = list(zip(mx, my))
            node_points.setdefault(u, Point(*points[0]))
            node_points.setdefault(v, Point(*points[-1]))
            length = sum(math.hypot(bx - ax, by - ay) for (ax, ay), (bx, by) in zip(points, points[1:]))
            graph.add_edge(u, v, key=key, length=max(length, 0.01))
    return graph


def get_park_targets(park_geometries, node_ids, node_points):
    tree = STRtree(node_points)
    target_offsets = {}
    for park in park_geometries:
        if park.geom_type in ("Polygon", "MultiPolygon"):
            candidates = tree.query(park, predicate="contains")
            if len(candidates):
                for index in candidates:
                    target_offsets[node_ids[int(index)]] = 0.0
                continue
        indexes, distances = tree.query_nearest(park, return_distance=True)
        for index, distance in zip(indexes, distances):
            node_id = node_ids[int(index)]
            target_offsets[node_id] = min(target_offsets.get(node_id, math.inf), float(distance))
    return target_offsets


def rank_values(values, descending=False):
    valid = [value for value in values if value is not None]
    if descending:
        return {value: 1 + sum(1 for other in valid if other > value) for value in set(valid)}
    return {value: 1 + sum(1 for other in valid if other < value) for value in set(valid)}


def main():
    dongs = read_city_dongs()
    city_union = unary_union([dong["geometry"] for dong in dongs])
    write_seoul_outline(city_union)
    green_count = write_green_areas(city_union)
    destination_geometries, destination_count = read_destination_zones()

    node_points_by_id = {}
    graph = build_walk_graph(node_points_by_id)
    node_ids = list(node_points_by_id)
    node_points = [node_points_by_id[node] for node in node_ids]
    node_tree = STRtree(node_points)
    target_offsets = get_park_targets(destination_geometries, node_ids, node_points)
    source = ("__nearest_green_destination_source__",)
    graph.add_node(source)
    for node, offset in target_offsets.items():
        graph.add_edge(source, node, length=offset)
    network_distance = nx.single_source_dijkstra_path_length(graph, source, weight="length")

    dongs_tree = STRtree([dong["geometry"] for dong in dongs])
    totals = {dong["code"]: {"total_population": 0.0, "accessible_population": 0.0,
                              "population_x_walk_min": 0.0, "population_within_10min": 0.0}
              for dong in dongs}
    populations = read_population()
    grid_path = SOURCE / "grid" / "seoul_100m_grid_2025.geojson"
    grid = json.loads(grid_path.read_text())
    matched_grid_count = 0
    for feature in grid["features"]:
        grid_code = str(feature["properties"].get("GRID_CD", ""))
        matched_grid_count += grid_code in populations
        population = populations.get(grid_code, 0.0)
        if population < 0:
            population = 0.0
        polygon = transform(TO_METRIC, shape(feature["geometry"]))
        centroid = polygon.centroid
        matches = dongs_tree.query(centroid, predicate="within")
        if not len(matches):
            continue
        dong = dongs[int(matches[0])]
        point_index = int(node_tree.nearest(centroid))
        node = node_ids[point_index]
        graph_m = network_distance.get(node)
        bucket = totals[dong["code"]]
        bucket["total_population"] += population
        if graph_m is None:
            continue
        walk_min = (graph_m + centroid.distance(node_points[point_index])) / SPEED_M_PER_MIN
        bucket["accessible_population"] += population
        bucket["population_x_walk_min"] += population * walk_min
        if walk_min <= THRESHOLD_MIN:
            bucket["population_within_10min"] += population

    rows = []
    for dong in dongs:
        values = totals[dong["code"]]
        accessible = values["accessible_population"]
        total = values["total_population"]
        average = values["population_x_walk_min"] / accessible if accessible > 0 else None
        within_pct = values["population_within_10min"] / total * 100 if total > 0 else None
        rows.append({
            "ADM_CD": dong["code"], "ADM_NM": dong["name"],
            "total_population": round(total, 2), "accessible_population": round(accessible, 2),
            "population_weighted_walk_min": round(average, 3) if average is not None else None,
            "population_within_10min_pct": round(within_pct, 3) if within_pct is not None else None,
        })
    avg_rank = rank_values([row["population_weighted_walk_min"] for row in rows])
    pct_rank = rank_values([row["population_within_10min_pct"] for row in rows], descending=True)
    for row in rows:
        row["rank_walk_min"] = avg_rank.get(row["population_weighted_walk_min"])
        row["rank_within_10min"] = pct_rank.get(row["population_within_10min_pct"])

    result = {
        "metadata": {
            "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "population_source": "2024년 인구 다사 100m · to_in_001",
            "walk_network": "OSMnx walk graph · EPSG:5179",
            "destination_source": "UPIS_C_UQ111.shp · DGM_NM에 '녹지' 포함 (공원 접근성 대리 지표)",
            "walk_speed_kmh": 4.0,
            "threshold_min": THRESHOLD_MIN,
            "destinations_used": destination_count,
            "green_features": green_count,
            "dong_count": len(rows),
            "grid_count": len(grid["features"]),
            "population_matched_grids": matched_grid_count,
        },
        "rows": rows,
    }
    (ASSETS / "dong-accessibility.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"Wrote {green_count:,} green-area destination features and accessibility scores for {len(rows)} dongs")


if __name__ == "__main__":
    main()
