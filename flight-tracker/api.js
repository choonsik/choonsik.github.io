/**
 * OpenSky Network API 프록시 호출
 * 
 * 이 파일은 Vercel 서버리스 함수 (/api/flights)를 통해
 * 안전하게 OpenSky API를 호출합니다.
 * 
 * CLIENT_ID와 CLIENT_SECRET은 서버에만 보관되며,
 * 프론트엔드에는 절대 노출되지 않습니다.
 */

class FlightsAPI {
    constructor(apiUrls = ['/api/flights']) {
        this.apiUrls = Array.isArray(apiUrls) ? apiUrls : [apiUrls];
        this.retryCount = 0;
        this.maxRetries = 3;
        this.lastSuccessfulStates = [];
        this.lastSuccessfulAt = 0;
        this.snapshotStorageKey = 'flight-tracker:last-states';
    }

    buildRequestUrl(baseUrl, options = {}) {
        let url = baseUrl;
        const params = new URLSearchParams();

        if (options.bounding) {
            const [latMin, lonMin, latMax, lonMax] = options.bounding;
            params.append('bounding', `${latMin},${lonMin},${latMax},${lonMax}`);
        }

        if (options.icao24) {
            params.append('icao24', options.icao24);
        }

        if (params.toString()) {
            url += '?' + params.toString();
        }

        return url;
    }

    async fetchStatesFromUrl(url) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 9000);

        try {
            const response = await fetch(url, { signal: controller.signal });

            if (response.status === 401) {
                throw new Error('인증 실패: 서버 자격증명 확인 필요');
            }

            if (response.status === 429) {
                throw new Error('Rate limit 초과: 요청 간격을 늘려주세요');
            }

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`API 요청 실패: ${response.status} ${errorData.message || response.statusText}`);
            }

            const data = await response.json();
            return Array.isArray(data?.states) ? data.states : [];
        } finally {
            clearTimeout(timeoutId);
        }
    }

    saveSnapshot(states) {
        try {
            localStorage.setItem(this.snapshotStorageKey, JSON.stringify({
                at: Date.now(),
                states
            }));
        } catch {
            // Ignore storage failures in private mode or quota-limited browsers.
        }
    }

    loadSnapshot() {
        try {
            const raw = localStorage.getItem(this.snapshotStorageKey);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed?.states) ? parsed.states : [];
        } catch {
            return [];
        }
    }
    
    /**
     * 현재 모든 항공기 상태 조회
     * @param {Object} options - 필터링 옵션
     *   - bounding: [lat_min, lon_min, lat_max, lon_max]
     *   - icao24: 특정 항공기 ICAO24 코드
     * @returns {Promise<Array>} 항공기 상태 배열
     */
    async getAllStates(options = {}) {
        let lastError = null;

        try {
            for (const baseUrl of this.apiUrls) {
                const url = this.buildRequestUrl(baseUrl, options);
                try {
                    const states = await this.fetchStatesFromUrl(url);
                    this.retryCount = 0;
                    this.lastSuccessfulStates = states;
                    this.lastSuccessfulAt = Date.now();
                    this.saveSnapshot(states);
                    return states;
                } catch (error) {
                    lastError = error;
                    const message = String(error.message || '');
                    const isRetryable =
                        error.name === 'AbortError' ||
                        message.includes('Failed to fetch') ||
                        message.includes('NetworkError') ||
                        message.includes('API 요청 실패: 5');

                    if (!isRetryable) {
                        throw error;
                    }
                }
            }
        } catch (error) {
            const msg = String(error.message || '');
            if ((msg.includes('Failed to fetch') || msg.includes('NetworkError')) && this.lastSuccessfulStates.length > 0) {
                console.warn('⚠️ 네트워크 오류 - 최근 데이터로 폴백');
                return this.lastSuccessfulStates;
            }
            lastError = error;
        }

        if (this.lastSuccessfulStates.length > 0) {
            console.warn('⚠️ 실시간 호출 실패 - 최근 메모리 데이터로 폴백');
            return this.lastSuccessfulStates;
        }

        const snapshotStates = this.loadSnapshot();
        if (snapshotStates.length > 0) {
            console.warn('⚠️ 실시간 호출 실패 - 저장된 스냅샷 데이터로 폴백');
            this.lastSuccessfulStates = snapshotStates;
            this.lastSuccessfulAt = Date.now();
            return snapshotStates;
        }

        console.error('❌ getAllStates 오류:', lastError?.message || 'unknown error');
        console.warn('⚠️ 모든 API 호출 실패 - 빈 데이터로 안전 폴백');
        return [];
    }
}

/**
 * API 인스턴스 생성 (글로벌)
 * 
 * Vercel에서 배포할 때:
 *   - `/api/flights` 엔드포인트 사용
 * 
 * 로컬 개발할 때:
 *   - http://localhost:8000/api/flights 또는 프록시 서버 필요
 */
let apiClient = null;

function initializeAPI() {
    // 환경 감지
    const hostname = window.location.hostname;
    const isDev = hostname === 'localhost';
    const isGithubPages = hostname.endsWith('github.io');
    const isVercel = hostname.endsWith('vercel.app');
    const customApiBase = window.FLIGHT_TRACKER_API_BASE;
    const railwayBase = 'https://endearing-solace-production.up.railway.app';
    const vercelBase = 'https://choonsik-github-io.vercel.app';

    let apiUrls = ['/api/flights'];
    if (isDev) {
        apiUrls = [
            'http://localhost:3000/api/flights',
            `${railwayBase}/api/flights`
        ];
    } else if (isGithubPages) {
        // GitHub Pages에서는 외부 프록시를 순차 폴백으로 사용
        const preferredBase = (customApiBase || railwayBase).replace(/\/$/, '');
        apiUrls = [
            `${preferredBase}/api/flights`,
            `${vercelBase}/api/flights`
        ];
    } else if (isVercel) {
        // Vercel 직접 배포는 same-origin 우선 + Railway 폴백
        apiUrls = [
            '/api/flights',
            `${railwayBase}/api/flights`
        ];
    }

    // 중복 제거
    apiUrls = [...new Set(apiUrls)];
    
    apiClient = new FlightsAPI(apiUrls);
    console.log('🔌 API 초기화:', apiUrls);
    return apiClient;
}

/**
 * API 호출 래퍼 (에러 처리 및 재시도 로직 포함)
 */
async function fetchFlightsWithRetry(options = {}, maxRetries = 2) {
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const states = await apiClient.getAllStates(options);
            return states;
        } catch (error) {
            lastError = error;
            if (error.message.includes('429') && attempt < maxRetries) {
                // Rate limit 초과 시 대기 후 재시도
                const waitTime = Math.pow(2, attempt) * 5000; // 5s, 10s, 20s
                console.warn(`⏳ Rate limit 초과. ${waitTime / 1000}초 후 재시도...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            } else if (error.message.includes('네트워크')) {
                // 네트워크 오류 시 재시도
                if (attempt < maxRetries) {
                    const waitTime = 1000 * (attempt + 1);
                    console.warn(`🔄 네트워크 오류. ${waitTime}ms 후 재시도...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                } else {
                    throw error;
                }
            } else {
                throw error;
            }
        }
    }

    throw lastError || new Error('알 수 없는 API 오류');
}
