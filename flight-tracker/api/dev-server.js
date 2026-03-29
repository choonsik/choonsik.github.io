/**
 * 로컬 개발 서버
 * 
 * 사용법:
 *   OPENSKY_CLIENT_ID=xxx OPENSKY_CLIENT_SECRET=yyy node api/dev-server.js
 * 
 * 또는:
 *   npm run dev  (package.json에서 환경변수 미리 설정 필요)
 */

import https from 'https';
import http from 'http';

const PORT = 3000;

// 캐시된 토큰
let cachedToken = null;
let tokenExpiresAt = null;

/**
 * OpenSky Network에서 OAuth2 토큰 발급
 */
async function getTokenFromOpenSky(clientId, clientSecret) {
    // 유효한 토큰이 있으면 반환
    if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
        return cachedToken;
    }
    
    return new Promise((resolve, reject) => {
        const postData = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials'
        }).toString();
        
        const options = {
            hostname: 'auth.opensky-network.org',
            port: 443,
            path: '/auth/realms/opensky-network/protocol/openid-connect/token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    const json = JSON.parse(data);
                    cachedToken = json.access_token;
                    tokenExpiresAt = Date.now() + (json.expires_in - 30) * 1000;
                    console.log(`✅ 토큰 획득 (유효: ${Math.round((tokenExpiresAt - Date.now()) / 1000)}초)`);
                    resolve(cachedToken);
                } else {
                    reject(new Error(`Token request failed: ${res.statusCode}`));
                }
            });
        });
        
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

/**
 * OpenSky API 호출
 */
async function fetchFromOpenSky(path, token) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'opensky-network.org',
            port: 443,
            path: path,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(JSON.parse(data));
                } else if (res.statusCode === 401) {
                    // 토큰 만료
                    cachedToken = null;
                    tokenExpiresAt = null;
                    reject(new Error('Token expired'));
                } else {
                    reject(new Error(`OpenSky API error: ${res.statusCode}`));
                }
            });
        });
        
        req.on('error', reject);
        req.end();
    });
}

/**
 * HTTP 서버
 */
const server = http.createServer(async (req, res) => {
    // CORS 헤더
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    try {
        // /api/flights 엔드포인트만 처리
        const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
        
        if (parsedUrl.pathname !== '/api/flights') {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
        }
        
        // 환경변수에서 자격증명 읽음
        const clientId = process.env.OPENSKY_CLIENT_ID;
        const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
        
        if (!clientId || !clientSecret) {
            console.error('❌ 환경변수 누락:');
            console.error('  - OPENSKY_CLIENT_ID');
            console.error('  - OPENSKY_CLIENT_SECRET');
            res.writeHead(500);
            res.end(JSON.stringify({
                error: 'Server configuration error',
                message: 'OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET must be set'
            }));
            return;
        }
        
        // 토큰 발급
        const token = await getTokenFromOpenSky(clientId, clientSecret);
        
        // 요청 쿼리 파라미터
        const query = new URLSearchParams();
        
        const bounding = parsedUrl.searchParams.get('bounding');
        const icao24 = parsedUrl.searchParams.get('icao24');

        if (bounding) {
            const parts = bounding.split(',').map(Number);
            query.append('lamin', parts[0]);
            query.append('lomin', parts[1]);
            query.append('lamax', parts[2]);
            query.append('lomax', parts[3]);
        }
        
        if (icao24) {
            query.append('icao24', icao24);
        }
        
        const path = `/api/states/all${query.toString() ? '?' + query.toString() : ''}`;
        
        // OpenSky API 호출
        const data = await fetchFromOpenSky(path, token);
        
        // 응답
        res.writeHead(200);
        res.end(JSON.stringify(data));
        
    } catch (error) {
        console.error('❌ API Error:', error.message);
        
        if (error.message === 'Token expired') {
            res.writeHead(401);
            res.end(JSON.stringify({
                error: 'Token expired',
                message: 'Please retry the request'
            }));
        } else {
            res.writeHead(500);
            res.end(JSON.stringify({
                error: 'API call failed',
                message: error.message
            }));
        }
    }
});

server.listen(PORT, () => {
    console.log(`\n🚀 로컬 개발 서버 시작`);
    console.log(`📍 http://localhost:${PORT}/api/flights`);
    console.log(`\n⚠️  환경변수 확인:`);
    console.log(`  - OPENSKY_CLIENT_ID: ${process.env.OPENSKY_CLIENT_ID ? '✅ 설정됨' : '❌ 미설정'}`);
    console.log(`  - OPENSKY_CLIENT_SECRET: ${process.env.OPENSKY_CLIENT_SECRET ? '✅ 설정됨' : '❌ 미설정'}`);
    console.log(`\n같은 터미널의 다른 탭에서:\n  cd flight-tracker && python3 -m http.server 8000\n`);
});
