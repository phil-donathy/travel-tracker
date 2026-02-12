const { cacheGet, cacheSet, TTL, skyscannerFetch } = require('../_lib/skyscanner');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { originIata, destinationIata, year, month, market, currency } = req.body;
        if (!originIata || !destinationIata || !year || !month) {
            return res.status(400).json({ error: 'originIata, destinationIata, year, month are required' });
        }

        const mkt = market || 'UK';
        const curr = currency || 'GBP';
        const cacheKey = `flights:${originIata}:${destinationIata}:${year}-${month}:${mkt}:${curr}`;
        const cached = cacheGet(cacheKey);
        if (cached) return res.json(cached);

        const data = await skyscannerFetch('/flights/indicative/search', {
            query: {
                market: mkt,
                locale: 'en-GB',
                currency: curr,
                dateTimeGroupingType: 'DATE_TIME_GROUPING_TYPE_BY_DATE',
                queryLegs: [
                    {
                        originPlace: { queryPlace: { iata: originIata } },
                        destinationPlace: { queryPlace: { iata: destinationIata } },
                        dateRange: {
                            startDate: { year, month },
                            endDate: { year, month },
                        },
                    },
                ],
            },
        });

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
};
