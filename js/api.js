/**
 * Shahrkavi - Mock API Data Layer
 * Simulates satellite imagery search results
 */

const ApiService = (() => {
    // Satellite sensor definitions
    const SATELLITES = {
        'L8': { name: 'Landsat 8', fullName: 'Landsat 8 OLI/TIRS', resolution: '۳۰ متر' },
        'L9': { name: 'Landsat 9', fullName: 'Landsat 9 OLI-2/TIRS-2', resolution: '۳۰ متر' },
        'L7': { name: 'Landsat 7', fullName: 'Landsat 7 ETM+', resolution: '۳۰ متر' },
        'L5': { name: 'Landsat 5', fullName: 'Landsat 5 TM', resolution: '۳۰ متر' },
        'L4': { name: 'Landsat 4', fullName: 'Landsat 4 TM', resolution: '۳۰ متر' },
        'S2': { name: 'Sentinel-2', fullName: 'Sentinel-2 MSI', resolution: '۱۰ متر' },
        'S1': { name: 'Sentinel-1', fullName: 'Sentinel-1 SAR', resolution: '۱۰ متر' },
        'S3': { name: 'Sentinel-3', fullName: 'Sentinel-3 OLCI', resolution: '۳۰۰ متر' },
        'MOD': { name: 'MODIS', fullName: 'Terra MODIS', resolution: '۲۵۰ متر' },
        'MYD': { name: 'MODIS', fullName: 'Aqua MODIS', resolution: '۲۵۰ متر' },
        'AST': { name: 'ASTER', fullName: 'Terra ASTER', resolution: '۱۵ متر' },
        'SRTM': { name: 'SRTM', fullName: 'SRTM Digital Elevation Model', resolution: '۳۰ متر' },
        'ALOS': { name: 'ALOS', fullName: 'ALOS PALSAR', resolution: '۱۲.۵ متر' },
    };

    // Generate a deterministic "random" number from inputs
    function seededRandom(seed) {
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
            const char = seed.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        const x = Math.sin(hash) * 10000;
        return x - Math.floor(x);
    }

    /**
     * Generate mock scene results based on search criteria
     * @param {Object} criteria - { north, south, east, west, dateFrom, dateTo, cloudMax, datasets }
     * @returns {Array} Array of scene objects
     */
    function generateMockResults(criteria) {
        const results = [];
        const selectedDatasets = criteria.datasets || ['L8', 'S2'];

        // Parse dates or use defaults
        const from = criteria.dateFrom ? new Date(criteria.dateFrom) : new Date('2023-01-01');
        const to = criteria.dateTo ? new Date(criteria.dateTo) : new Date('2023-12-31');
        const cloudMax = criteria.cloudMax !== undefined ? criteria.cloudMax : 100;

        // Center point for generating realistic coordinates
        const centerLat = criteria.north && criteria.south
            ? (parseFloat(criteria.north) + parseFloat(criteria.south)) / 2
            : 35.7;
        const centerLng = criteria.east && criteria.west
            ? (parseFloat(criteria.east) + parseFloat(criteria.west)) / 2
            : 51.4;

        let id = 1;

        selectedDatasets.forEach(dataset => {
            if (!SATELLITES[dataset]) return;

            const sat = SATELLITES[dataset];
            // Number of results per dataset
            const count = Math.floor(seededRandom(dataset + criteria.north + criteria.south) * 12) + 4;

            for (let i = 0; i < count; i++) {
                // Generate date within range
                const dateRange = to - from;
                const sceneDate = new Date(from.getTime() + seededRandom(dataset + i + 'date') * dateRange);

                // Generate cloud cover (0-cloudMax)
                const cloudCover = Math.floor(seededRandom(dataset + i + 'cloud') * cloudMax);

                // Generate slight coordinate variations around center
                const latOffset = (seededRandom(dataset + i + 'lat') - 0.5) * 0.5;
                const lngOffset = (seededRandom(dataset + i + 'lng') - 0.5) * 0.5;

                const sceneLat = parseFloat((centerLat + latOffset).toFixed(4));
                const sceneLng = parseFloat((centerLng + lngOffset).toFixed(4));

                // Generate scene ID
                const sceneId = `${dataset}${String(id).padStart(3, '0')}_${sceneDate.getFullYear()}${String(sceneDate.getMonth() + 1).padStart(2, '0')}${String(sceneDate.getDate()).padStart(2, '0')}`;

                // Footprint corners (approximate a small rectangle)
                const halfSize = 0.08;
                const footprint = [
                    { lat: parseFloat((sceneLat + halfSize).toFixed(4)), lng: parseFloat((sceneLng - halfSize).toFixed(4)) },
                    { lat: parseFloat((sceneLat + halfSize).toFixed(4)), lng: parseFloat((sceneLng + halfSize).toFixed(4)) },
                    { lat: parseFloat((sceneLat - halfSize).toFixed(4)), lng: parseFloat((sceneLng + halfSize).toFixed(4)) },
                    { lat: parseFloat((sceneLat - halfSize).toFixed(4)), lng: parseFloat((sceneLng - halfSize).toFixed(4)) },
                ];

                // Cloud cover category
                let cloudCategory = 'low';
                if (cloudCover > 50) cloudCategory = 'high';
                else if (cloudCover > 20) cloudCategory = 'mid';

                results.push({
                    id: sceneId,
                    satellite: sat.name,
                    satelliteCode: dataset,
                    fullName: sat.fullName,
                    resolution: sat.resolution,
                    date: sceneDate.toISOString().split('T')[0],
                    cloudCover: cloudCover,
                    cloudCategory: cloudCategory,
                    lat: sceneLat,
                    lng: sceneLng,
                    footprint: footprint,
                    thumbnail: '', // Generated placeholder
                    path: Math.floor(seededRandom(dataset + i + 'path') * 250) + 1,
                    row: Math.floor(seededRandom(dataset + i + 'row') * 100) + 1,
                    size: `${(seededRandom(dataset + i + 'size') * 800 + 200).toFixed(1)} مگابایت`,
                    quality: (seededRandom(dataset + i + 'qual') * 3 + 7).toFixed(1),
                });

                id++;
            }
        });

        // Sort by date descending
        results.sort((a, b) => new Date(b.date) - new Date(a.date));

        return results;
    }

    /**
     * Search for satellite scenes via FastAPI backend (real STAC API)
     */
    function search(criteria) {
        return new Promise(async (resolve) => {
            try {
                // Use the single selected dataset
                const dataset = criteria.dataset;

                if (dataset === 'OSM') {
                    // OpenStreetMap vector search via Overpass
                    resolve(await searchOsm(criteria));
                    return;
                }

                if (dataset === 'WTH') {
                    // Weather stations search via Meteostat
                    resolve(await searchWeather(criteria));
                    return;
                }

                if (dataset === 'USGS_EQ') {
                    resolve(await searchEarthquakes(criteria));
                    return;
                }

                if (dataset === 'DEM') {
                    // Copernicus DEM search
                    resolve(await searchDem(criteria));
                    return;
                }

                if (dataset?.startsWith('GHS_')) {
                    resolve(await searchGhs(criteria));
                    return;
                }

                if (dataset === 'OVT') {
                    // Overture Maps buildings search
                    resolve(await searchOvertureBuildings(criteria));
                    return;
                }

                // Supported dataset codes
                const supportedCodes = ['L4', 'L5', 'L7', 'L8', 'L9', 'S2', 'S1', 'MOD', 'MYD', 'DEM'];

                if (!supportedCodes.includes(dataset)) {
                    resolve({
                        success: true,
                        data: [],
                        total: 0,
                        message: 'دیتاست انتخاب‌شده پشتیبانی نمی‌شود',
                    });
                    return;
                }

                // Build query parameters
                const params = new URLSearchParams({
                    north: criteria.north,
                    south: criteria.south,
                    east: criteria.east,
                    west: criteria.west,
                    dateFrom: criteria.dateFrom || '2023-01-01',
                    dateTo: criteria.dateTo || '2024-12-31',
                    cloudMax: criteria.cloudMax !== undefined ? criteria.cloudMax : 100,
                    datasets: dataset,  // Single dataset
                    // The backend follows STAC pagination up to this safety cap.
                    limit: 3000,
                });
                if (Array.isArray(criteria.regionGeometry) && criteria.regionGeometry.length >= 3) {
                    params.set('regionGeometry', JSON.stringify(criteria.regionGeometry));
                }

                const response = await fetch(`${API_BASE}/landsat/search?${params}`);

                if (!response.ok) {
                    throw new Error(`Server error: ${response.status}`);
                }

                const data = await response.json();
                resolve(data);
            } catch (error) {
                console.error('Search error:', error);
                resolve({
                    success: false,
                    data: [],
                    total: 0,
                    message: 'خطا در ارتباط با سرور: ' + error.message,
                });
            }
        });
    }

    /**
     * Search OpenStreetMap features matching tag filters inside the region.
     * Each key/value pair becomes its own layer, returned with a breakdown of
     * feature counts by geometry type (point / polyline / polygon).
     */
    function searchOsm(criteria) {
        return new Promise(async (resolve) => {
            try {
                const filters = (criteria.tags || []).map(t => ({
                    key: t.key,
                    value: t.value || '',
                    any: !!t.any,
                }));
                const params = new URLSearchParams({
                    north: criteria.north,
                    south: criteria.south,
                    east: criteria.east,
                    west: criteria.west,
                    filters: JSON.stringify(filters),
                    limit: 10000,
                });

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 120000);
                let response;
                try {
                    response = await fetch(
                        `${API_BASE}/osm/search-layers?${params}`,
                        { signal: controller.signal }
                    );
                } finally {
                    clearTimeout(timeoutId);
                }
                if (!response.ok) {
                    let detail = `Server error: ${response.status}`;
                    try {
                        const err = await response.json();
                        if (err.detail) detail = err.detail;
                    } catch (e) { /* ignore */ }
                    throw new Error(detail);
                }

                const data = await response.json();
                if (!data.success) {
                    throw new Error(data.message || 'خطا در جستجوی OSM');
                }

                const layers = data.layers || [];
                const total = data.total || 0;

                resolve({
                    success: true,
                    data: [],
                    total,
                    message: data.message || `${toPersianNum(total)} عنصر یافت شد`,
                    osm: {
                        count: total,
                        truncated: !!data.truncated,
                        downloadable: data.downloadable !== false,
                        download_url: data.download_url || '',
                        layers,
                    },
                });
            } catch (error) {
                console.error('OSM search error:', error);
                const message = error.name === 'AbortError'
                    ? 'زمان جستجوی OSM به پایان رسید؛ اتصال سرور Overpass را بررسی کنید'
                    : error.message;
                resolve({
                    success: false,
                    data: [],
                    total: 0,
                    message: 'خطا در جستجوی OpenStreetMap: ' + message,
                    osm: null,
                });
            }
        });
    }

    /**
     * Search weather stations inside the region via the Meteostat backend.
     * Each returned station carries its daily summary + a download URL.
     */
    function searchWeather(criteria) {
        return new Promise(async (resolve) => {
            try {
                const params = new URLSearchParams({
                    north: criteria.north,
                    south: criteria.south,
                    east: criteria.east,
                    west: criteria.west,
                    dateFrom: criteria.dateFrom || '2020-01-01',
                    dateTo: criteria.dateTo || '2024-12-31',
                });

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 120000);
                let response;
                try {
                    response = await fetch(
                        `${API_BASE}/weather/search?${params}`,
                        { signal: controller.signal }
                    );
                } finally {
                    clearTimeout(timeoutId);
                }
                if (!response.ok) {
                    let detail = `Server error: ${response.status}`;
                    try {
                        const err = await response.json();
                        if (err.detail) detail = err.detail;
                    } catch (e) { /* ignore */ }
                    throw new Error(detail);
                }

                const data = await response.json();
                if (!data.success) {
                    throw new Error(data.message || 'خطا در جستجوی ایستگاه‌های هواشناسی');
                }

                const stations = Array.isArray(data.stations) ? data.stations : [];
                resolve({
                    success: true,
                    data: [],
                    total: data.count || stations.length,
                    message: data.message || `${toPersianNum(stations.length)} ایستگاه یافت شد`,
                    weather: {
                        count: data.count || stations.length,
                        stations,
                    },
                });
            } catch (error) {
                console.error('Weather search error:', error);
                const message = error.name === 'AbortError'
                    ? 'زمان جستجوی ایستگاه‌های هواشناسی به پایان رسید'
                    : error.message;
                resolve({
                    success: false,
                    data: [],
                    total: 0,
                    message: 'خطا در جستجوی ایستگاه‌های هواشناسی: ' + message,
                    weather: null,
                });
            }
        });
    }

    function searchEarthquakes(criteria) {
        return new Promise(async resolve => {
            try {
                const values = {
                    north: criteria.north, south: criteria.south, east: criteria.east, west: criteria.west,
                    starttime: criteria.dateFrom, endtime: criteria.dateTo,
                    minmagnitude: criteria.minmagnitude ?? '', maxmagnitude: criteria.maxmagnitude ?? '',
                    mindepth: criteria.mindepth ?? '', maxdepth: criteria.maxdepth ?? '',
                    alertlevel: criteria.alertlevel || '', eventtype: criteria.eventtype || '',
                    orderby: criteria.orderby || '', limit: criteria.usgsLimit ?? '', offset: criteria.usgsOffset ?? '',
                    catalog: criteria.catalog || '', contributor: criteria.contributor || '',
                    query_pairs: JSON.stringify(criteria.queryPairs || []),
                };
                const params = new URLSearchParams();
                Object.entries(values).forEach(([key, value]) => {
                    if (value !== null && value !== undefined && value !== '') params.set(key, value);
                });
                const response = await fetch(`${API_BASE}/earthquakes/search?${params}`);
                const data = await response.json();
                if (!response.ok || !data.success) throw new Error(data.detail || data.message || 'خطا در جستجوی زمین‌لرزه‌ها');
                resolve({ success: true, data: [], total: data.count || 0, message: data.message, earthquake: data });
            } catch (error) {
                resolve({ success: false, data: [], total: 0, message: 'خطا در جستجوی زمین‌لرزه‌های USGS: ' + error.message });
            }
        });
    }

    /**
     * Search Copernicus DEM GLO-30 tiles for the given region.
     */
    function searchDem(criteria) {
        return new Promise(async (resolve) => {
            try {
                const params = new URLSearchParams({
                    north: criteria.north,
                    south: criteria.south,
                    east: criteria.east,
                    west: criteria.west,
                    limit: 50,
                });

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 120000);
                let response;
                try {
                    response = await fetch(
                        `${API_BASE}/landsat/dem?${params}`,
                        { signal: controller.signal }
                    );
                } finally {
                    clearTimeout(timeoutId);
                }
                if (!response.ok) {
                    let detail = `Server error: ${response.status}`;
                    try {
                        const err = await response.json();
                        if (err.detail) detail = err.detail;
                    } catch (e) { /* ignore */ }
                    throw new Error(detail);
                }

                const data = await response.json();
                if (!data.success) {
                    throw new Error(data.message || 'خطا در جستجوی DEM');
                }

                const tiles = Array.isArray(data.data) ? data.data : [];
                resolve({
                    success: true,
                    data: tiles,
                    total: data.total || tiles.length,
                    message: data.message || `${toPersianNum(tiles.length)} کاشی DEM یافت شد`,
                    dem: {
                        count: data.total || tiles.length,
                        tiles,
                    },
                });
            } catch (error) {
                console.error('DEM search error:', error);
                const message = error.name === 'AbortError'
                    ? 'زمان جستجوی DEM به پایان رسید'
                    : error.message;
                resolve({
                    success: false,
                    data: [],
                    total: 0,
                    message: 'خطا در جستجوی Copernicus DEM: ' + message,
                    dem: null,
                });
            }
        });
    }

    /**
     * Search Overture Maps buildings inside the given region.
     */
    function searchOvertureBuildings(criteria) {
        return new Promise(async (resolve) => {
            try {
                const params = new URLSearchParams({
                    north: criteria.north,
                    south: criteria.south,
                    east: criteria.east,
                    west: criteria.west,
                    limit: 5000,
                });

                const controller = new AbortController();
                // First (uncached) Overture query can take several minutes
                const timeoutId = setTimeout(() => controller.abort(), 600000);
                let response;
                try {
                    response = await fetch(
                        `${API_BASE}/overture/buildings?${params}`,
                        { signal: controller.signal }
                    );
                } finally {
                    clearTimeout(timeoutId);
                }
                if (!response.ok) {
                    let detail = `Server error: ${response.status}`;
                    try {
                        const err = await response.json();
                        if (err.detail) detail = err.detail;
                    } catch (e) { /* ignore */ }
                    throw new Error(detail);
                }

                const data = await response.json();
                if (!data.success) {
                    throw new Error(data.message || 'خطا در جستجوی Overture Maps');
                }

                resolve({
                    success: true,
                    data: [],
                    total: data.total || 0,
                    message: data.message || 'ساختمانهای Overture Maps یافت شد',
                    overture: {
                        total: data.total || 0,
                        count: data.count || 0,
                        truncated: !!data.truncated,
                        download_url: data.download_url || '',
                    },
                });
            } catch (error) {
                console.error('Overture search error:', error);
                const message = error.name === 'AbortError'
                    ? 'زمان جستجوی Overture Maps به پایان رسید'
                    : error.message;
                resolve({
                    success: false,
                    data: [],
                    total: 0,
                    message: 'خطا در جستجوی ساختمانهای Overture Maps: ' + message,
                    overture: null,
                });
            }
        });
    }

    /**
     * Fetch distinct acquisition dates with imagery for region + dataset
     * within the given date window (the months shown in the calendar).
     */
    function fetchAvailableDates(bounds, dataset, startIso, endIso) {
        return new Promise(async (resolve) => {
            try {
                const params = new URLSearchParams({
                    north: bounds.north,
                    south: bounds.south,
                    east: bounds.east,
                    west: bounds.west,
                    datasets: dataset,
                    start: startIso,
                    end: endIso,
                });
                const res = await fetch(`${API_BASE}/landsat/available-dates?${params}`);
                if (!res.ok) throw new Error(`Server error: ${res.status}`);
                const data = await res.json();
                resolve(data.success ? (data.dates || []) : []);
            } catch (error) {
                console.error('available-dates error:', error);
                resolve([]);
            }
        });
    }

    function searchGhs(criteria) {
        const params = new URLSearchParams({
            north: criteria.north, south: criteria.south, east: criteria.east, west: criteria.west,
            layer: criteria.dataset.replace('GHS_', '').toLowerCase(),
        });
        if (criteria.ghsYears?.length) params.set('years', criteria.ghsYears.join(','));
        return fetch(`${API_BASE}/ghs/search?${params}`)
            .then(response => response.json().then(data => {
                if (!response.ok) throw new Error(data.detail || 'خطا در جستجوی GHS');
                return data;
            }));
    }

    /**
     * Generate a download URL (mock)
     */
    function getDownloadUrl(sceneId) {
        return `#download-${sceneId}`;
    }

    return {
        SATELLITES,
        search,
        fetchAvailableDates,
        searchGhs,
        getDownloadUrl,
    };
})();
