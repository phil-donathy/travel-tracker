const SKYSCANNER_BASE = 'https://partners.api.skyscanner.net/apiservices/v3';

// In-memory cache — persists across warm invocations on Vercel
const cache = new Map();

function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
        cache.delete(key);
        return null;
    }
    return entry.value;
}

function cacheSet(key, value, ttlMs) {
    cache.set(key, { value, expires: Date.now() + ttlMs });
}

const TTL = {
    GEO_NEAREST: 7 * 24 * 60 * 60 * 1000,
    AUTOSUGGEST: 24 * 60 * 60 * 1000,
    FLIGHTS:     6 * 60 * 60 * 1000,
};

async function skyscannerFetch(endpoint, body) {
    const apiKey = process.env.SKYSCANNER_API_KEY;
    if (!apiKey || apiKey === 'your_api_key_here') {
        throw new Error('SKYSCANNER_API_KEY not configured');
    }

    const url = `${SKYSCANNER_BASE}${endpoint}`;
    console.log(`[Skyscanner API] POST ${endpoint}`);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Skyscanner API ${response.status}: ${text}`);
    }

    return response.json();
}

module.exports = { cacheGet, cacheSet, TTL, skyscannerFetch };
