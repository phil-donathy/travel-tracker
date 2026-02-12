require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.SKYSCANNER_API_KEY;
const SKYSCANNER_BASE = 'https://partners.api.skyscanner.net/apiservices/v3';

if (!API_KEY || API_KEY === 'your_api_key_here') {
    console.warn('WARNING: SKYSCANNER_API_KEY not set in .env — flight price endpoints will return errors');
}

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ---------------------------------------------------------------------------
// In-memory cache with TTL
// ---------------------------------------------------------------------------
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
    GEO_NEAREST: 7 * 24 * 60 * 60 * 1000,   // 7 days
    AUTOSUGGEST: 24 * 60 * 60 * 1000,         // 24 hours
    FLIGHTS:     6 * 60 * 60 * 1000,           // 6 hours
};

// ---------------------------------------------------------------------------
// Helper: call Skyscanner API
// ---------------------------------------------------------------------------
async function skyscannerFetch(endpoint, body) {
    const url = `${SKYSCANNER_BASE}${endpoint}`;
    console.log(`[Skyscanner API] POST ${endpoint}`);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'x-api-key': API_KEY,
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

// ---------------------------------------------------------------------------
// POST /api/autosuggest — search for airports by text
// ---------------------------------------------------------------------------
app.post('/api/autosuggest', async (req, res) => {
    try {
        const { query, market } = req.body;
        if (!query) return res.status(400).json({ error: 'query is required' });

        const cacheKey = `autosuggest:${query.toLowerCase()}:${market || 'UK'}`;
        const cached = cacheGet(cacheKey);
        if (cached) return res.json(cached);

        const data = await skyscannerFetch('/autosuggest/flights', {
            query: {
                market: market || 'UK',
                locale: 'en-GB',
                searchTerm: query,
            },
        });

        const airports = (data.places || [])
            .filter(p => p.iata && (p.type === 'PLACE_TYPE_AIRPORT' || p.type === 'PLACE_TYPE_CITY'))
            .map(p => ({
                entityId: p.entityId,
                name: p.name,
                iata: p.iata,
                cityName: p.cityName || '',
                countryName: p.countryName || '',
                type: p.type,
            }));

        const result = { airports };
        cacheSet(cacheKey, result, TTL.AUTOSUGGEST);
        res.json(result);
    } catch (err) {
        console.error('[autosuggest error]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/geo/nearest — find nearest airport from coordinates
// ---------------------------------------------------------------------------
app.post('/api/geo/nearest', async (req, res) => {
    try {
        const { lat, lng } = req.body;
        if (lat == null || lng == null) {
            return res.status(400).json({ error: 'lat and lng are required' });
        }

        // Round to 1 decimal for cache grouping
        const roundedLat = Math.round(lat * 10) / 10;
        const roundedLng = Math.round(lng * 10) / 10;
        const cacheKey = `geo:${roundedLat}:${roundedLng}`;
        const cached = cacheGet(cacheKey);
        if (cached) return res.json(cached);

        const data = await skyscannerFetch('/geo/hierarchy/flights/nearest', {
            locale: 'en-GB',
            location: {
                coordinates: {
                    latitude: lat,
                    longitude: lng,
                },
            },
        });

        // The response contains a "places" map and a "current" place reference
        // Navigate the hierarchy to find the nearest airport or city
        let airport = null;
        const places = data.places || {};

        for (const [id, place] of Object.entries(places)) {
            if (place.iata && (place.type === 'PLACE_TYPE_AIRPORT' || place.type === 'PLACE_TYPE_CITY')) {
                if (!airport || place.type === 'PLACE_TYPE_AIRPORT') {
                    airport = {
                        entityId: place.entityId || id,
                        name: place.name,
                        iata: place.iata,
                        type: place.type,
                    };
                    if (place.type === 'PLACE_TYPE_AIRPORT') break;
                }
            }
        }

        const result = airport
            ? { airport, hasResult: true }
            : { airport: null, hasResult: false };

        cacheSet(cacheKey, result, TTL.GEO_NEAREST);
        res.json(result);
    } catch (err) {
        console.error('[geo/nearest error]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/flights/indicative — get indicative round-trip prices
// ---------------------------------------------------------------------------
app.post('/api/flights/indicative', async (req, res) => {
    try {
        const { originIata, destinationEntityId, year, month, market, currency } = req.body;
        if (!originIata || !destinationEntityId || !year || !month) {
            return res.status(400).json({ error: 'originIata, destinationEntityId, year, month are required' });
        }

        const mkt = market || 'UK';
        const curr = currency || 'GBP';
        const cacheKey = `flights:${originIata}:${destinationEntityId}:${year}-${month}:${mkt}:${curr}`;
        const cached = cacheGet(cacheKey);
        if (cached) return res.json(cached);

        const data = await skyscannerFetch('/flights/indicative/search', {
            query: {
                market: mkt,
                locale: 'en-GB',
                currency: curr,
                dateTimeGroupingType: 'DATE_TIME_GROUPING_TYPE_BY_MONTH',
                queryLegs: [
                    {
                        originPlace: { queryPlace: { iata: originIata } },
                        destinationPlace: { queryPlace: { entityId: destinationEntityId } },
                        dateRange: {
                            startDate: { year, month },
                            endDate: { year, month },
                        },
                    },
                    {
                        originPlace: { queryPlace: { entityId: destinationEntityId } },
                        destinationPlace: { queryPlace: { iata: originIata } },
                        dateRange: {
                            startDate: { year, month },
                            endDate: { year, month },
                        },
                    },
                ],
            },
        });

        // Parse quotes to find minimum price
        const quotes = data.content?.results?.quotes || data.quotes || {};
        let minPrice = null;
        let isDirect = false;
        let carrierId = null;

        for (const quote of Object.values(quotes)) {
            const amount = quote.minPrice?.amount;
            const unit = quote.minPrice?.unit;
            if (amount != null) {
                let price = parseInt(amount, 10);
                if (unit === 'PRICE_UNIT_CENTI') price = price / 100;

                if (minPrice === null || price < minPrice) {
                    minPrice = price;
                    isDirect = quote.isDirect || false;
                    carrierId = quote.outboundLeg?.marketingCarrierId || null;
                }
            }
        }

        // Resolve carrier name if available
        let carrier = null;
        if (carrierId) {
            const carriers = data.content?.results?.carriers || data.carriers || {};
            const c = carriers[carrierId];
            if (c) carrier = c.name;
        }

        const result = minPrice !== null
            ? { minPrice, currency: curr, isDirect, carrier, hasData: true }
            : { minPrice: null, currency: curr, hasData: false };

        cacheSet(cacheKey, result, TTL.FLIGHTS);
        res.json(result);
    } catch (err) {
        console.error('[flights/indicative error]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`BookItList server running at http://localhost:${PORT}`);
});
