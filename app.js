const map = L.map('map', { zoomControl: false, preferCanvas: true, maxBoundsViscosity: 1 }).setView([37.5665, 126.978], 11);
L.control.zoom({ position: 'bottomright' }).addTo(map);
map.createPane('outsideMask');
map.getPane('outsideMask').style.zIndex = 450;
map.createPane('dongPane');
map.getPane('dongPane').style.zIndex = 460;
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
}).addTo(map);

const status = document.getElementById('status');
const formatNumber = (value) => Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 0 });
let layers = {};
let selectedLayer = null;
let accessibility = new Map();
let dongsLayer;

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`지도 데이터를 불러오지 못했습니다: ${path}`);
  return response.json();
}

function cityMask(outline, bounds) {
  const world = [
    [bounds.getSouth() - 0.5, bounds.getWest() - 0.5],
    [bounds.getSouth() - 0.5, bounds.getEast() + 0.5],
    [bounds.getNorth() + 0.5, bounds.getEast() + 0.5],
    [bounds.getNorth() + 0.5, bounds.getWest() - 0.5],
    [bounds.getSouth() - 0.5, bounds.getWest() - 0.5],
  ];
  const geometry = outline.features[0].geometry;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const holes = polygons.map((rings) => rings[0].map(([lng, lat]) => [lat, lng]));
  return L.polygon([world, ...holes], {
    pane: 'outsideMask', stroke: false, fillColor: '#edf0e9', fillOpacity: 1, interactive: false,
  }).addTo(map);
}

function updateSelectedDong(properties) {
  const metrics = accessibility.get(String(properties.ADM_CD));
  if (!metrics) return;
  document.getElementById('selection').classList.remove('empty');
  document.getElementById('dong-name').textContent = properties.ADM_NM || metrics.ADM_NM;
  document.getElementById('dong-code').textContent = `행정동 코드 ${properties.ADM_CD}`;
  document.getElementById('avg-min').textContent = metrics.population_weighted_walk_min == null ? '—' : metrics.population_weighted_walk_min.toFixed(1);
  document.getElementById('within-pct').textContent = metrics.population_within_10min_pct == null ? '—' : metrics.population_within_10min_pct.toFixed(1);
  document.getElementById('avg-rank').textContent = metrics.rank_walk_min == null ? '순위 없음' : `서울 ${metrics.rank_walk_min}위 / ${accessibility.size}개 동`;
  document.getElementById('within-rank').textContent = metrics.rank_within_10min == null ? '순위 없음' : `서울 ${metrics.rank_within_10min}위 / ${accessibility.size}개 동`;
  document.getElementById('population').textContent = `${formatNumber(metrics.total_population)}명`;
  if (selectedLayer) selectedLayer.setStyle({ color: '#70856a', weight: 0.55, fillColor: '#b5c5ab', fillOpacity: 0.08 });
  selectedLayer = dongsLayer.getLayers().find((layer) => String(layer.feature?.properties?.ADM_CD) === String(properties.ADM_CD));
  if (selectedLayer) selectedLayer.setStyle({ color: '#264d36', weight: 2.2, fillColor: '#9fc17f', fillOpacity: 0.3 });
}

function renderRankingChart(containerId, rows, metricKey, rankKey, ascending, unit, decimals) {
  const container = document.getElementById(containerId);
  const sorted = rows
    .filter((row) => row[metricKey] != null && Number.isFinite(Number(row[metricKey])))
    .sort((a, b) => (ascending ? 1 : -1) * (Number(a[metricKey]) - Number(b[metricKey])) || a.ADM_NM.localeCompare(b.ADM_NM, 'ko'))
    .slice(0, 10);
  const values = sorted.map((row) => Number(row[metricKey]));
  const low = Math.min(...values);
  const high = Math.max(...values);

  for (const row of sorted) {
    const value = Number(row[metricKey]);
    const relative = high === low ? 100 : 28 + 72 * (ascending ? (high - value) / (high - low) : (value - low) / (high - low));
    const item = document.createElement('div');
    item.className = 'ranking-row';

    const rank = document.createElement('span');
    rank.className = 'ranking-number';
    rank.textContent = `${row[rankKey]}위`;

    const name = document.createElement('span');
    name.className = 'ranking-name';
    name.textContent = row.ADM_NM;
    name.title = row.ADM_NM;

    const track = document.createElement('span');
    track.className = 'ranking-track';
    track.setAttribute('aria-hidden', 'true');
    const bar = document.createElement('span');
    bar.className = 'ranking-bar';
    bar.style.width = `${relative}%`;
    track.append(bar);

    const result = document.createElement('span');
    result.className = 'ranking-value';
    result.textContent = `${value.toFixed(decimals)}${unit}`;

    item.setAttribute('aria-label', `${row[rankKey]}위 ${row.ADM_NM}, ${result.textContent}`);
    item.append(rank, name, track, result);
    container.append(item);
  }
}

async function loadWalkNetwork(manifest) {
  if (layers.walk) return layers.walk;
  status.textContent = '보행 네트워크를 불러오는 중…';
  const shards = await Promise.all(manifest.files.map((path) => fetchJson(`./assets/${path}`)));
  const lines = [];
  for (const shard of shards) {
    for (const feature of shard.features) {
      const geometry = feature.geometry;
      if (geometry.type === 'LineString') lines.push(geometry.coordinates);
      if (geometry.type === 'MultiLineString') lines.push(...geometry.coordinates);
    }
  }
  const network = { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } };
  layers.walk = L.geoJSON(network, { style: { color: '#6b7770', weight: 0.45, opacity: 0.44 } });
  if (document.getElementById('walk-toggle').checked) layers.walk.addTo(map);
  return layers.walk;
}

Promise.all([
  fetchJson('./assets/dongs.geojson'),
  fetchJson('./assets/seoul-outline.geojson'),
  fetchJson('./assets/green-areas.geojson'),
  fetchJson('./assets/dong-accessibility.json'),
  fetchJson('./assets/walk-network-manifest.json'),
]).then(async ([dongs, outline, greens, scoreData, networkManifest]) => {
  accessibility = new Map(scoreData.rows.map((row) => [String(row.ADM_CD), row]));
  renderRankingChart('walk-ranking', scoreData.rows, 'population_weighted_walk_min', 'rank_walk_min', true, '분', 1);
  renderRankingChart('rate-ranking', scoreData.rows, 'population_within_10min_pct', 'rank_within_10min', false, '%', 1);
  dongsLayer = L.geoJSON(dongs, {
    pane: 'dongPane',
    interactive: true,
    bubblingMouseEvents: false,
    style: { color: '#70856a', weight: 0.55, fillColor: '#dce5d4', fillOpacity: 0.08 },
    onEachFeature(feature, layer) {
      const props = feature.properties || {};
      const name = props.ADM_NM || '이름 정보 없음';
      layer.bindTooltip(name, { sticky: true, className: 'dong-tooltip' });
      layer.on('click', () => updateSelectedDong(props));
      layer.on('mouseover', () => { if (layer !== selectedLayer) layer.setStyle({ color: '#46664c', weight: 1.3, fillColor: '#cadbb8', fillOpacity: 0.22 }); });
      layer.on('mouseout', () => { if (layer !== selectedLayer) dongsLayer.resetStyle(layer); });
    },
  }).addTo(map);
  const bounds = dongsLayer.getBounds();
  cityMask(outline, bounds);
  map.fitBounds(bounds, { padding: [10, 10] });
  const paddedBounds = bounds.pad(0.025);
  map.setMaxBounds(paddedBounds);
  map.setMinZoom(Math.max(map.getBoundsZoom(paddedBounds), 10));

  layers.greens = L.geoJSON(greens, {
    style: { color: '#2f7046', weight: 1, fillColor: '#93bd73', fillOpacity: 0.35 },
    onEachFeature(feature, layer) {
      const label = feature.properties?.zone_name;
      if (label) layer.bindTooltip(`${label} · 접근성 목적지`);
    },
  }).addTo(map);
  await loadWalkNetwork(networkManifest);
  layers.greens.bringToFront();
  dongsLayer.bringToFront();
  status.textContent = `${scoreData.metadata.dong_count}개 행정동 · ${scoreData.metadata.destinations_used.toLocaleString('ko-KR')}개 녹지 목적지 · 2024 인구`;
}).catch((error) => {
  status.textContent = error.message;
  status.classList.add('error');
});

document.getElementById('greens-toggle').addEventListener('change', (event) => {
  if (!layers.greens) return;
  event.target.checked ? layers.greens.addTo(map) : map.removeLayer(layers.greens);
});
document.getElementById('walk-toggle').addEventListener('change', async (event) => {
  if (!layers.walk) {
    try { await loadWalkNetwork(await fetchJson('./assets/walk-network-manifest.json')); }
    catch (error) { status.textContent = error.message; status.classList.add('error'); }
    return;
  }
  event.target.checked ? layers.walk.addTo(map) : map.removeLayer(layers.walk);
});
document.getElementById('dongs-toggle').addEventListener('change', (event) => {
  if (!dongsLayer) return;
  event.target.checked ? dongsLayer.addTo(map) : map.removeLayer(dongsLayer);
});
