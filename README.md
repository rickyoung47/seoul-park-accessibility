# 서울시 공원 접근성 베이스맵

서울시 행정동 경계와 OSMnx 보행 네트워크를 표시하는 정적 지도입니다. 공원 접근성 지표나 공원 데이터는 아직 포함하지 않았습니다.

## 현재 레이어

- 행정동 경계: `mixed_use/data/dong.geojson` (EPSG:4326, EMD_CD/EMD_NM)
- 보행 그래프: `network_type="walk"`로 OSMnx에서 생성, EPSG:5179로 투영한 뒤 지도 표시용 EPSG:4326 GeoJSON으로 저장
- 배경 타일: OpenStreetMap

그래프는 OSM 보행 태그를 바탕으로 생성합니다. OSM 데이터의 완전성은 지역과 지도 기여 상황에 따라 다를 수 있습니다. 지도용 간소화는 화면 표시 파일에만 적용되며 거리 분석용 그래프를 대체하지 않습니다.

## 실행

정적 파일이므로 로컬 웹 서버로 열면 됩니다.

```bash
python3 -m http.server 8000
```

그다음 `http://localhost:8000`으로 접속하세요.

보행망 GeoJSON을 새로 생성하거나 갱신하려면 Python 환경에 `requirements.txt`를 설치한 다음 아래를 실행하세요. 이 과정은 OSM 공개 데이터를 내려받으며 API 키는 필요하지 않습니다.

```bash
python3 -m pip install -r requirements.txt
python3 generate_walk_network.py
```

## 출처 및 라이선스

- 행정동 경계 파일은 프로젝트에 제공된 수업 자료에서 추출했습니다. 원본 메타데이터와 이용 조건을 확인한 뒤 재배포하세요.
- 보행 네트워크는 © OpenStreetMap contributors, ODbL에 따라 제공됩니다. [OpenStreetMap 저작권 안내](https://www.openstreetmap.org/copyright)
- 배경 타일은 OpenStreetMap contributors 제공 자료이며, 지도에 표시한 저작자 표시를 유지해야 합니다. [OpenStreetMap 저작자 표시](https://www.openstreetmap.org/copyright)
