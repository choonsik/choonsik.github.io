/**
 * OpenSky Network API 통신 및 OAuth2 토큰 관리
 */

class TokenManager {
    constructor(clientId, clientSecret) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.token = null;
        this.expiresAt = null;
        this.refreshTimer = null;
    }
    
    /**
     * 토큰 발급 또는 갱신
     */
    async getToken() {
        // 유효한 토큰이 있으면 반환
        if (this.token && this.expiresAt && Date.now() < this.expiresAt) {
            return this.token;
        }
        
        try {
            const response = await fetch('https://opensky-network.org/api/v1/oauth/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `client_id=${encodeURIComponent(this.clientId)}&client_secret=${encodeURIComponent(this.clientSecret)}&grant_type=client_credentials`
            });
            
            if (!response.ok) {
                throw new Error(`OAuth2 토큰 획득 실패: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            this.token = data.access_token;
            // expires_in은 초 단위, 30초 여유를 두고 갱신
            this.expiresAt = Date.now() + (data.expires_in - 30) * 1000;
            
            console.log('✅ OAuth2 토큰 획득 성공 (유효: ' + Math.round((this.expiresAt - Date.now()) / 1000) + '초)');
            
            return this.token;
        } catch (error) {
            console.error('❌ 토큰 획득 오류:', error.message);
            throw error;
        }
    }
    
    /**
     * 토큰 초기화 (강제 갱신)
     */
    invalidate() {
        this.token = null;
        this.expiresAt = null;
    }
}

class OpenSkyAPI {
    constructor(clientId, clientSecret, useAuthentication = true) {
        this.BASE_URL = 'https://opensky-network.org/api/v1';
        this.useAuthentication = useAuthentication;
        this.tokenManager = useAuthentication ? new TokenManager(clientId, clientSecret) : null;
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
            let url = `${this.BASE_URL}/states/all`;
            const params = new URLSearchParams();
            
            // 바운딩 박스 지정 (선택사항)
            if (options.bounding) {
                const [latMin, lonMin, latMax, lonMax] = options.bounding;
                params.append('lamin', latMin);
                params.append('lomin', lonMin);
                params.append('lamax', latMax);
                params.append('lomax', lonMax);
            }
            
            // 특정 항공기 지정 (선택사항)
            if (options.icao24) {
                params.append('icao24', options.icao24);
            }
            
            if (params.toString()) {
                url += '?' + params.toString();
            }
            
            // 인증 헤더 준비
            const headers = {};
            if (this.useAuthentication) {
                const token = await this.tokenManager.getToken();
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            const response = await fetch(url, { headers });
            
            if (response.status === 401) {
                // 토큰 만료
                if (this.useAuthentication) {
                    this.tokenManager.invalidate();
                    // 재시도
                    if (this.retryCount < this.maxRetries) {
                        this.retryCount++;
                        return this.getAllStates(options);
                    }
                }
                throw new Error('인증 실패: 토큰이 유효하지 않습니다');
            }
            
            if (response.status === 429) {
                throw new Error('Rate limit 초과: 요청 간격을 늘려주세요');
            }
            
            if (!response.ok) {
                throw new Error(`API 요청 실패: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            this.retryCount = 0; // 성공 시 재시도 카운터 리셋
            
            return data.states || [];
        } catch (error) {
            console.error('❌ getAllStates 오류:', error.message);
            throw error;
        }
    }
    
    /**
     * 특정 시간 범위의 비행 정보 조회 (과거 데이터)
     * @param {number} begin - 시작 Unix timestamp
     * @param {number} end - 종료 Unix timestamp
     * @param {string} icao24 - 항공기 ICAO24 코드
     * @returns {Promise<Array>} 비행 정보 배열
     */
    async getFlights(begin, end, icao24) {
        try {
            let url = `${this.BASE_URL}/flights/aircraft?icao24=${icao24}&begin=${begin}&end=${end}`;
            
            const headers = {};
            if (this.useAuthentication) {
                const token = await this.tokenManager.getToken();
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            const response = await fetch(url, { headers });
            
            if (!response.ok) {
                throw new Error(`API 요청 실패: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('❌ getFlights 오류:', error.message);
            throw error;
        }
    }
}

/**
 * API 인스턴스 생성 (글로벌)
 * 
 * ⚠️ 중요: OpenSky Network 무료 계정 생성 후 client_id와 client_secret을 입력해주세요
 * 회원가입: https://opensky-network.org/
 */
let apiClient = null;

function initializeAPI(clientId, clientSecret) {
    // 클라이언트와 시크릿이 없으면 비인증 모드 사용
    const useAuth = !!(clientId && clientSecret && clientId !== 'YOUR_CLIENT_ID');
    apiClient = new OpenSkyAPI(clientId, clientSecret, useAuth);
    console.log(`🔌 API 초기화: ${useAuth ? '인증됨 (4000 크레딧/일)' : '비인증 모드 (레이트 제한)'}`);
    return apiClient;
}

/**
 * API 호출 래퍼 (에러 처리 및 재시도 로직 포함)
 */
async function fetchFlightsWithRetry(options = {}, maxRetries = 2) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const states = await apiClient.getAllStates(options);
            return states;
        } catch (error) {
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
                }
            } else {
                throw error;
            }
        }
    }
}
