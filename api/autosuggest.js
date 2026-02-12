const { cacheGet, cacheSet, TTL, skyscannerFetch } = require('./_lib/skyscanner');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

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
            .filter(p => p.iataCode && (p.type === 'PLACE_TYPE_AIRPORT' || p.type === 'PLACE_TYPE_CITY'))
            .map(p => ({
                entityId: p.entityId,
                name: p.name,
                iata: p.iataCode,
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
};
