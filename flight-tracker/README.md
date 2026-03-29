# Flight Tracker

Leaflet 지도 위에 실시간 항공기 위치를 표시하는 웹앱입니다.

현재 버전은 프록시 없이 브라우저에서 공개 ADS-B API를 직접 호출합니다.

## 현재 상태 요약

- API 경로: 프론트엔드 직통 (proxy 제거 완료)
- 데이터 소스 우선순위:
  - https://api.adsb.lol/v2/point
  - https://api.airplanes.live/v2/point
- 렌더링: Leaflet + OpenStreetMap
- 마커: 비행기 실루엣 SVG
- 배포: GitHub Pages

## 주요 기능

- 5초 간격 자동 갱신
- 콜사인/국가/고도 필터
- 지도 영역 기반 조회(바운딩 박스)
- 항공기 상세 정보 패널
- 다중 API 폴백 + 스냅샷 폴백

## 로컬 실행

```bash
cd /Users/choonsik/Documents/choonsik.github.io/flight-tracker
python3 -m http.server 8000
```

브라우저에서 아래 주소 접속:

```text
http://localhost:8000
```

## 배포 주소

```text
https://choonsik.github.io/flight-tracker/
```

## 파일 구조

```text
flight-tracker/
├── index.html
├── style.css
├── api.js
├── flights.js
├── map.js
├── ui.js
├── data/
│   └── latest-states.json
├── DEPLOYMENT.md
└── README.md
```

## 최근 변경 사항 (2026-03-29)

- OpenSky/Vercel/서버 프록시 기반 구조 제거
- ADS-B 공개 API 직통 호출 구조로 전환
- API 응답을 기존 states 배열 포맷으로 정규화
- 런타임 오류 수정: marker.setTitle 제거
- 마커 아이콘을 비행기 실루엣으로 변경

## 알려진 특성

- ADS-B 소스 특성상 국가 정보가 Unknown으로 들어올 수 있음
- GitHub Pages 캐시로 변경 반영이 수 분 지연될 수 있음

## 문제 해결 빠른 체크

- 강력 새로고침: Cmd+Shift+R
- 시크릿 창에서 배포 주소 확인
- 콘솔에서 네트워크 오류 확인

## 참고

- 배포/운영 가이드는 [DEPLOYMENT.md](DEPLOYMENT.md) 참고
