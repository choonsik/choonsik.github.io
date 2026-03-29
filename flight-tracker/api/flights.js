/**
 * Vercel Serverless Function
 * 위치: /api/flights.js
 * 
 * OpenSky Network API 프록시
 * CLIENT_ID와 CLIENT_SECRET을 서버에서만 관리하고,
 * 프론트엔드에는 노출하지 않습니다.
 */

import https from 'https';

/**
 * OAuth2 토큰 발급 (메모리 캐싱)
 */
let cachedToken = null;
let tokenExpiresAt = null;

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
            hostname: 'opensky-network.org',
            port: 443,
            path: '/api/v1/oauth/token',
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
 * 메인 핸들러
 */
export default async function handler(req, res) {
    // CORS 헤더
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    try {
        // 환경변수에서 자격증명 읽음
        const clientId = process.env.OPENSKY_CLIENT_ID;
        const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
        
        if (!clientId || !clientSecret) {
            return res.status(500).json({
                error: 'Server configuration error',
                message: 'OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET must be set'
            });
        }
        
        // 토큰 발급
        const token = await getTokenFromOpenSky(clientId, clientSecret);
        
        // 요청 쿼리 파라미터
        const query = new URLSearchParams();
        
        const requestUrl = new URL(req.url, 'http://localhost');
        const bounding = req.query?.bounding || requestUrl.searchParams.get('bounding');
        const icao24 = req.query?.icao24 || requestUrl.searchParams.get('icao24');

        if (bounding) {
            const [latMin, lonMin, latMax, lonMax] = bounding.split(',').map(Number);
            query.append('lamin', latMin);
            query.append('lomin', lonMin);
            query.append('lamax', latMax);
            query.append('lomax', lonMax);
        }
        
        if (icao24) {
            query.append('icao24', icao24);
        }
        
        const path = `/api/v1/states/all${query.toString() ? '?' + query.toString() : ''}`;
        
        // OpenSky API 호출
        const data = await fetchFromOpenSky(path, token);
        
        // 응답
        res.status(200).json(data);
        
    } catch (error) {
        console.error('API Error:', error.message);
        
        if (error.message === 'Token expired') {
            return res.status(401).json({
                error: 'Token expired',
                message: 'Please retry the request'
            });
        }
        
        res.status(500).json({
            error: 'API call failed',
            message: error.message
        });
    }
}
