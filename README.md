# 서울시 공원 접근성 베이스맵

서울시 행정동 경계와 서울 도로 링크를 표시하는 정적 지도입니다. 공원 접근성 지표나 공원 데이터는 아직 포함하지 않았습니다.

## 현재 레이어

- 행정동 경계: `mixed_use/data/dong.geojson` (EPSG:4326, EMD_CD/EMD_NM)
- 도로 링크: `lecture05_Urban_Planning_Index/shp/link_seoul.geojson` (EPSG:5186, 2025-05 갱신 자료를 간소화)
- 배경 타일: OpenStreetMap

도로 링크는 제공된 링크 자료입니다. `network_type="walk"`로 OSM에서 생성한 보행 그래프와 같지 않으며, 보도·횡단보도·보행 금지 정보를 완전하게 반영한다고 보장하지 않습니다. 보행 분석에는 노트북의 OSMnx 그래프 생성 코드를 실행해 얻은 결과를 별도 레이어로 교체해야 합니다.

## 실행

정적 파일이므로 로컬 웹 서버로 열면 됩니다.

```bash
python3 -m http.server 8000
```

그다음 `http://localhost:8000`으로 접속하세요.

## 출처 및 라이선스

- 행정동·도로 링크 파일은 프로젝트에 제공된 수업 자료에서 추출했습니다. 원본 메타데이터와 이용 조건을 확인한 뒤 재배포하세요.
- 배경 타일은 OpenStreetMap contributors 제공 자료이며, 지도에 표시한 저작자 표시를 유지해야 합니다. [OpenStreetMap 저작자 표시](https://www.openstreetmap.org/copyright)
