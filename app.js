const map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([37.5665, 126.978], 11);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
}).addTo(map);

const status = document.getElementById('status');
const dongInfo = document.getElementById('dong-info');
let walkLayer;
let dongsLayer;

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`데이터를 불러오지 못했습니다: ${path}`);
  return response.json();
}

Promise.all([fetchJson('./assets/dongs.geojson'), fetchJson('./assets/walk-network-manifest.json')])
  .then(async ([dongs, manifest]) => {
    dongsLayer = L.geoJSON(dongs, {
      style: { color: '#668354', weight: 0.85, opacity: 0.8, fillColor: '#a8c28c', fillOpacity: 0.07 },
      onEachFeature(feature, layer) {
        const props = feature.properties || {};
        const name = props.EMD_NM || '이름 정보 없음';
        layer.bindTooltip(name, { sticky: true, className: 'dong-tooltip' });
        layer.on('click', () => {
          dongInfo.innerHTML = `<span class="pin">⌖</span><span><strong>${name}</strong><small>${props.EMD_CD || ''}</small></span>`;
        });
      },
    }).addTo(map);

    const shards = await Promise.all(manifest.files.map((path) => fetchJson(`./assets/${path}`)));
    const lines = [];
    for (const shard of shards) {
      for (const feature of shard.features) {
        if (feature.geometry.type === 'LineString') lines.push(feature.geometry.coordinates);
        if (feature.geometry.type === 'MultiLineString') lines.push(...feature.geometry.coordinates);
      }
    }
    const network = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } }],
    };
    walkLayer = L.geoJSON(network, { style: { color: '#68756d', weight: 0.55, opacity: 0.56 } }).addTo(map);
    map.fitBounds(dongsLayer.getBounds(), { padding: [18, 18] });
    status.textContent = `${dongs.features.length}개 행정동 · ${manifest.edge_count.toLocaleString('ko-KR')}개 보행 링크`;
  })
  .catch((error) => {
    status.textContent = error.message;
    status.classList.add('error');
  });

document.getElementById('roads-toggle').addEventListener('change', (event) => {
  if (!walkLayer) return;
  event.target.checked ? walkLayer.addTo(map) : map.removeLayer(walkLayer);
});
document.getElementById('dong-toggle').addEventListener('change', (event) => {
  if (!dongsLayer) return;
  event.target.checked ? dongsLayer.addTo(map) : map.removeLayer(dongsLayer);
});
