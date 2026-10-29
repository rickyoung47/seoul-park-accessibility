"""Build a display-ready OSMnx walk network for the Seoul dong boundary."""

import json
import math
from pathlib import Path
from datetime import datetime, timezone

import geopandas as gpd
import osmnx as ox
from shapely import make_valid, unary_union
from shapely.geometry import mapping


ROOT = Path(__file__).parent
ASSETS = ROOT / "assets"
METRIC_CRS = "EPSG:5179"
MAX_SHARD_BYTES = 12_000_000


def main():
    dongs = gpd.read_file(ASSETS / "dongs.geojson")
    dongs_metric = dongs.to_crs(METRIC_CRS)
    boundary_metric = dongs_metric.geometry.union_all()
    boundary_wgs84 = gpd.GeoSeries([boundary_metric], crs=METRIC_CRS).to_crs("EPSG:4326").iloc[0]
    # Reprojection can collapse tiny sliver components in the source boundary.
    repaired = make_valid(boundary_wgs84)
    polygons = [part for part in getattr(repaired, "geoms", [repaired]) if part.geom_type == "Polygon"]
    boundary_wgs84 = unary_union(polygons)

    # The full Seoul Overpass response is large; avoid a second local copy.
    ox.settings.use_cache = False
    ox.settings.log_console = True
    graph = ox.graph_from_polygon(boundary_wgs84, network_type="walk", simplify=True)
    graph = ox.project_graph(graph, to_crs=METRIC_CRS)
    graph = ox.convert.to_undirected(graph)
    _, edges = ox.graph_to_gdfs(graph)
    # Simplify while the geometry is still in meters (not degrees).
    edges.geometry = edges.geometry.simplify(1.2, preserve_topology=False)
    edges = edges.to_crs("EPSG:4326")

    # This is a visual layer: modest simplification keeps static map downloads small.
    features = []
    keep = ("highway", "footway", "name", "access", "bridge", "tunnel")
    for edge_id, row in edges.iterrows():
        geom = row.geometry
        if geom.is_empty:
            continue
        props = {}
        for key in keep:
            value = row.get(key)
            if value is None:
                continue
            try:
                if math.isnan(value):
                    continue
            except (TypeError, ValueError):
                pass
            if hasattr(value, "item"):
                value = value.item()
            if isinstance(value, (str, int, float, bool)):
                props[key] = value
            elif isinstance(value, (list, tuple)):
                props[key] = ", ".join(str(part) for part in value)
        features.append({"type": "Feature", "id": str(edge_id), "properties": props, "geometry": mapping(geom)})

    paths = []
    shard = []
    shard_bytes = 0
    for feature in features:
        encoded = json.dumps(feature, ensure_ascii=False, separators=(",", ":"))
        extra = len(encoded.encode("utf-8")) + (1 if shard else 0)
        if shard and shard_bytes + extra > MAX_SHARD_BYTES:
            paths.append(write_shard(len(paths), shard))
            shard, shard_bytes = [], 0
        shard.append(encoded)
        shard_bytes += extra
    if shard:
        paths.append(write_shard(len(paths), shard))

    manifest = {
        "source": "OpenStreetMap contributors",
        "license": "ODbL",
        "network_type": "walk",
        "metric_crs": METRIC_CRS,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "edge_count": len(features),
        "files": paths,
    }
    (ASSETS / "walk-network-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    for old in ASSETS.glob("walk-network-*.geojson"):
        if old.name not in paths:
            old.unlink()
    print(f"Wrote {len(features):,} edges in {len(paths)} GeoJSON shards")


def write_shard(index, encoded_features):
    filename = f"walk-network-{index:03}.geojson"
    content = '{"type":"FeatureCollection","features":[' + ",".join(encoded_features) + "]}"
    (ASSETS / filename).write_text(content)
    return filename


if __name__ == "__main__":
    main()
