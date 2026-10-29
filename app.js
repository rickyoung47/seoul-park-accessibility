proj4.defs('EPSG:5186', '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs');

const map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([37.5665, 126.978], 11);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
}).addTo(map);

const status = document.getElementById('status');
const dongInfo = document.getElementById('dong-info');
let roadsLayer;
let dongsLayer;
const projected = (coords) => coords.map(([x, y]) => proj4('EPSG:5186', 'EPSG:4326', [x, y]).reverse());
const projectGeometry = (geometry) => {
  if (geometry.type === 'LineString') return { ...geometry, coordinates: projected(geometry.coordinates) };
  if (geometry.type === 'MultiLineString') return { ...geometry, coordinates: geometry.coordinates.map(projected) };
  return geometry;
};

Promise.all([
  fetch('./assets/dongs.geojson').then((r) => { if (!r.ok) throw new Error('행정동 경계를 불러오지 못했습니다.'); return r.json(); }),
  fetch('./assets/roads-5186.geojson').then((r) => { if (!r.ok) throw new Error('도로 링크를 불러오지 못했습니다.'); return r.json(); }),
]).then(([dongs, roads]) => {
  dongsLayer = L.geoJSON(dongs, {
    style: { color: '#668354', weight: 0.85, opacity: 0.8, fillColor: '#a8c28c', fillOpacity: 0.07 },
    onEachFeature(feature, layer) {
      const p = feature.properties || {};
      const name = p.EMD_NM || '이름 정보 없음';
      layer.bindTooltip(name, { sticky: true, className: 'dong-tooltip' });
      layer.on('click', () => {
        dongInfo.innerHTML = `<span class="pin">⌖</span><span><strong>${name}</strong><small>${p.EMD_CD || ''}</small></span>`;
      });
    },
  }).addTo(map);
  roads.features = roads.features.map((feature) => ({ ...feature, geometry: projectGeometry(feature.geometry) }));
  roadsLayer = L.geoJSON(roads, { style: { color: '#68756d', weight: 0.48, opacity: 0.52 } }).addTo(map);
  map.fitBounds(dongsLayer.getBounds(), { padding: [18, 18] });
  status.textContent = `${dongs.features.length}개 행정동 · ${roads.features.length.toLocaleString('ko-KR')}개 도로 링크`;
}).catch((error) => {
  status.textContent = error.message;
  status.classList.add('error');
});

document.getElementById('roads-toggle').addEventListener('change', (event) => {
  if (!roadsLayer) return;
  event.target.checked ? roadsLayer.addTo(map) : map.removeLayer(roadsLayer);
});
document.getElementById('dong-toggle').addEventListener('change', (event) => {
  if (!dongsLayer) return;
  event.target.checked ? dongsLayer.addTo(map) : map.removeLayer(dongsLayer);
});
