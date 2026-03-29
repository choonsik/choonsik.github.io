/**
 * 항공기 데이터 상태 관리
 */

class FlightStore {
    constructor() {
        // Map<icao24, FlightData>
        this.flights = new Map();
        
        // 국가별 항공기 수 추적
        this.countryCounts = new Map();
        
        // 항공사별 항공기 수 추적
        this.airlineCounts = new Map();
    }
    
    /**
     * 항공기 데이터 추가/갱신
     */
    updateFlight(state) {
        const flight = this.parseState(state);
        
        if (!flight) return null;
        
        const oldFlight = this.flights.get(flight.icao24);
        
        // 국가 카운트 갱신
        if (!oldFlight) {
            const count = (this.countryCounts.get(flight.country) || 0) + 1;
            this.countryCounts.set(flight.country, count);
        }
        
        this.flights.set(flight.icao24, flight);
        return flight;
    }
    
    /**
     * OpenSky API 응답 배열을 FlightData 객체로 변환
     * 
     * OpenSky states 배열 형식:
     * [icao24, callsign, origin_country, time_position, last_contact,
     *  longitude, latitude, baro_altitude, on_ground, velocity,
     *  true_track, vertical_rate, sensors, geo_altitude, squawk, ...]
     */
    parseState(state) {
        if (!state || state.length < 11) return null;
        
        const [
            icao24,
            callsign,
            origin_country,
            time_position,
            last_contact,
            longitude,
            latitude,
            baro_altitude,
            on_ground,
            velocity,
            true_track,
            vertical_rate,
            sensors,
            geo_altitude,
            squawk,
        ] = state;
        
        // 위치 정보가 없으면 무시
        if (latitude === null || longitude === null) {
            return null;
        }
        
        return {
            icao24: icao24,
            callsign: callsign ? callsign.trim() : '',
            country: origin_country || 'Unknown',
            timePosition: time_position,
            lastContact: last_contact,
            longitude: longitude,
            latitude: latitude,
            altitude: baro_altitude, // 기압 고도 (feet)
            altitudeGeo: geo_altitude, // 지리학적 고도
            onGround: on_ground,
            velocity: velocity, // m/s
            velocityKt: velocity ? Math.round(velocity * 1.94384) : 0, // knots로 변환
            track: true_track, // 도(degrees), 0-359
            verticalRate: vertical_rate, // m/s (양수 = 상승)
            squawk: squawk,
            sensors: sensors,
            timestamp: Date.now() // 클라이언트 시간
        };
    }
    
    /**
     * 모든 항공기 데이터 반환
     */
    getAllFlights() {
        return Array.from(this.flights.values());
    }
    
    /**
     * 특정 항공기 데이터 조회
     */
    getFlight(icao24) {
        return this.flights.get(icao24);
    }
    
    /**
     * 특정 ICAO24 항공기 제거
     */
    removeFlight(icao24) {
        const flight = this.flights.get(icao24);
        if (flight) {
            const count = this.countryCounts.get(flight.country) || 0;
            if (count > 1) {
                this.countryCounts.set(flight.country, count - 1);
            } else {
                this.countryCounts.delete(flight.country);
            }
            this.flights.delete(icao24);
        }
    }
    
    /**
     * 필터링된 항공기 반환
     */
    filterFlights(filters = {}) {
        let result = Array.from(this.flights.values());
        
        // 콜사인 필터
        if (filters.callsign) {
            const callsignUpper = filters.callsign.toUpperCase();
            result = result.filter(f => 
                f.callsign.toUpperCase().includes(callsignUpper)
            );
        }
        
        // 국가 필터
        if (filters.country) {
            result = result.filter(f => f.country === filters.country);
        }
        
        // 고도 필터 (feet)
        if (filters.altitudeMin !== undefined) {
            result = result.filter(f => 
                f.altitude !== null && f.altitude >= filters.altitudeMin
            );
        }
        
        if (filters.altitudeMax !== undefined) {
            result = result.filter(f => 
                f.altitude !== null && f.altitude <= filters.altitudeMax
            );
        }
        
        // 속도 필터 (knots)
        if (filters.speedMin !== undefined) {
            result = result.filter(f => 
                f.velocityKt >= filters.speedMin
            );
        }
        
        if (filters.speedMax !== undefined) {
            result = result.filter(f => 
                f.velocityKt <= filters.speedMax
            );
        }
        
        // 지상/공중 필터
        if (filters.onGround !== undefined) {
            result = result.filter(f => f.onGround === filters.onGround);
        }
        
        return result;
    }
    
    /**
     * 모든 국가 리스트 반환
     */
    getCountries() {
        return Array.from(this.countryCounts.keys()).sort();
    }
    
    /**
     * 총 항공기 수
     */
    getTotalCount() {
        return this.flights.size;
    }
    
    /**
     * 새로고침 후 오래된 데이터 정리
     * (30초 이상 신호를 받지 못한 항공기 제거)
     */
    cleanup(maxAgeSeconds = 30) {
        const now = Date.now();
        const maxAge = maxAgeSeconds * 1000;
        
        const toRemove = [];
        for (const [icao24, flight] of this.flights.entries()) {
            if (now - flight.timestamp > maxAge) {
                toRemove.push(icao24);
            }
        }
        
        toRemove.forEach(icao24 => this.removeFlight(icao24));
        
        return toRemove;
    }
}

// 글로벌 FlightStore 인스턴스
const flightStore = new FlightStore();

/**
 * 항공기 데이터 포맷팅 유틸
 */
class FlightFormatter {
    static formatAltitude(feet) {
        if (feet === null || feet === undefined) return 'N/A';
        if (feet === 0) return '지상';
        return feet.toLocaleString('ko-KR') + ' ft';
    }
    
    static formatSpeed(knots) {
        if (knots === null || knots === undefined) return 'N/A';
        return knots + ' kt';
    }
    
    static formatSpeedMps(mps) {
        if (mps === null || mps === undefined) return 'N/A';
        const knots = Math.round(mps * 1.94384);
        return knots + ' kt';
    }
    
    static formatVerticalRate(mps) {
        if (mps === null || mps === undefined) return 'N/A';
        const ftMin = Math.round(mps * 196.85); // m/s to ft/min
        const direction = ftMin > 0 ? '↑' : ftMin < 0 ? '↓' : '-';
        return `${direction} ${Math.abs(ftMin)} ft/min`;
    }
    
    static formatTrack(degrees) {
        if (degrees === null || degrees === undefined) return 'N/A';
        const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                           'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        const index = Math.round(degrees / 22.5) % 16;
        return `${Math.round(degrees)}° (${directions[index]})`;
    }
    
    static formatTimestamp(ts) {
        if (!ts) return 'N/A';
        const date = new Date(ts * 1000);
        return date.toLocaleTimeString('ko-KR');
    }
    
    static formatAge(timestamp) {
        const age = Math.round((Date.now() - timestamp) / 1000);
        if (age < 60) return age + '초 전';
        if (age < 3600) return Math.round(age / 60) + '분 전';
        return Math.round(age / 3600) + '시간 전';
    }
}
