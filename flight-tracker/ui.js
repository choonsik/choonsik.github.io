/**
 * UI 제어 및 상호작용 관리
 */

class UIController {
    constructor() {
        this.pollingInterval = null;
        this.pollingIntervalMs = 5000; // 5초
        this.isPolling = false;
        this.lastUpdateTime = null;
        this.filters = {
            callsign: '',
            country: '',
            altitudeMin: null,
            altitudeMax: null
        };
    }
    
    /**
     * UI 초기화
     */
    initialize() {
        this.setupEventListeners();
        this.populateCountryFilter();
        this.updateStatus('준비 완료');
    }
    
    /**
     * 이벤트 리스너 설정
     */
    setupEventListeners() {
        const searchBtn = document.getElementById('search-btn');
        const resetBtn = document.getElementById('reset-btn');
        
        searchBtn?.addEventListener('click', () => this.performSearch());
        resetBtn?.addEventListener('click', () => this.resetFilters());
        
        // Enter 키로도 검색
        document.getElementById('callsign-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.performSearch();
        });
    }
    
    /**
     * 국가 필터 드롭다운 채우기
     */
    populateCountryFilter() {
        const select = document.getElementById('country-select');
        if (!select) return;
        
        // 현재 국가 목록 업데이트
        const countries = flightStore.getCountries();
        const currentOptions = Array.from(select.options)
            .map(opt => opt.value)
            .filter(v => v); // 빈 옵션 제외
        
        // 새로운 국가 추가
        for (const country of countries) {
            if (!currentOptions.includes(country)) {
                const option = document.createElement('option');
                option.value = country;
                option.textContent = country;
                select.appendChild(option);
            }
        }
    }
    
    /**
     * 검색 수행
     */
    performSearch() {
        this.filters.callsign = document.getElementById('callsign-input')?.value || '';
        this.filters.country = document.getElementById('country-select')?.value || '';
        this.filters.altitudeMin = parseInt(document.getElementById('altitude-min')?.value) || null;
        this.filters.altitudeMax = parseInt(document.getElementById('altitude-max')?.value) || null;
        
        this.refreshDisplay();
        this.updateStatus('필터 적용됨');
    }
    
    /**
     * 필터 초기화
     */
    resetFilters() {
        this.filters = {
            callsign: '',
            country: '',
            altitudeMin: null,
            altitudeMax: null
        };
        
        document.getElementById('callsign-input').value = '';
        document.getElementById('country-select').value = '';
        document.getElementById('altitude-min').value = '';
        document.getElementById('altitude-max').value = '';
        
        this.refreshDisplay();
        this.updateStatus('필터 초기화됨');
    }
    
    /**
     * 화면 갱신 (필터 적용)
     */
    refreshDisplay() {
        // 필터링된 항공기 조회
        const filteredFlights = flightStore.filterFlights(this.filters);
        
        // 기존 마커 모두 제거
        mapManager.clearMarkers();
        
        // 필터링된 항공기 마커 표시
        for (const flight of filteredFlights) {
            mapManager.addMarker(flight);
        }
        
        // 통계 업데이트
        this.updateAircraftCount(filteredFlights.length);
        
        console.log(`🔍 필터 적용: ${filteredFlights.length}개 항공기 표시`);
    }
    
    /**
     * 항공기 카운트 업데이트
     */
    updateAircraftCount(count) {
        const element = document.getElementById('aircraft-count');
        if (element) {
            element.textContent = count.toLocaleString('ko-KR');
        }
    }
    
    /**
     * 마지막 갱신 시간 업데이트
     */
    updateLastUpdateTime() {
        const element = document.getElementById('last-update');
        if (element) {
            const now = new Date();
            element.textContent = now.toLocaleTimeString('ko-KR');
        }
        this.lastUpdateTime = Date.now();
    }
    
    /**
     * 상태 텍스트 업데이트
     */
    updateStatus(text) {
        const element = document.getElementById('status-text');
        if (element) {
            element.textContent = text;
        }
    }
    
    /**
     * 로딩 스피너 표시/숨김
     */
    setLoadingSpinner(show) {
        const spinner = document.getElementById('loading-spinner');
        if (spinner) {
            if (show) {
                spinner.classList.add('show');
            } else {
                spinner.classList.remove('show');
            }
        }
    }
    
    /**
     * 항공기 상세정보 표시
     */
    displayFlightDetails(flight) {
        const detailsDiv = document.getElementById('flight-details');
        if (!detailsDiv) return;
        
        const html = `
            <div class="detail-item">
                <span class="detail-label">콜사인</span>
                <span class="detail-value">${flight.callsign || 'N/A'}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">ICAO24</span>
                <span class="detail-value">${flight.icao24}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">국가</span>
                <span class="detail-value">${flight.country}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">고도</span>
                <span class="detail-value">${FlightFormatter.formatAltitude(flight.altitude)}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">속도</span>
                <span class="detail-value">${FlightFormatter.formatSpeed(flight.velocityKt)}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">진행방향</span>
                <span class="detail-value">${FlightFormatter.formatTrack(flight.track)}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">상승/하강</span>
                <span class="detail-value">${FlightFormatter.formatVerticalRate(flight.verticalRate)}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">위치</span>
                <span class="detail-value">${flight.latitude.toFixed(4)}°, ${flight.longitude.toFixed(4)}°</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">상태</span>
                <span class="detail-value">${flight.onGround ? '지상' : '공중'}</span>
            </div>
            <div class="detail-item">
                <span class="detail-label">마지막 접촉</span>
                <span class="detail-value">${FlightFormatter.formatTimestamp(flight.lastContact)}</span>
            </div>
        `;
        
        detailsDiv.innerHTML = html;
    }
    
    /**
     * 상세정보 초기화
     */
    clearFlightDetails() {
        const detailsDiv = document.getElementById('flight-details');
        if (detailsDiv) {
            detailsDiv.innerHTML = '<p class="empty-state">지도에서 항공기를 클릭하세요</p>';
        }
    }
}

// 글로벌 UIController 인스턴스
let uiController = null;

/**
 * 메인 앱 초기화
 */
async function initializeApp() {
    try {
        // 1. 지도 초기화
        initializeMap();
        
        // 2. API 초기화 (Vercel 서버리스 함수로 안전하게 처리)
        // CLIENT_ID와 CLIENT_SECRET은 Vercel 환경변수에서 관리됨
        initializeAPI();
        
        // 3. UI 초기화
        uiController = new UIController();
        uiController.initialize();
        
        // 4. 마커 클릭 이벤트
        mapManager.onMarkerClick((flight) => {
            uiController.displayFlightDetails(flight);
        });
        
        // 5. 폴링 시작
        await startPolling();
        
    } catch (error) {
        console.error('❌ 앱 초기화 오류:', error);
        uiController?.updateStatus('초기화 실패: ' + error.message);
    }
}

/**
 * 실시간 폴링 시작
 */
async function startPolling() {
    if (uiController.isPolling) return;
    
    uiController.isPolling = true;
    uiController.updateStatus('🔄 데이터 수신 중...');
    
    const poll = async () => {
        try {
            uiController.setLoadingSpinner(true);
            
            // API에서 항공기 상태 조회
            const states = await fetchFlightsWithRetry();
            
            // 데이터 업데이트
            const newFlights = [];
            const seenICAO24 = new Set();
            
            for (const state of states) {
                const flight = flightStore.updateFlight(state);
                if (flight) {
                    newFlights.push(flight);
                    seenICAO24.add(flight.icao24);
                }
            }
            
            // 오래된 데이터 정리 (30초 이상 신호 없음)
            const removed = flightStore.cleanup(30);
            
            // 지도 갱신 (현재 필터 적용)
            const filteredFlights = flightStore.filterFlights(uiController.filters);
            
            // 새로운 마커 추가/기존 마커 업데이트
            for (const flight of filteredFlights) {
                if (mapManager.markers.has(flight.icao24)) {
                    mapManager.updateMarker(flight);
                } else {
                    mapManager.addMarker(flight);
                }
            }
            
            // 필터링된 마커 중 더 이상 존재하지 않는 것 제거
            for (const icao24 of mapManager.markers.keys()) {
                if (!seenICAO24.has(icao24)) {
                    mapManager.removeMarker(icao24);
                }
            }
            
            // UI 업데이트
            uiController.updateAircraftCount(filteredFlights.length);
            uiController.updateLastUpdateTime();
            uiController.updateStatus(`✅ ${filteredFlights.length}개 항공기 추적 중`);
            
            // 선택된 항공기 상세정보 갱신
            if (mapManager.selectedMarker) {
                const updated = flightStore.getFlight(mapManager.selectedMarker.icao24);
                if (updated) {
                    uiController.displayFlightDetails(updated);
                } else {
                    uiController.clearFlightDetails();
                    mapManager.selectedMarker = null;
                }
            }
            
        } catch (error) {
            console.error('❌ 폴링 오류:', error.message);
            uiController.updateStatus('❌ 오류: ' + error.message);
        } finally {
            uiController.setLoadingSpinner(false);
        }
    };
    
    // 초기 실행
    await poll();
    
    // 반복 실행
    uiController.pollingInterval = setInterval(poll, uiController.pollingIntervalMs);
    
    console.log(`⏱️ 폴링 시작: ${uiController.pollingIntervalMs / 1000}초 간격`);
}

/**
 * 폴링 중지
 */
function stopPolling() {
    if (uiController.pollingInterval) {
        clearInterval(uiController.pollingInterval);
        uiController.pollingInterval = null;
        uiController.isPolling = false;
        console.log('⏹️ 폴링 중지');
    }
}
