const { cacheGet, cacheSet, TTL, skyscannerFetch } = require('../_lib/skyscanner');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { lat, lng } = req.body;
        if (lat == null || lng == null) {
            return res.status(400).json({ error: 'lat and lng are required' });
        }

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
};
