/**
 * Leaflet 지도 관리
 */

class MapManager {
    constructor(mapElementId) {
        this.mapElement = document.getElementById(mapElementId);
        this.map = null;
        this.markers = new Map(); // Map<icao24, Marker>
        this.markerIcons = {
            default: null,
            selected: null,
            idle: null
        };
        this.selectedMarker = null;
        this.markerClickCallback = null;
    }
    
    /**
     * 지도 초기화
     */
    initialize() {
        // 한반도 중심으로 초기화
        const initialLat = 37.0;
        const initialLng = 127.0;
        const initialZoom = 6;
        
        this.map = L.map(this.mapElement).setView([initialLat, initialLng], initialZoom);
        
        // OpenStreetMap 타일 레이어
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19,
            minZoom: 2
        }).addTo(this.map);
        
        // 마커 아이콘 초기화
        this.initializeMarkerIcons();
        
        console.log('🗺️ 지도 초기화 완료');
    }
    
    /**
     * 마커 아이콘 초기화
     */
    initializeMarkerIcons() {
        // 표준 비행기 아이콘
        this.markerIcons.default = L.divIcon({
            className: 'aircraft-marker',
            html: this.getAircraftSVG('#667eea', 0),
            iconSize: [30, 30],
            iconAnchor: [15, 15],
            popupAnchor: [0, -15]
        });
        
        // 선택된 비행기 아이콘
        this.markerIcons.selected = L.divIcon({
            className: 'aircraft-marker selected',
            html: this.getAircraftSVG('#764ba2', 0),
            iconSize: [40, 40],
            iconAnchor: [20, 20],
            popupAnchor: [0, -20]
        });
        
        // 유휴 비행기 아이콘 (신호 없음)
        this.markerIcons.idle = L.divIcon({
            className: 'aircraft-marker idle',
            html: this.getAircraftSVG('#ccc', 0),
            iconSize: [30, 30],
            iconAnchor: [15, 15],
            popupAnchor: [0, -15]
        });
    }
    
    /**
     * 비행기 SVG 아이콘 생성
     * @param {string} color - 색상
     * @param {number} rotation - 회전 각도 (도)
     */
    getAircraftSVG(color, rotation) {
        return `<svg viewBox="0 0 24 24" fill="${color}" transform="rotate(${rotation})" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"></path>
        </svg>`;
    }
    
    /**
     * 항공기 마커 추가
     */
    addMarker(flight) {
        if (this.markers.has(flight.icao24)) {
            return this.updateMarker(flight);
        }
        
        const marker = L.marker(
            [flight.latitude, flight.longitude],
            {
                icon: this.markerIcons.default,
                title: flight.callsign || flight.icao24
            }
        ).addTo(this.map);
        
        // 마커 클릭 이벤트
        marker.on('click', () => {
            this.selectMarker(flight.icao24);
            if (this.markerClickCallback) {
                this.markerClickCallback(flight);
            }
        });
        
        this.markers.set(flight.icao24, marker);
        return marker;
    }
    
    /**
     * 항공기 마커 업데이트
     */
    updateMarker(flight) {
        const marker = this.markers.get(flight.icao24);
        if (!marker) return null;
        
        // 위치 업데이트
        marker.setLatLng([flight.latitude, flight.longitude]);
        
        // 진행 방향으로 회전
        const rotation = flight.track !== null ? flight.track : 0;
        marker.setIcon(L.divIcon({
            className: 'aircraft-marker' + (this.selectedMarker?.icao24 === flight.icao24 ? ' selected' : ''),
            html: this.getAircraftSVG(
                this.selectedMarker?.icao24 === flight.icao24 ? '#764ba2' : '#667eea',
                rotation
            ),
            iconSize: this.selectedMarker?.icao24 === flight.icao24 ? [40, 40] : [30, 30],
            iconAnchor: this.selectedMarker?.icao24 === flight.icao24 ? [20, 20] : [15, 15],
            popupAnchor: [0, this.selectedMarker?.icao24 === flight.icao24 ? -20 : -15]
        }));
        
        // 제목 업데이트
        marker.setTitle(flight.callsign || flight.icao24);
        
        return marker;
    }
    
    /**
     * 마커 제거
     */
    removeMarker(icao24) {
        const marker = this.markers.get(icao24);
        if (marker) {
            this.map.removeLayer(marker);
            this.markers.delete(icao24);
        }
    }
    
    /**
     * 마커 선택
     */
    selectMarker(icao24) {
        // 이전 선택 해제
        if (this.selectedMarker) {
            const oldMarker = this.markers.get(this.selectedMarker.icao24);
            if (oldMarker && this.selectedMarker) {
                oldMarker.setIcon(L.divIcon({
                    className: 'aircraft-marker',
                    html: this.getAircraftSVG('#667eea', this.selectedMarker.track || 0),
                    iconSize: [30, 30],
                    iconAnchor: [15, 15],
                    popupAnchor: [0, -15]
                }));
            }
        }
        
        // 새로운 마커 선택
        const flight = flightStore.getFlight(icao24);
        if (flight) {
            this.selectedMarker = flight;
            const marker = this.markers.get(icao24);
            if (marker) {
                marker.setIcon(L.divIcon({
                    className: 'aircraft-marker selected',
                    html: this.getAircraftSVG('#764ba2', flight.track || 0),
                    iconSize: [40, 40],
                    iconAnchor: [20, 20],
                    popupAnchor: [0, -20]
                }));
                
                // 지도 중심을 선택된 마커로 이동
                this.map.setView([flight.latitude, flight.longitude], Math.max(this.map.getZoom(), 10));
            }
        }
    }
    
    /**
     * 모든 마커 제거
     */
    clearMarkers() {
        for (const marker of this.markers.values()) {
            this.map.removeLayer(marker);
        }
        this.markers.clear();
        this.selectedMarker = null;
    }
    
    /**
     * 모든 마커에 속성 적용
     */
    fitBoundsToMarkers() {
        if (this.markers.size === 0) {
            return; // 마커가 없으면 무시
        }
        
        const group = new L.featureGroup(Array.from(this.markers.values()));
        this.map.fitBounds(group.getBounds(), { padding: [50, 50], maxZoom: 12 });
    }
    
    /**
     * 마커 클릭 콜백 등록
     */
    onMarkerClick(callback) {
        this.markerClickCallback = callback;
    }
}

// 글로벌 MapManager 인스턴스
let mapManager = null;

function initializeMap() {
    mapManager = new MapManager('map');
    mapManager.initialize();
    return mapManager;
}
