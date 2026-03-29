import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;
let server = null;

const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const STATES_URLS = [
  "https://opensky-network.org/api/states/all",
  "https://api.opensky-network.org/api/states/all"
];
const ADSB_POINT_URLS = [
  "https://api.adsb.lol/v2/point",
  "https://api.airplanes.live/v2/point"
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
const REQUEST_DEADLINE_MS = 9000;

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

// Railway 기본 헬스체크 경로 대응
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "flight-proxy" });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "flight-proxy" });
});

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
    4500
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

function buildAdsbQuery(req, query) {
  const params = new URLSearchParams(query);
  const lamin = Number(params.get("lamin"));
  const lomin = Number(params.get("lomin"));
  const lamax = Number(params.get("lamax"));
  const lomax = Number(params.get("lomax"));

  // If no bounding box is provided, use a broad South Korea-centered radius.
  if (![lamin, lomin, lamax, lomax].every(Number.isFinite)) {
    return { lat: 36.8, lon: 127.8, radiusKm: 450 };
  }

  const centerLat = (lamin + lamax) / 2;
  const centerLon = (lomin + lomax) / 2;

  const latKm = Math.abs(lamax - lamin) * 111;
  const lonKm = Math.abs(lomax - lomin) * 111 * Math.cos((centerLat * Math.PI) / 180);
  const radiusKm = Math.max(30, Math.ceil(Math.max(latKm, lonKm) / 2) + 40);

  return { lat: centerLat, lon: centerLon, radiusKm: Math.min(radiusKm, 600) };
}

function adsbAcToState(ac, nowSec) {
  const icao24 = String(ac?.hex || "").toLowerCase();
  if (!icao24 || !Number.isFinite(ac?.lat) || !Number.isFinite(ac?.lon)) {
    return null;
  }

  const callsign = String(ac?.flight || "").trim();
  const country = "Unknown";
  const seen = Number.isFinite(ac?.seen) ? ac.seen : 0;
  const seenPos = Number.isFinite(ac?.seen_pos) ? ac.seen_pos : seen;

  const timePosition = Math.max(0, Math.floor(nowSec - seenPos));
  const lastContact = Math.max(0, Math.floor(nowSec - seen));

  const isGround = ac?.alt_baro === "ground" || ac?.on_ground === true;
  const altitude = isGround
    ? 0
    : Number.isFinite(ac?.alt_baro)
      ? Number(ac.alt_baro)
      : null;

  const geoAltitude = Number.isFinite(ac?.alt_geom) ? Number(ac.alt_geom) : null;

  // ADS-B ground speed is knots. Convert to m/s for existing frontend parser.
  const speedKt = Number.isFinite(ac?.gs) ? Number(ac.gs) : null;
  const velocity = speedKt === null ? null : Number((speedKt / 1.94384).toFixed(2));

  const track = Number.isFinite(ac?.track) ? Number(ac.track) : null;

  // ADS-B vertical rate is typically ft/min. Convert to m/s.
  const baroRateFpm = Number.isFinite(ac?.baro_rate) ? Number(ac.baro_rate) : null;
  const verticalRate = baroRateFpm === null ? null : Number((baroRateFpm / 196.85).toFixed(2));

  return [
    icao24,
    callsign,
    country,
    timePosition,
    lastContact,
    Number(ac.lon),
    Number(ac.lat),
    altitude,
    Boolean(isGround),
    velocity,
    track,
    verticalRate,
    null,
    geoAltitude,
    ac?.squawk ? String(ac.squawk) : null
  ];
}

function normalizeAdsbPayload(payload, query) {
  const nowSec = Math.floor(Date.now() / 1000);
  const acList = Array.isArray(payload?.ac) ? payload.ac : [];
  const normalized = {
    time: Number(payload?.now) || nowSec,
    states: acList.map((ac) => adsbAcToState(ac, nowSec)).filter(Boolean)
  };

  const params = new URLSearchParams(query);
  const icaoFilter = params.get("icao24");
  if (icaoFilter) {
    const target = String(icaoFilter).toLowerCase();
    normalized.states = normalized.states.filter((state) => String(state[0]).toLowerCase() === target);
  }

  return normalized;
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
      return await fetchWithTimeout(url, { headers }, 4500);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("States fetch failed");
}

async function fetchAdsbStates(req, query) {
  const { lat, lon, radiusKm } = buildAdsbQuery(req, query);
  let lastError = null;

  for (const base of ADSB_POINT_URLS) {
    const url = `${base}/${lat.toFixed(4)}/${lon.toFixed(4)}/${radiusKm}`;
    try {
      const payload = await fetchWithTimeout(url, {}, 4500);
      const normalized = normalizeAdsbPayload(payload, query);
      if (Array.isArray(normalized.states)) {
        return normalized;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("ADSB states fetch failed");
}

async function withDeadline(work, timeoutMs = REQUEST_DEADLINE_MS) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Proxy deadline exceeded (${timeoutMs}ms)`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([work(), timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
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

    const { data, source: liveSource } = await withDeadline(async () => {
      try {
        const adsbData = await fetchAdsbStates(req, query);
        return { data: adsbData, source: "adsb" };
      } catch {
        try {
          const publicData = await fetchStates(query, null);
          return { data: publicData, source: "public" };
        } catch {
          const token = await getToken();
          const tokenData = await fetchStates(query, token);
          return { data: tokenData, source: "token" };
        }
      }
    });

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

server = app.listen(PORT, () => {
  console.log(`flight-proxy running on port ${PORT}`);
});

function gracefulShutdown(signal) {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  if (!server) {
    process.exit(0);
    return;
  }

  server.close(() => {
    process.exit(0);
  });

  // Force close if graceful shutdown hangs.
  setTimeout(() => process.exit(0), 5000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (error) => {
  console.error("uncaughtException:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
});
