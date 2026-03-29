# ✈️ 실시간 비행기 트래킹 웹사이트

OpenSky Network API를 사용하여 전 세계 항공기의 실시간 위치를 추적하는 웹상 지도 애플리케이션입니다.

## 🌟 주요 기능

- **실시간 항공기 위치 추적** — 5초마다 자동 갱신되는 Leaflet 지도상 마커 표시
- **검색 및 필터** — 콜사인, 국가, 고도 범위로 항공기 검색
- **상세 정보 표시** — 클릭하면 고도, 속도, 진행방향, 위치 등 상세 정보
- **자동 갱신** — OAuth2 토큰 자동 관리, 네트워크 오류 시 자동 재시도
- **반응형 디자인** — 데스크톱 및 모바일 환경 지원

## 🚀 빠른 시작

### 1. OpenSky Network 계정 생성

1. https://opensky-network.org/ 방문
2. **Sign up** 클릭하여 무료 계정 생성
3. 이메일 인증 완료

### 2. OAuth2 자격증명 발급

1. 로그인 후 **Settings** → **App Registration** 이동
2. **Create New Application** 클릭
3. 앱 이름 입력 (예: "비행기 트래킹")
4. `Client ID`와 `Client Secret` 복사

### 3. 자격증명 적용

[ui.js](ui.js) 파일의 320-321번 줄을 수정하세요:

```javascript
const CLIENT_ID = 'YOUR_CLIENT_ID';      // ← 복사한 Client ID
const CLIENT_SECRET = 'YOUR_CLIENT_SECRET'; // ← 복사한 Client Secret
```

### 4. 로컬 테스트 (개발 환경)

```bash
cd /Users/choonsik/Documents/choonsik.github.io/flight-tracker
python3 -m http.server 8000
```

브라우저에서 `http://localhost:8000` 열기

## 📋 기술 스택

| 항목 | 도구 |
|------|------|
| **프론트엔드** | HTML5, CSS3, Vanilla JavaScript |
| **지도 라이브러리** | Leaflet.js + OpenStreetMap |
| **API** | OpenSky Network (REST) |
| **인증** | OAuth2 Client Credentials Flow |
| **배포** | GitHub Pages |

## 📁 파일 구조

```
flight-tracker/
├── index.html          # 메인 마크업 (Leaflet 지도, 검색폼, 정보 패널)
├── style.css           # 스타일시트 (그래디언트, 반응형 레이아웃)
├── api.js              # OpenSky API 통신 (OAuth2 토큰 관리)
├── flights.js          # 항공기 데이터 상태 관리 및 필터링
├── map.js              # Leaflet 지도 및 마커 제어
├── ui.js               # UI 상호작용 및 폴링 로직
└── README.md           # 이 파일
```

## 🔧 동작 원리

### 1. 초기화 단계
- Leaflet 지도 초기화 (한반도 중심)
- OpenSky API OAuth2 토큰 발급 (유효: 30분)
- UI 컨트롤러 시작

### 2. 폴링 루프 (5초 간격)
```
OpenSky API → 항공기 상태 배열 조회
    ↓
FlightStore에 데이터 업데이트
    ↓
필터 적용 후 Leaflet 마커 갱신
    ↓
상태 정보 & 상세정보 UI 갱신
```

### 3. 오류 처리
| 오류 | 처리 |
|------|------|
| **401 Unauthorized** | 토큰 만료 → 자동 갱신 후 재요청 |
| **429 Too Many Requests** | Rate limit 초과 → 대기 후 재시도 (5s → 10s → 20s) |
| **네트워크 오류** | 지수 백오프 재시도 (1s → 2s → 4s) |
| **API 한계 초과** | 폴링 중지 및 사용자 알림 |

## 🎯 API 한도

**OpenSky Network 비인증 모드** (플레이스홀더)
- 해상도: 10초 (낮음)
- 일일 한도: 400 크레딧
- 범위: 최근 데이터만 가능

**OpenSky Network 인증 모드** (정상 사용)
- 해상도: 5초 이상
- 일일 한도: 4,000 크레딧
- 범위: 최근 1시간 데이터 접근 가능

## 🌐 배포 (GitHub Pages)

프로젝트를 GitHub Pages에 배포하려면:

```bash
cd /Users/choonsik/Documents/choonsik.github.io
git add flight-tracker/
git commit -m "Add flight tracking application"
git push origin main
```

배포 후 접근 URL:
```
https://choonsik.github.io/flight-tracker/
```

## ⚠️ 보안 정보

**주의**: 프론트엔드에서 `Client Secret`을 노출하고 있습니다. 프로덕션 환경에서는 다음 방법을 권장합니다:

1. **백엔드 프록시 서버** — 백엔드에서 API 호출 후 프론트엔드로 응답 전달
2. **환경 변수** — 빌드 시점에 시크릿 주입 (Vercel, Netlify 등)
3. **Server-Side Rendering** — Next.js 등으로 서버에서 API 호출

현재 구조는 **개인 프로젝트 및 데모 용도**로만 권장됩니다.

## 📊 오픈소스 라이선스

- **Leaflet.js** — BSD 2-Clause License
- **OpenStreetMap** — Open Data Commons Open Database License (ODbL)
- **OpenSky Network** — CC BY 4.0 (데이터), API 약관 준수 필요

## 🤝 기여 및 피드백

버그 리포트, 기능 제안, 개선사항 등은 언제든 환영합니다!

## 📞 지원

문제 발생 시:

1. 브라우저 개발자 콘솔 (F12) → 에러 메시지 확인
2. [OpenSky Network 문서](https://opensky-network.org/api/current/)
3. Leaflet.js [공식 가이드](https://leafletjs.com/)

---

**마지막 업데이트**: 2026년 3월 29일  
**상태**: 개발 & 테스트 중
