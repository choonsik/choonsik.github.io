/**
 * Vercel Serverless Function
 * 위치: /api/flights.js
 * 
 * OpenSky Network API 프록시
 * CLIENT_ID와 CLIENT_SECRET을 서버에서만 관리하고,
 * 프론트엔드에는 노출하지 않습니다.
 */

import https from 'https';

const REQUEST_TIMEOUT_MS = 12000;
const MAX_NETWORK_RETRIES = 2;
const STALE_CACHE_TTL_MS = 120000;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientNetworkError(error) {
    const msg = String(error?.message || '');
    return (
        msg.includes('ETIMEDOUT') ||
        msg.includes('ECONNRESET') ||
        msg.includes('EHOSTUNREACH') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('socket hang up')
    );
}

/**
 * OAuth2 토큰 발급 (메모리 캐싱)
 */
let cachedToken = null;
let tokenExpiresAt = null;
let lastSuccessfulPayload = null;
let lastSuccessfulAt = 0;

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

        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
            req.destroy(new Error(`Token request timeout (${REQUEST_TIMEOUT_MS}ms)`));
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

        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
            req.destroy(new Error(`OpenSky request timeout (${REQUEST_TIMEOUT_MS}ms)`));
        });
        
        req.on('error', reject);
        req.end();
    });
}

async function withNetworkRetries(requestFn) {
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_NETWORK_RETRIES; attempt++) {
        try {
            return await requestFn();
        } catch (error) {
            lastError = error;
            const retryable = isTransientNetworkError(error) || String(error.message || '').includes('timeout');
            if (!retryable || attempt === MAX_NETWORK_RETRIES) {
                throw lastError;
            }

            const backoffMs = 800 * (attempt + 1);
            await delay(backoffMs);
        }
    }

    throw lastError;
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
        const token = await withNetworkRetries(() => getTokenFromOpenSky(clientId, clientSecret));
        
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
        const data = await withNetworkRetries(() => fetchFromOpenSky(path, token));

        lastSuccessfulPayload = data;
        lastSuccessfulAt = Date.now();
        
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
        
        if (isTransientNetworkError(error) || String(error.message || '').includes('timeout')) {
            if (lastSuccessfulPayload && Date.now() - lastSuccessfulAt <= STALE_CACHE_TTL_MS) {
                return res.status(200).json({
                    ...lastSuccessfulPayload,
                    stale: true,
                    staleAgeMs: Date.now() - lastSuccessfulAt
                });
            }

            return res.status(503).json({
                error: 'Upstream network timeout',
                message: '네트워크 타임아웃이 발생했습니다. 잠시 후 자동 재시도됩니다.'
            });
        }

        res.status(500).json({
            error: 'API call failed',
            message: error.message
        });
    }
}
