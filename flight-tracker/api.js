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
    constructor(apiUrl = '/api/flights') {
        this.apiUrl = apiUrl;
        this.retryCount = 0;
        this.maxRetries = 3;
    }
    
    /**
     * 현재 모든 항공기 상태 조회
     * @param {Object} options - 필터링 옵션
     *   - bounding: [lat_min, lon_min, lat_max, lon_max]
     *   - icao24: 특정 항공기 ICAO24 코드
     * @returns {Promise<Array>} 항공기 상태 배열
     */
    async getAllStates(options = {}) {
        try {
            let url = this.apiUrl;
            const params = new URLSearchParams();
            
            // 바운딩 박스 지정 (선택사항)
            if (options.bounding) {
                const [latMin, lonMin, latMax, lonMax] = options.bounding;
                params.append('bounding', `${latMin},${lonMin},${latMax},${lonMax}`);
            }
            
            // 특정 항공기 지정 (선택사항)
            if (options.icao24) {
                params.append('icao24', options.icao24);
            }
            
            if (params.toString()) {
                url += '?' + params.toString();
            }
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            
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
            this.retryCount = 0; // 성공 시 재시도 카운터 리셋

            // 비정상 응답에서도 항상 배열을 반환하도록 보장
            if (Array.isArray(data?.states)) {
                return data.states;
            }

            return [];
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('네트워크 요청 시간 초과');
            }
            console.error('❌ getAllStates 오류:', error.message);
            throw error;
        }
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
    const isDev = !window.location.hostname.includes('vercel.app') && 
                   window.location.hostname === 'localhost';
    const apiUrl = isDev ? 'http://localhost:3000/api/flights' : '/api/flights';
    
    apiClient = new FlightsAPI(apiUrl);
    console.log(`🔌 API 초기화: ${apiUrl}`);
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
