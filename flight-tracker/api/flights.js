/**
 * Vercel Serverless Function
 * 위치: /api/flights.js
 *
 * OpenSky Network API 프록시
 */


const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const STATES_BASE_URLS = [
    'https://opensky-network.org/api/states/all',
    'https://api.opensky-network.org/api/states/all'
];

export const config = {
    runtime: 'nodejs',
    regions: ['fra1']
};

const TOKEN_TIMEOUT_MS = 7000;
const DATA_TIMEOUT_MS = 7000;
const AUTH_FLOW_HARD_TIMEOUT_MS = 8000;
const DATA_FLOW_HARD_TIMEOUT_MS = 8000;
const STALE_CACHE_TTL_MS = 120000;

let cachedToken = null;
let tokenExpiresAt = 0;
let lastSuccessfulPayload = null;
let lastSuccessfulAt = 0;

function isTransientNetworkError(error) {
    const msg = String(error?.message || '');
    return (
        msg.includes('timeout') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('ECONNRESET') ||
        msg.includes('EHOSTUNREACH') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('Failed to fetch')
    );
}

async function withHardTimeout(fn, timeoutMs, label) {
    let timeoutId;
    try {
        return await Promise.race([
            fn(),
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error(`${label} timeout (${timeoutMs}ms)`)), timeoutMs);
            })
        ]);
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchJson(url, options = {}, timeoutMs = DATA_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                Accept: 'application/json',
                ...(options.headers || {})
            }
        });

        const bodyText = await response.text();
        let body = {};
        if (bodyText) {
            try {
                body = JSON.parse(bodyText);
            } catch {
                body = { message: bodyText };
            }
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${body.message || response.statusText}`);
        }

        return body;
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error(`Request timeout (${timeoutMs}ms)`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function getTokenFromOpenSky(clientId, clientSecret) {
    if (cachedToken && Date.now() < tokenExpiresAt) {
        return cachedToken;
    }

    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
    });

    const json = await fetchJson(
        TOKEN_URL,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
        },
        TOKEN_TIMEOUT_MS
    );

    cachedToken = json.access_token;
    tokenExpiresAt = Date.now() + ((json.expires_in || 1800) - 30) * 1000;
    return cachedToken;
}

async function fetchStatesFromOpenSky(query, token = null) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    let lastError = null;

    for (const baseUrl of STATES_BASE_URLS) {
        const url = `${baseUrl}${query ? `?${query}` : ''}`;
        try {
            return await fetchJson(url, { method: 'GET', headers }, DATA_TIMEOUT_MS);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('OpenSky states request failed');
}

function buildQuery(req) {
    const query = new URLSearchParams();
    const requestUrl = new URL(req.url, 'http://localhost');
    const bounding = req.query?.bounding || requestUrl.searchParams.get('bounding');
    const icao24 = req.query?.icao24 || requestUrl.searchParams.get('icao24');

    if (bounding) {
        const [latMin, lonMin, latMax, lonMax] = bounding.split(',').map(Number);
        if ([latMin, lonMin, latMax, lonMax].every(Number.isFinite)) {
            query.append('lamin', latMin);
            query.append('lomin', lonMin);
            query.append('lamax', latMax);
            query.append('lomax', lonMax);
        }
    }

    if (icao24) {
        query.append('icao24', icao24);
    }

    return query.toString();
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const requestUrl = new URL(req.url, 'http://localhost');
    if (requestUrl.searchParams.get('health') === '1') {
        return res.status(200).json({ ok: true, service: 'flights-api' });
    }

    if (requestUrl.searchParams.get('diag') === '1') {
        const startedAt = Date.now();
        const clientId = process.env.OPENSKY_CLIENT_ID;
        const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
        const query = buildQuery(req);

        const result = {
            ok: true,
            hasCredentials: Boolean(clientId && clientSecret),
            token: { ok: false, ms: 0, error: null },
            statesAuth: { ok: false, ms: 0, error: null },
            statesAnon: { ok: false, ms: 0, error: null },
            totalMs: 0
        };

        if (clientId && clientSecret) {
            const t0 = Date.now();
            try {
                const token = await withHardTimeout(
                    () => getTokenFromOpenSky(clientId, clientSecret),
                    AUTH_FLOW_HARD_TIMEOUT_MS,
                    'Auth flow'
                );
                result.token.ok = true;
                result.token.ms = Date.now() - t0;

                const t1 = Date.now();
                try {
                    await withHardTimeout(
                        () => fetchStatesFromOpenSky(query, token),
                        DATA_FLOW_HARD_TIMEOUT_MS,
                        'Data flow'
                    );
                    result.statesAuth.ok = true;
                    result.statesAuth.ms = Date.now() - t1;
                } catch (e) {
                    result.statesAuth.error = e.message;
                    result.statesAuth.ms = Date.now() - t1;
                }
            } catch (e) {
                result.token.error = e.message;
                result.token.ms = Date.now() - t0;
            }
        }

        const t2 = Date.now();
        try {
            await withHardTimeout(
                () => fetchStatesFromOpenSky(query, null),
                DATA_FLOW_HARD_TIMEOUT_MS,
                'Fallback data flow'
            );
            result.statesAnon.ok = true;
            result.statesAnon.ms = Date.now() - t2;
        } catch (e) {
            result.statesAnon.error = e.message;
            result.statesAnon.ms = Date.now() - t2;
        }

        result.totalMs = Date.now() - startedAt;
        result.ok = result.statesAuth.ok || result.statesAnon.ok;

        return res.status(result.ok ? 200 : 503).json(result);
    }

    try {
        const clientId = process.env.OPENSKY_CLIENT_ID;
        const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
        const query = buildQuery(req);

        let data = null;

        // 1) 인증 토큰이 있으면 인증 호출 우선 시도
        if (clientId && clientSecret) {
            try {
                const token = await withHardTimeout(
                    () => getTokenFromOpenSky(clientId, clientSecret),
                    AUTH_FLOW_HARD_TIMEOUT_MS,
                    'Auth flow'
                );
                data = await withHardTimeout(
                    () => fetchStatesFromOpenSky(query, token),
                    DATA_FLOW_HARD_TIMEOUT_MS,
                    'Data flow'
                );
            } catch (authError) {
                if (!isTransientNetworkError(authError)) {
                    throw authError;
                }
            }
        }

        // 2) 인증 실패/미설정 시 비인증 폴백
        if (!data) {
            data = await withHardTimeout(
                () => fetchStatesFromOpenSky(query, null),
                DATA_FLOW_HARD_TIMEOUT_MS,
                'Fallback data flow'
            );
        }

        lastSuccessfulPayload = data;
        lastSuccessfulAt = Date.now();

        return res.status(200).json(data);
    } catch (error) {
        console.error('API Error:', error.message);

        if (isTransientNetworkError(error)) {
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

        return res.status(500).json({
            error: 'API call failed',
            message: error.message
        });
    }
}
