/**
 * 공개 ADS-B API 직통 호출
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
        if (baseUrl.includes('/v2/point')) {
            const [lat, lon, radius] = this.getPointQuery(options);
            return `${baseUrl.replace(/\/$/, '')}/${lat}/${lon}/${radius}`;
        }

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

    getPointQuery(options = {}) {
        if (Array.isArray(options.bounding) && options.bounding.length === 4) {
            const [latMin, lonMin, latMax, lonMax] = options.bounding.map(Number);
            if ([latMin, lonMin, latMax, lonMax].every(Number.isFinite)) {
                const centerLat = (latMin + latMax) / 2;
                const centerLon = (lonMin + lonMax) / 2;
                const latKm = Math.abs(latMax - latMin) * 111;
                const lonKm = Math.abs(lonMax - lonMin) * 111 * Math.cos((centerLat * Math.PI) / 180);
                const radius = Math.min(600, Math.max(30, Math.ceil(Math.max(latKm, lonKm) / 2) + 40));
                return [centerLat.toFixed(4), centerLon.toFixed(4), radius];
            }
        }

        return ['36.8000', '127.8000', 450];
    }

    adsbAcToState(ac) {
        const icao24 = String(ac?.hex || '').toLowerCase();
        const lat = Number(ac?.lat);
        const lon = Number(ac?.lon);
        if (!icao24 || !Number.isFinite(lat) || !Number.isFinite(lon)) {
            return null;
        }

        const nowSec = Math.floor(Date.now() / 1000);
        const seen = Number.isFinite(ac?.seen) ? ac.seen : 0;
        const seenPos = Number.isFinite(ac?.seen_pos) ? ac.seen_pos : seen;

        const onGround = ac?.alt_baro === 'ground' || ac?.on_ground === true;
        const baroAlt = onGround ? 0 : (Number.isFinite(ac?.alt_baro) ? Number(ac.alt_baro) : null);
        const geoAlt = Number.isFinite(ac?.alt_geom) ? Number(ac.alt_geom) : null;

        const speedKt = Number.isFinite(ac?.gs) ? Number(ac.gs) : null;
        const velocityMps = speedKt === null ? null : Number((speedKt / 1.94384).toFixed(2));

        const baroRateFpm = Number.isFinite(ac?.baro_rate) ? Number(ac.baro_rate) : null;
        const verticalRateMps = baroRateFpm === null ? null : Number((baroRateFpm / 196.85).toFixed(2));

        return [
            icao24,
            String(ac?.flight || '').trim(),
            'Unknown',
            Math.max(0, Math.floor(nowSec - seenPos)),
            Math.max(0, Math.floor(nowSec - seen)),
            lon,
            lat,
            baroAlt,
            Boolean(onGround),
            velocityMps,
            Number.isFinite(ac?.track) ? Number(ac.track) : null,
            verticalRateMps,
            null,
            geoAlt,
            ac?.squawk ? String(ac.squawk) : null
        ];
    }

    normalizeStates(payload, options = {}) {
        // Proxy-compatible payload
        if (Array.isArray(payload?.states)) {
            return payload.states;
        }

        // ADS-B payload
        if (Array.isArray(payload?.ac)) {
            let states = payload.ac.map((ac) => this.adsbAcToState(ac)).filter(Boolean);

            if (options.icao24) {
                const target = String(options.icao24).toLowerCase();
                states = states.filter((s) => String(s[0]).toLowerCase() === target);
            }

            return states;
        }

        return [];
    }

    async fetchStatesFromUrl(url, options = {}) {
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
            return this.normalizeStates(data, options);
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
                    const states = await this.fetchStatesFromUrl(url, options);
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
 */
let apiClient = null;

function initializeAPI() {
    // 환경 감지
    const hostname = window.location.hostname;
    const isDev = hostname === 'localhost';
    const isGithubPages = hostname.endsWith('github.io');
    const customApiBase = window.FLIGHT_TRACKER_API_BASE;
    const directProviders = [
        'https://api.adsb.lol/v2/point',
        'https://api.airplanes.live/v2/point'
    ];

    let apiUrls = directProviders;
    if (customApiBase) {
        // 사용자 지정 베이스가 있으면 최우선으로 사용
        apiUrls = [`${customApiBase.replace(/\/$/, '')}/v2/point`, ...directProviders];
    } else if (isDev || isGithubPages) {
        apiUrls = directProviders;
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
