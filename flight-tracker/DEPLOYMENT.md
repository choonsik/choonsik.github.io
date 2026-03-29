# 🔒 안전한 배포: Vercel + 서버리스 함수

CLIENT_ID와 CLIENT_SECRET을 안전하게 보호하면서 비행기 트래킹 앱을 배포하는 방법입니다.

## 🏗️ 아키텍처

```
프론트엔드 (GitHub Pages)
    ↓ (요청)
Vercel 서버리스 함수 (/api/flights)
    ↓ (CLIENT_ID/SECRET 포함)
OpenSky Network API
    ↓ (응답)
Vercel 함수 (응답 전달)
    ↓
프론트엔드 (표시)
```

**장점:**
- ✅ CLIENT_ID/SECRET이 프론트엔드에 노출되지 않음
- ✅ 서버에서만 관리 (Vercel 환경변수)
- ✅ 무료 플랜으로 충분
- ✅ GitHub와 자동 연동

---

## 🚀 배포 단계

### 1단계: GitHub에 최신 코드 커밋

```bash
cd /Users/choonsik/Documents/choonsik.github.io

# 변경사항 확인
git status

# 커밋
git add .
git commit -m "Add secure Vercel API proxy for flight tracking

- Removed hardcoded CLIENT_ID/SECRET from frontend
- Added Vercel serverless function (/api/flights)
- Added environment variable support
- Added local dev server for testing"

# 푸시
git push origin main
```

주의: Vercel에서 이 저장소를 Import한 뒤, 프로젝트 Settings에서 `Root Directory`를 `flight-tracker`로 지정하세요.

### 2단계: Vercel 연결 및 배포

#### 2-1. Vercel 가입
1. https://vercel.com 방문
2. **Sign up** → GitHub 계정으로 로그인
3. 계정 확인

#### 2-2. GitHub 리포지토리 연결
1. Vercel 대시보드에서 **Add New...** → **Project**
2. **Import Git Repository** 클릭
3. 검색창에 `choonsik.github.io` 입력
4. **Import** 클릭

#### 2-3. 환경변수 설정
1. 프로젝트 설정 → **Environment Variables**
2. 두 개의 변수 추가:

| 변수명 | 값 | 설명 |
|--------|-----|------|
| **OPENSKY_CLIENT_ID** | `발급받은_CLIENT_ID` | OpenSky Network 계정에서 복사 |
| **OPENSKY_CLIENT_SECRET** | `발급받은_CLIENT_SECRET` | OpenSky Network 계정에서 복사 |

3. **Save** 클릭

#### 2-4. 자동 배포
- GitHub의 `main` 브랜치로 푸시하면 자동 배포됨
- Vercel 대시보드에서 배포 상태 확인 가능

### 3단계: 배포 확인

일반적으로 2-3분 후 다음 URL에서 접속 가능:

```
https://choonsik.github.io/flight-tracker/
```

브라우저 개발자 도구 (F12) → Network 탭에서:
- `/api/flights?...` 요청이 정상 응답되는지 확인
- 항공기 마커가 지도에 표시되는지 확인

---

## 💻 로컬 개발 (선택사항)

로컬에서 테스트하려면:

### 터미널 1: Vercel 함수 에뮬레이션

```bash
cd /Users/choonsik/Documents/choonsik.github.io/flight-tracker

# 환경변수 설정
export OPENSKY_CLIENT_ID="발급받은_CLIENT_ID"
export OPENSKY_CLIENT_SECRET="발급받은_CLIENT_SECRET"

# 개발 서버 시작 (포트 3000)
npm run dev
```

### 터미널 2: 정적 파일 서빙

```bash
cd /Users/choonsik/Documents/choonsik.github.io/flight-tracker

# Python 웹 서버 (포트 8000)
python3 -m http.server 8000
```

### 브라우저에서 접속

```
http://localhost:8000
```

✅ `api/flights.js` 설정에서 자동으로 `http://localhost:3000/api/flights` 호출

---

## 🔑 OpenSky Network 자격증명

### 계정이 없는 경우

1. https://opensky-network.org/ 방문
2. **Sign up** 클릭
3. 이메일, 비밀번호 입력
4. 이메일 확인

### 자격증명 발급

1. 로그인 후 **Settings** 클릭
2. **App Registration** 선택
3. **Create New Application** 클릭
4. 앱 이름 입력 (예: "비행기 트래킹")
5. 약관 동의
6. **Create** 클릭
7. **Client ID**와 **Client Secret** 복사

⚠️ **주의**: Client Secret은 한 번만 표시되므로 안전한 곳에 보관하세요.

---

## ❓ 트러블슈팅

### 문제: "API 요청 실패" 또는 "인증 실패"

**원인**: Vercel 환경변수가 설정되지 않음

**해결**:
1. Vercel 대시보드 → 프로젝트 설정 → Environment Variables
2. `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET` 확인
3. 변수가 없으면 추가
4. 변수 수정 후 프로젝트 재배포 필요:
   ```bash
   git --allow-empty commit --message "Trigger redeploy"
   git push origin main
   ```

### 문제: "CORS 오류" 또는 "Network Error"

**원인**: 브라우저가 다른 도메인의 API를 차단함

**해결**:
- 데스크톱 Chrome 최신 버전 사용
- Private/Incognito 모드에서 테스트
- 브라우저 콘솔 확인 (F12 → Console 탭)

### 문제: 로컬에서 "Cannot find module 'https'"

**원인**: Node.js 버전이 너무 구식

**해결**:
```bash
# Node.js 버전 확인
node --version  # v16 이상 필요

# 최신 버전 설치 (Homebrew)
brew install node
```

### 문제: 항공기가 보이지 않음 (비행기가 없는 시간대)

**원인**: OpenSky Network에 실시간 데이터가 없을 수 있음

**확인**:
1. 브라우저 개발자 도구 → Network 탭
2. `/api/flights` 응답 확인
3. `states` 배열이 비어있으면 공중에 비행 중인 항공기가 없는 시간대

**해결**: 다시 시간을 충분히 기다린 후 확인

---

## 📊 다음 단계 (옵션)

### 1. 커스터마이징
- `flight-tracker/index.html` — 제목, 설명 변경
- `flight-tracker/style.css` — 색상, 폰트 변경
- `flight-tracker/map.js` — 초기 맵 중심 변경

### 2. 기능 추가
- 비행 경로 기록 (폴리라인)
- 비행기 필터링 고도/속도 동적 조정
- 뉘앙스 있는 마커 클러스터링

### 3. 모니터링
- Vercel 대시보드에서 API 호출 수 모니터링
- OpenSky Network 계정에서 일일 크레딧 사용량 확인

---

## 📞 추가 도움말

- **Vercel 문서**: https://vercel.com/docs
- **OpenSky Network API**: https://opensky-network.org/api/current/
- **이 프로젝트**: https://github.com/choonsik/choonsik.github.io

---

**축하합니다!** 🎉  
이제 안전하고 전문적인 비행기 트래킹 사이트를 운영하고 있습니다.
