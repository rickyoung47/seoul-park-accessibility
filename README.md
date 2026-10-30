# 서울시 행정동별 공원 접근성

행정동을 지도에서 선택하면 인구가중 평균 보행시간, 10분 이내 도달 인구 비율, 서울시 전체 순위를 보여주는 정적 웹 앱입니다. 상단 체크박스로 `natural=wood|grassland|scrub|heath` 태그 녹지를 제외한 결과와 전체 녹지 결과를 전환할 수 있습니다.

## 지도 레이어와 산출물

- 행정동 경계: 수업 자료 `bnd_dong_seoul.shp`, EPSG:5179, 426개 행정동
- 녹지공간 및 접근성 목적지: 전체 OSM 레이어 `assets/green-areas.geojson`, 자연녹지 제외 레이어 `assets/green-areas-no-natural.geojson`
- 보행 네트워크: OSMnx `network_type="walk"` 그래프에서 만든 링크 레이어
- 인구: `2024년_인구_다사_100M.csv`의 `to_in_001` 값을 100m 격자에 결합
- 행정동 지표: 전체 녹지 `assets/dong-accessibility.json`, 자연녹지 제외 `assets/dong-accessibility-no-natural.json`

## 지표 산정

1. 격자 폴리곤의 중심점을 EPSG:5179에서 계산하고 가장 가까운 보행 네트워크 노드에 연결합니다.
2. OSM 녹지 공간 안의 보행 네트워크 노드를 목적지로 두고, 보행 링크 길이를 비용으로 가장 가까운 녹지 공간까지의 최단거리를 계산합니다. 체크박스를 선택하면 `natural=wood`, `grassland`, `scrub`, `heath` 태그가 있는 면을 목적지에서 제외합니다. 영역 안에 네트워크 노드가 없는 경우 가장 가까운 노드와 영역 사이의 직선 연결거리를 더합니다.
3. 거리를 4km/h(약 66.67m/분)로 나눠 보행시간을 계산합니다.
4. 격자 인구로 행정동별 가중평균을 구하고, 10분 이내 격자 인구를 행정동 총인구로 나눕니다.
5. 평균시간은 짧을수록, 10분 도달률은 높을수록 상위 순위입니다. 동점은 같은 순위를 부여합니다.

OSM의 녹지 태그와 매핑 범위가 실제 녹지 현황을 완전히 포괄하지 않을 수 있고, 실제 공원 출입구·경계와는 다를 수 있습니다. 네트워크 링크는 GeoJSON 크기를 줄이기 위해 각 링크 형상을 미터 단위에서 1.2m 허용오차로 간소화했습니다. 최단거리 역시 이 간소화된 선 형상에서 산출한 근삿값입니다. 실제 보행속도, 경사, 신호 대기는 반영하지 않았습니다.

## 다시 계산하기

재계산 스크립트는 저장소와 같은 상위 폴더에 원본 수업 자료 `lecture05_Urban_Planning_Index`가 있다고 가정합니다. 원본 데이터는 이 저장소에 복사하지 않았습니다.

```bash
python3 -m pip install -r requirements.txt
python3 generate_walk_network.py
python3 compute_accessibility.py
```

`compute_accessibility.py`는 Overpass API에서 OSM 녹지 공간을 조회하고 두 가지 접근성 데이터 세트(전체 녹지, 자연녹지 제외)를 생성합니다. API 키는 필요하지 않습니다.

## 로컬에서 보기

정적 파일을 웹 서버로 열면 됩니다.

```bash
python3 -m http.server 8000
```

그다음 `http://localhost:8000`으로 접속하세요.

## 데이터 출처와 표시 범위

- 행정동 및 인구 자료: 프로젝트에 제공된 수업 자료. 원본 메타데이터와 이용 조건을 확인하세요.
- 녹지 공간 및 보행 네트워크: © OpenStreetMap contributors, ODbL. [저작권 및 이용 안내](https://www.openstreetmap.org/copyright)
- 바탕 타일: OpenStreetMap contributors. 지도에 표시한 저작자 표시를 유지해야 합니다.

앱의 지도는 서울시 경계 안만 보이도록 마스크와 이동 범위를 설정했습니다.
