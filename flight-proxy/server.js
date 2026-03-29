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
  "https://choonsik-github-io.vercel.app"
];

let cachedToken = null;
let tokenExpiresAt = 0;

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

function isTimeoutLikeError(message) {
  const msg = String(message || "");
  return (
    msg.includes("timeout") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("AbortError")
  );
}

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
    8000
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

async function fetchStates(query, token = null) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let lastError = null;

  for (const base of STATES_URLS) {
    const url = query ? `${base}?${query}` : base;
    try {
      return await fetchWithTimeout(url, { headers }, 9000);
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

    let data;
    try {
      const token = await getToken();
      data = await fetchStates(query, token);
    } catch (error) {
      if (!isTimeoutLikeError(error.message)) {
        throw error;
      }
      data = await fetchStates(query, null);
    }

    return res.json({
      ...data,
      meta: {
        proxy: "railway",
        tookMs: Date.now() - startedAt
      }
    });
  } catch (error) {
    return res.status(503).json({
      error: "Proxy failed",
      message: String(error.message || error),
      tookMs: Date.now() - startedAt
    });
  }
});

app.listen(PORT, () => {
  console.log(`flight-proxy running on port ${PORT}`);
});
