const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
const mapOptions = { zoomControl: false, preferCanvas: true, maxBoundsViscosity: 1 };
const map = L.map('map', mapOptions).setView([37.5665, 126.978], 11);
const status = document.getElementById('status');
const formatNumber = (value) => Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 0 });
let layers = {};
let selectedCode = null;
let selectedLayer = null;
let accessibility = new Map();
let dongsLayer;
const thematicMaps = [];
const excludeNaturalToggle = document.getElementById('exclude-natural-toggle');
const initialExcludeNatural = excludeNaturalToggle.checked;
const initialScenarioKey = initialExcludeNatural ? 'exclude-natural' : 'all-green';
let activeScenarioKey = null;
let baseMapReady = false;
let pendingNaturalExclusion = null;
let scenarioRequestId = 0;

function scenarioAssets(excludeNatural) {
  return excludeNatural
    ? { greens: './assets/green-areas-no-natural.geojson', scores: './assets/dong-accessibility-no-natural.json' }
    : { greens: './assets/green-areas.geojson', scores: './assets/dong-accessibility.json' };
}

function addMapBase(mapInstance) {
  L.control.zoom({ position: 'bottomright' }).addTo(mapInstance);
  mapInstance.createPane('outsideMask');
  mapInstance.getPane('outsideMask').style.zIndex = 450;
  mapInstance.createPane('dongPane');
  mapInstance.getPane('dongPane').style.zIndex = 460;
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(mapInstance);
}

addMapBase(map);

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`지도 데이터를 불러오지 못했습니다: ${path}`);
  return response.json();
}

function cityMask(mapInstance, outline, bounds) {
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
  }).addTo(mapInstance);
}

function featureLayerByCode(layerGroup, code) {
  if (!layerGroup) return null;
  return layerGroup.getLayers().find((layer) => String(layer.feature?.properties?.ADM_CD) === String(code)) || null;
}

function applyThemeStyles(theme) {
  if (!theme.layer) return;
  theme.layer.eachLayer((layer) => {
    const code = String(layer.feature?.properties?.ADM_CD);
    const selected = code === String(selectedCode);
    layer.setStyle({
      color: selected ? '#1e3327' : '#f5f5ef',
      weight: selected ? 2.8 : 0.65,
      fillColor: theme.colorForCode(code),
      fillOpacity: 0.82,
    });
  });
}

function updateThematicDetails(row) {
  const average = document.getElementById('avg-detail');
  const rate = document.getElementById('rate-detail');
  average.classList.remove('empty');
  rate.classList.remove('empty');
  document.getElementById('avg-detail-name').textContent = row.ADM_NM;
  document.getElementById('avg-detail-value').textContent = row.population_weighted_walk_min == null ? '—' : `${row.population_weighted_walk_min.toFixed(1)}분`;
  document.getElementById('avg-detail-rank').textContent = row.rank_walk_min == null ? '순위 없음' : `인구가중 평균 보행시간 · 서울 ${row.rank_walk_min}위 / ${accessibility.size}개 동`;
  document.getElementById('rate-detail-name').textContent = row.ADM_NM;
  document.getElementById('rate-detail-value').textContent = row.population_within_10min_pct == null ? '—' : `${row.population_within_10min_pct.toFixed(1)}%`;
  document.getElementById('rate-detail-rank').textContent = row.rank_within_10min == null ? '순위 없음' : `10분 이내 도달 인구 비율 · 서울 ${row.rank_within_10min}위 / ${accessibility.size}개 동`;
}

function updateSelectedDong(code) {
  const metrics = accessibility.get(String(code));
  if (!metrics) return;
  selectedCode = String(code);
  updateThematicDetails(metrics);

  document.getElementById('selection').classList.remove('empty');
  document.getElementById('dong-name').textContent = metrics.ADM_NM;
  document.getElementById('dong-code').textContent = `행정동 코드 ${metrics.ADM_CD}`;
  document.getElementById('avg-min').textContent = metrics.population_weighted_walk_min == null ? '—' : metrics.population_weighted_walk_min.toFixed(1);
  document.getElementById('within-pct').textContent = metrics.population_within_10min_pct == null ? '—' : metrics.population_within_10min_pct.toFixed(1);
  document.getElementById('avg-rank').textContent = metrics.rank_walk_min == null ? '순위 없음' : `서울 ${metrics.rank_walk_min}위 / ${accessibility.size}개 동`;
  document.getElementById('within-rank').textContent = metrics.rank_within_10min == null ? '순위 없음' : `서울 ${metrics.rank_within_10min}위 / ${accessibility.size}개 동`;
  document.getElementById('population').textContent = `${formatNumber(metrics.total_population)}명`;

  if (selectedLayer) selectedLayer.setStyle({ color: '#70856a', weight: 0.55, fillColor: '#dce5d4', fillOpacity: 0.08 });
  selectedLayer = featureLayerByCode(dongsLayer, code);
  if (selectedLayer) selectedLayer.setStyle({ color: '#1e3327', weight: 2.8, fillColor: '#9fc17f', fillOpacity: 0.3 });
  thematicMaps.forEach(applyThemeStyles);
}

function selectDongFromRanking(code) {
  if (!dongsLayer) return;
  if (!map.hasLayer(dongsLayer)) {
    dongsLayer.addTo(map);
    document.getElementById('dongs-toggle').checked = true;
  }
  updateSelectedDong(code);
  const baseTarget = featureLayerByCode(dongsLayer, code);
  if (baseTarget) map.flyToBounds(baseTarget.getBounds(), { padding: [36, 36], maxZoom: 14, duration: 0.7 });
  thematicMaps.forEach((theme) => {
    const target = featureLayerByCode(theme.layer, code);
    if (target) theme.map.flyToBounds(target.getBounds(), { padding: [28, 28], maxZoom: 13, duration: 0.7 });
  });
  document.querySelector('.thematic-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderRankingChart(containerId, rows, metricKey, rankKey, ascendingBest, top, unit, decimals) {
  const container = document.getElementById(containerId);
  container.replaceChildren();
  const sorted = rows
    .filter((row) => row[metricKey] != null && Number.isFinite(Number(row[metricKey])))
    .sort((a, b) => ((top ? ascendingBest : !ascendingBest) ? 1 : -1) * (Number(a[metricKey]) - Number(b[metricKey])) || a.ADM_NM.localeCompare(b.ADM_NM, 'ko'))
    .slice(0, 10);
  const values = sorted.map((row) => Number(row[metricKey]));
  const low = Math.min(...values);
  const high = Math.max(...values);

  for (const row of sorted) {
    const value = Number(row[metricKey]);
    const relative = high === low ? 100 : 28 + 72 * (top
      ? (ascendingBest ? (high - value) / (high - low) : (value - low) / (high - low))
      : (ascendingBest ? (value - low) / (high - low) : (high - value) / (high - low)));
    const item = document.createElement('div');
    item.className = 'ranking-row';

    const rank = document.createElement('span');
    rank.className = 'ranking-number';
    rank.textContent = `${row[rankKey]}위`;

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'ranking-name';
    name.textContent = row.ADM_NM;
    name.title = `${row.ADM_NM} 지도에서 보기`;
    name.addEventListener('click', () => selectDongFromRanking(row.ADM_CD));

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

function configureThematicMap(theme, rows) {
  const validValues = rows.filter((row) => row[theme.metricKey] != null).map((row) => Number(row[theme.metricKey])).filter(Number.isFinite).sort((a, b) => a - b);
  const maxValue = validValues.at(-1);
  theme.thresholds = [...new Set([0.2, 0.4, 0.6, 0.8]
    .map((q) => validValues[Math.min(validValues.length - 1, Math.floor(q * validValues.length))])
    .filter((threshold) => threshold < maxValue))];
  const classCount = theme.thresholds.length + 1;
  const sourcePalette = theme.basePalette || theme.palette;
  theme.palette = Array.from({ length: classCount }, (_, index) => {
    const paletteIndex = classCount === 1
      ? Math.floor((sourcePalette.length - 1) / 2)
      : Math.round(index * (sourcePalette.length - 1) / (classCount - 1));
    return sourcePalette[paletteIndex];
  });
  theme.colorForCode = (code) => {
    const row = accessibility.get(String(code));
    const value = Number(row?.[theme.metricKey]);
    if (!Number.isFinite(value)) return '#d7dcd7';
    const index = theme.thresholds.findIndex((threshold) => value <= threshold);
    return theme.palette[index < 0 ? theme.palette.length - 1 : index];
  };
}

function createThematicMap(config, dongs, outline, rows) {
  const theme = { ...config, basePalette: [...config.palette] };
  configureThematicMap(theme, rows);
  const mapInstance = L.map(theme.containerId, mapOptions).setView([37.5665, 126.978], 10);
  theme.map = mapInstance;
  addMapBase(mapInstance);
  theme.layer = L.geoJSON(dongs, {
    pane: 'dongPane',
    interactive: true,
    bubblingMouseEvents: false,
    style: (feature) => ({ color: '#f5f5ef', weight: 0.65, fillColor: theme.colorForCode(feature.properties.ADM_CD), fillOpacity: 0.82 }),
    onEachFeature(feature, layer) {
      const properties = feature.properties || {};
      layer.bindTooltip(properties.ADM_NM || '', { sticky: true, className: 'dong-tooltip' });
      layer.on('click', () => updateSelectedDong(properties.ADM_CD));
      layer.on('mouseover', () => {
        if (String(properties.ADM_CD) !== String(selectedCode)) layer.setStyle({ color: '#324b39', weight: 1.7 });
      });
      layer.on('mouseout', () => applyThemeStyles(theme));
    },
  }).addTo(mapInstance);
  const bounds = theme.layer.getBounds();
  cityMask(mapInstance, outline, bounds);
  mapInstance.fitBounds(bounds, { padding: [8, 8] });
  const paddedBounds = bounds.pad(0.025);
  mapInstance.setMaxBounds(paddedBounds);
  mapInstance.setMinZoom(Math.max(mapInstance.getBoundsZoom(paddedBounds), 9));
  thematicMaps.push(theme);
  renderThemeLegend(theme);
}

function renderThemeLegend(theme) {
  const legend = document.getElementById(theme.legendId);
  legend.replaceChildren();
  legend.style.gridTemplateColumns = `repeat(${theme.palette.length}, minmax(0, 1fr))`;
  theme.palette.forEach((color, index) => {
    const segment = document.createElement('div');
    segment.className = 'legend-segment';
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.backgroundColor = color;
    const previous = theme.thresholds[index - 1];
    const next = theme.thresholds[index];
    const label = document.createElement('small');
    if (theme.thresholds.length === 0) label.textContent = '단일 구간';
    else if (index === 0) label.textContent = `≤ ${next.toFixed(1)}${theme.unit}`;
    else if (index === theme.palette.length - 1) label.textContent = `> ${previous.toFixed(1)}${theme.unit}`;
    else label.textContent = `${previous.toFixed(1)}–${next.toFixed(1)}${theme.unit}`;
    segment.append(swatch, label);
    legend.append(segment);
  });
}

function renderAccessibilityRankings(rows) {
  renderRankingChart('walk-ranking', rows, 'population_weighted_walk_min', 'rank_walk_min', true, true, '분', 1);
  renderRankingChart('walk-bottom-ranking', rows, 'population_weighted_walk_min', 'rank_walk_min', true, false, '분', 1);
  renderRankingChart('rate-ranking', rows, 'population_within_10min_pct', 'rank_within_10min', false, true, '%', 1);
  renderRankingChart('rate-bottom-ranking', rows, 'population_within_10min_pct', 'rank_within_10min', false, false, '%', 1);
}

function renderGreenLayer(greens) {
  if (layers.greens) map.removeLayer(layers.greens);
  layers.greens = L.geoJSON(greens, {
    style: { color: '#2f7046', weight: 1, fillColor: '#93bd73', fillOpacity: 0.35 },
    onEachFeature(feature, layer) {
      const label = feature.properties?.name || feature.properties?.green_type || 'OSM 녹지 공간';
      if (label) layer.bindTooltip(`${label} · 접근성 목적지`);
    },
  });
  if (document.getElementById('greens-toggle').checked) layers.greens.addTo(map);
  if (layers.walk) layers.greens.bringToFront();
  if (dongsLayer) dongsLayer.bringToFront();
}

function updateAccessibilityData(scoreData) {
  accessibility = new Map(scoreData.rows.map((row) => [String(row.ADM_CD), row]));
  thematicMaps.forEach((theme) => {
    configureThematicMap(theme, scoreData.rows);
    applyThemeStyles(theme);
    renderThemeLegend(theme);
  });
  renderAccessibilityRankings(scoreData.rows);
  if (selectedCode !== null) updateSelectedDong(selectedCode);
}

function updateStatus(scoreData, excludeNatural) {
  const mode = excludeNatural ? '자연녹지 제외' : '자연녹지 포함';
  status.textContent = `${scoreData.metadata.dong_count}개 행정동 · ${scoreData.metadata.destinations_used.toLocaleString('ko-KR')}개 녹지 목적지 · ${mode} · 2024 인구`;
}

async function switchAccessibilityScenario(excludeNatural) {
  const requestId = ++scenarioRequestId;
  const paths = scenarioAssets(excludeNatural);
  status.classList.remove('error');
  status.textContent = '접근성 자료를 전환하는 중…';
  try {
    const [greens, scoreData] = await Promise.all([fetchJson(paths.greens), fetchJson(paths.scores)]);
    if (requestId !== scenarioRequestId) return;
    updateAccessibilityData(scoreData);
    renderGreenLayer(greens);
    activeScenarioKey = excludeNatural ? 'exclude-natural' : 'all-green';
    updateStatus(scoreData, excludeNatural);
  } catch (error) {
    if (requestId !== scenarioRequestId) return;
    status.textContent = `자료 전환에 실패했습니다: ${error.message}`;
    status.classList.add('error');
    excludeNaturalToggle.checked = activeScenarioKey === 'exclude-natural';
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

const initialPaths = scenarioAssets(initialExcludeNatural);
Promise.all([
  fetchJson('./assets/dongs.geojson'),
  fetchJson('./assets/seoul-outline.geojson'),
  fetchJson(initialPaths.greens),
  fetchJson(initialPaths.scores),
  fetchJson('./assets/walk-network-manifest.json'),
]).then(async ([dongs, outline, greens, scoreData, networkManifest]) => {
  activeScenarioKey = initialScenarioKey;
  accessibility = new Map(scoreData.rows.map((row) => [String(row.ADM_CD), row]));

  const baseBoundsLayer = L.geoJSON(dongs);
  const bounds = baseBoundsLayer.getBounds();
  dongsLayer = L.geoJSON(dongs, {
    pane: 'dongPane',
    interactive: true,
    bubblingMouseEvents: false,
    style: { color: '#70856a', weight: 0.55, fillColor: '#dce5d4', fillOpacity: 0.08 },
    onEachFeature(feature, layer) {
      const properties = feature.properties || {};
      layer.bindTooltip(properties.ADM_NM || '이름 정보 없음', { sticky: true, className: 'dong-tooltip' });
      layer.on('click', () => updateSelectedDong(properties.ADM_CD));
      layer.on('mouseover', () => { if (String(properties.ADM_CD) !== String(selectedCode)) layer.setStyle({ color: '#46664c', weight: 1.3, fillColor: '#cadbb8', fillOpacity: 0.22 }); });
      layer.on('mouseout', () => {
        if (String(properties.ADM_CD) === String(selectedCode)) layer.setStyle({ color: '#1e3327', weight: 2.8, fillColor: '#9fc17f', fillOpacity: 0.3 });
        else dongsLayer.resetStyle(layer);
      });
    },
  }).addTo(map);
  cityMask(map, outline, bounds);
  map.fitBounds(bounds, { padding: [10, 10] });
  const paddedBounds = bounds.pad(0.025);
  map.setMaxBounds(paddedBounds);
  map.setMinZoom(Math.max(map.getBoundsZoom(paddedBounds), 10));

  createThematicMap({
    containerId: 'avg-map', metricKey: 'population_weighted_walk_min', ascending: true,
    palette: ['#2f8057', '#8ab768', '#ddd36b', '#e69d55', '#c95b4b'],
    legendId: 'avg-legend', unit: '분',
  }, dongs, outline, scoreData.rows);
  createThematicMap({
    containerId: 'rate-map', metricKey: 'population_within_10min_pct', ascending: false,
    palette: ['#c95b4b', '#e69d55', '#ddd36b', '#8ab768', '#2f8057'],
    legendId: 'rate-legend', unit: '%',
  }, dongs, outline, scoreData.rows);

  renderAccessibilityRankings(scoreData.rows);
  renderGreenLayer(greens);
  baseMapReady = true;
  const pendingScenario = pendingNaturalExclusion;
  pendingNaturalExclusion = null;
  if (pendingScenario !== null && pendingScenario !== initialExcludeNatural) {
    switchAccessibilityScenario(pendingScenario);
  }
  await loadWalkNetwork(networkManifest);
  layers.greens.bringToFront();
  dongsLayer.bringToFront();
  if (scenarioRequestId === 0) updateStatus(scoreData, initialExcludeNatural);
}).catch((error) => {
  status.textContent = error.message;
  status.classList.add('error');
});

excludeNaturalToggle.addEventListener('change', (event) => {
  if (!baseMapReady) {
    pendingNaturalExclusion = event.target.checked;
    return;
  }
  switchAccessibilityScenario(event.target.checked);
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
