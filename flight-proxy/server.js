import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const STATES_URLS = [
  "https://opensky-network.org/api/states/all",
  "https://api.opensky-network.org/api/states/all"
];

const ALLOWED_ORIGINS = [
  "https://choonsik.github.io",
  "https://choonsik-github-io.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];

let cachedToken = null;
let tokenExpiresAt = 0;
const responseCache = new Map();
let latestSuccessfulData = null;

const FRESH_CACHE_MS = 45 * 1000;
const MAX_STALE_CACHE_MS = 15 * 60 * 1000;

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    }
  })
);

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {})
      }
    });

    const text = await response.text();
    let body = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { message: text };
      }
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${body.message || response.statusText}`);
    }

    return body;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Request timeout (${timeoutMs}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing OPENSKY_CLIENT_ID or OPENSKY_CLIENT_SECRET");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  });

  const tokenJson = await fetchWithTimeout(
    TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    },
    3000
  );

  cachedToken = tokenJson.access_token;
  tokenExpiresAt = Date.now() + ((tokenJson.expires_in || 1800) - 30) * 1000;
  return cachedToken;
}

function buildStatesUrl(req) {
  const params = new URLSearchParams();

  if (req.query.bounding) {
    const parts = String(req.query.bounding).split(",").map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      params.append("lamin", parts[0]);
      params.append("lomin", parts[1]);
      params.append("lamax", parts[2]);
      params.append("lomax", parts[3]);
    }
  }

  if (req.query.icao24) {
    params.append("icao24", String(req.query.icao24));
  }

  return params.toString();
}

function parseBounding(query) {
  if (!query) return null;
  const params = new URLSearchParams(query);
  const lamin = Number(params.get("lamin"));
  const lomin = Number(params.get("lomin"));
  const lamax = Number(params.get("lamax"));
  const lomax = Number(params.get("lomax"));

  if ([lamin, lomin, lamax, lomax].every(Number.isFinite)) {
    return { lamin, lomin, lamax, lomax };
  }

  return null;
}

function filterStates(data, query) {
  const states = Array.isArray(data?.states) ? data.states : [];
  const params = new URLSearchParams(query);
  const icao24 = params.get("icao24");
  const bounding = parseBounding(query);

  return states.filter((state) => {
    if (!Array.isArray(state)) return false;

    if (icao24) {
      const currentIcao = String(state[0] || "").toLowerCase();
      if (currentIcao !== String(icao24).toLowerCase()) {
        return false;
      }
    }

    if (bounding) {
      const lat = Number(state[6]);
      const lon = Number(state[5]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return false;
      }
      if (
        lat < bounding.lamin ||
        lat > bounding.lamax ||
        lon < bounding.lomin ||
        lon > bounding.lomax
      ) {
        return false;
      }
    }

    return true;
  });
}

function normalizeData(data) {
  return {
    time: Number(data?.time) || Math.floor(Date.now() / 1000),
    states: Array.isArray(data?.states) ? data.states : []
  };
}

function setCache(cacheKey, data) {
  responseCache.set(cacheKey, {
    data: normalizeData(data),
    updatedAt: Date.now()
  });
  latestSuccessfulData = normalizeData(data);
}

function getCache(cacheKey, maxAgeMs) {
  const entry = responseCache.get(cacheKey);
  if (!entry) return null;
  const ageMs = Date.now() - entry.updatedAt;
  if (ageMs > maxAgeMs) return null;
  return { ...entry, ageMs };
}

async function fetchStates(query, token = null) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let lastError = null;

  for (const base of STATES_URLS) {
    const url = query ? `${base}?${query}` : base;
    try {
      return await fetchWithTimeout(url, { headers }, 2500);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("States fetch failed");
}

app.get("/api/flights", async (req, res) => {
  const startedAt = Date.now();

  try {
    if (req.query.health === "1") {
      return res.json({ ok: true, service: "flight-proxy" });
    }

    const query = buildStatesUrl(req);
    const cacheKey = query || "__all__";
    const freshCache = getCache(cacheKey, FRESH_CACHE_MS);

    if (freshCache) {
      return res.json({
        ...freshCache.data,
        meta: {
          proxy: "railway",
          source: "cache-fresh",
          cacheAgeMs: freshCache.ageMs,
          tookMs: Date.now() - startedAt
        }
      });
    }

    let data;
    let liveSource = "token";
    try {
      const token = await getToken();
      data = await fetchStates(query, token);
    } catch (error) {
      liveSource = "public";
      data = await fetchStates(query, null);
    }

    const normalized = normalizeData(data);
    setCache(cacheKey, normalized);

    return res.json({
      ...normalized,
      meta: {
        proxy: "railway",
        source: `live-${liveSource}`,
        tookMs: Date.now() - startedAt
      }
    });
  } catch (error) {
    const query = buildStatesUrl(req);
    const cacheKey = query || "__all__";
    const staleCache = getCache(cacheKey, MAX_STALE_CACHE_MS);
    if (staleCache) {
      return res.json({
        ...staleCache.data,
        meta: {
          proxy: "railway",
          source: "cache-stale",
          cacheAgeMs: staleCache.ageMs,
          warning: String(error.message || error),
          tookMs: Date.now() - startedAt
        }
      });
    }

    if (latestSuccessfulData) {
      const fallbackStates = filterStates(latestSuccessfulData, query);
      return res.json({
        time: Math.floor(Date.now() / 1000),
        states: fallbackStates,
        meta: {
          proxy: "railway",
          source: "latest-filtered",
          warning: String(error.message || error),
          tookMs: Date.now() - startedAt
        }
      });
    }

    // Last-resort safe response: keep frontend alive with empty dataset.
    return res.json({
      time: Math.floor(Date.now() / 1000),
      states: [],
      meta: {
        proxy: "railway",
        source: "empty-fallback",
        warning: String(error.message || error),
        tookMs: Date.now() - startedAt
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`flight-proxy running on port ${PORT}`);
});
