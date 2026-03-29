# Deployment And Final Notes

이 문서는 현재 최종 구조를 기준으로 작성되었습니다.

## 최종 아키텍처

```text
브라우저 (GitHub Pages)
    -> api.adsb.lol/v2/point (우선)
    -> api.airplanes.live/v2/point (폴백)
    -> 지도/목록 렌더링
```

핵심 포인트:

- 서버 프록시 소스는 저장소에서 제거됨
- 프론트에서 공개 ADS-B API를 직접 호출함
- 응답은 프론트에서 기존 states 배열 형식으로 정규화함

## 배포 방식

배포 타깃:

- GitHub Pages: https://choonsik.github.io/flight-tracker/

배포 명령:

```bash
cd /Users/choonsik/Documents/choonsik.github.io
git add .
git commit -m "Update flight-tracker"
git push origin main
```

## 운영 체크리스트

1. 접속 후 5~10초 내 마커가 나타나는지 확인
2. 콘솔에 치명 오류가 없는지 확인
3. 필터(콜사인/국가/고도)가 정상 동작하는지 확인
4. 마커 클릭 시 상세 패널이 갱신되는지 확인

## 캐시 관련 주의

GitHub Pages는 CDN 캐시 때문에 반영이 지연될 수 있습니다.

확인 절차:

1. Cmd+Shift+R 강력 새로고침
2. 시크릿 창에서 재확인
3. 2~5분 후 재확인

## 지금까지 작업 요약

2026-03-29 기준 완료:

- 비행기 트래킹 앱 구현 및 지도/필터/상세 기능 구성
- API 불안정 구간 디버깅 및 폴백 로직 강화
- 데이터 소스를 ADS-B 계열로 전환
- 마커 런타임 오류 수정(marker.setTitle 제거)
- 마커 모양을 비행기 실루엣으로 변경
- 프록시 관련 소스 제거:
    - flight-proxy/*
    - flight-tracker/api/*

## 남아있는 개선 아이디어

1. 국가 정보 보강 (ICAO24 prefix 기반 추정)
2. 마커 클러스터링으로 고밀도 구간 성능 개선
3. 데이터 소스 상태 표시 배지(Primary/Fallback)
