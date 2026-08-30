/**
 * Shahrkavi - Search Tab Module
 * Handles the search form UI, validation, and orchestrates search execution
 */

const SearchModule = (() => {
    const USGS_QUERY_VALUE_OPTIONS = {
        format: ['geojson', 'xml', 'csv', 'kml'],
        orderby: ['time', 'time-asc', 'magnitude', 'magnitude-asc'],
        alertlevel: ['green', 'yellow', 'orange', 'red'],
        eventtype: ['earthquake', 'quarry blast', 'explosion', 'volcanic eruption', '其他'],
        reviewstatus: ['automatic', 'reviewed'],
        includeallorigins: ['true', 'false'],
        includeallmagnitudes: ['true', 'false'],
        includearrivals: ['true', 'false'],
        producttype: ['origin', 'phase-data', 'focal-mechanism', 'shakemap', 'dyfi', 'losspager'],
    };
    const USGS_QUERY_KEYS = [
        'format', 'starttime', 'endtime', 'minlatitude', 'maxlatitude', 'minlongitude', 'maxlongitude',
        'minmagnitude', 'maxmagnitude', 'mindepth', 'maxdepth', 'alertlevel', 'eventtype', 'orderby',
        'limit', 'offset', 'catalog', 'contributor', 'reviewstatus', 'includeallorigins',
        'includeallmagnitudes', 'includearrivals', 'includedeleted', 'includesuperseded', 'eventid', 'producttype', 'idlist',
    ];
    // Datasets whose imagery availability can be highlighted on the calendar
    const AVAILABLE_DATASETS = new Set(['L4', 'L5', 'L7', 'L8', 'L9', 'S2', 'S1', 'MOD', 'MYD']);
    let ghsYears = [];

    let availReqSeq = 0;
    let availDebounceTimer = null;
    let lastVisibleWindow = null;
    let pendingShp = null;

    function init() {
        const cloudSlider = document.getElementById('CloudCover');
        const cloudValue = document.getElementById('cloudCoverValue');
        const btnUseMap = document.getElementById('btnUseMapBounds');
        const regionFileInput = document.getElementById('regionFileInput');
        const regionPrjInput = document.getElementById('regionPrjInput');

        // Cloud cover slider live update
        if (cloudSlider && cloudValue) {
            cloudSlider.addEventListener('input', () => {
                const val = parseInt(cloudSlider.value);
                cloudValue.textContent = toPersianNum(val) + '٪';
                AppState.searchCriteria.cloudMax = val;
            });

            // Set initial value
            cloudSlider.value = AppState.searchCriteria.cloudMax;
            cloudValue.textContent = toPersianNum(AppState.searchCriteria.cloudMax) + '٪';
        }

        // Use map bounds button
        if (btnUseMap) {
            btnUseMap.addEventListener('click', () => {
                const bounds = MapModule.getMapBounds();
                document.getElementById('North').value = bounds.north.toFixed(4);
                document.getElementById('South').value = bounds.south.toFixed(4);
                document.getElementById('East').value = bounds.east.toFixed(4);
                document.getElementById('West').value = bounds.west.toFixed(4);

                // Highlight the selected region on the map
                MapModule.showSelectionBounds(bounds.north, bounds.south, bounds.east, bounds.west);

                // Coordinates changed -> refresh calendar availability dots
                scheduleAvailableDatesRefresh();

                showToast('محدوده نقشه به فرم جستجو منتقل شد', 'info');
            });
        }

        if (regionFileInput) {
            regionFileInput.addEventListener('change', () => loadRegionFile(regionFileInput));
        }
        if (regionPrjInput) {
            regionPrjInput.addEventListener('change', () => loadPrjFile(regionPrjInput));
        }

        // Prevent accidental form submission
        const regionForm = document.getElementById('regionForm');
        if (regionForm) {
            regionForm.addEventListener('submit', (e) => e.preventDefault());
        }
        const queryForm = document.getElementById('queryForm');
        if (queryForm) {
            queryForm.addEventListener('submit', (e) => e.preventDefault());
        }
        const addEarthquakePair = document.getElementById('btnAddEarthquakePair');
        if (addEarthquakePair) addEarthquakePair.addEventListener('click', addEarthquakeQueryPair);

        // Listen for map drawing events to auto-fill coordinates
        EventBus.on('map:drawing:created', (coords) => {
            // A fresh hand-drawn shape replaces the "use map bounds" highlight
            MapModule.clearSelectionBounds();
            if (coords && coords.type !== 'point') {
                document.getElementById('North').value = coords.north.toFixed(4);
                document.getElementById('South').value = coords.south.toFixed(4);
                document.getElementById('East').value = coords.east.toFixed(4);
                document.getElementById('West').value = coords.west.toFixed(4);

                // Coordinates changed -> refresh calendar availability dots
                scheduleAvailableDatesRefresh();
            }
        });

        // Available-dates highlighting: refetch whenever the calendar shows
        // different months, the region changes, or the dataset changes
        ['North', 'South', 'East', 'West'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', scheduleAvailableDatesRefresh);
            }
        });

        EventBus.on('dataset:changed', () => {
            JalaliDatePicker.setAvailableDates([]);
            scheduleAvailableDatesRefresh();
        });

        JalaliDatePicker.onViewChange(win => {
            lastVisibleWindow = win;
            refreshAvailableDates();
        });

        // Set default range: last 6 months until today
        const today = new Date();
        const sixMonthsAgo = new Date(today);
        sixMonthsAgo.setMonth(today.getMonth() - 6);

        JalaliDatePicker.setRange(
            sixMonthsAgo.toISOString().split('T')[0],
            today.toISOString().split('T')[0]
        );

        console.log('Search module initialized');
    }

    function loadGhsYears() {
        if (ghsYears.length) { renderGhsYears(); return; }
        fetch(`${API_BASE}/ghs/years`).then(response => response.json()).then(data => {
            ghsYears = Array.isArray(data.years) ? data.years : [];
            renderGhsYears();
        }).catch(() => showToast('سال‌های GHS دریافت نشد', 'error'));
    }

    function renderGhsYears() {
        const container = document.getElementById('ghsYearOptions');
        if (!container) return;
        const selected = new Set(AppState.searchCriteria.ghsYears || ghsYears);
        container.innerHTML = ghsYears.map(year => `<div class="col-4 col-sm-3"><label class="form-check small"><input class="form-check-input ghs-year-checkbox" type="checkbox" value="${year}" ${selected.has(year) ? 'checked' : ''}> <span>${toPersianNum(year)}</span></label></div>`).join('');
    }

    async function loadRegionFile(input) {
        const file = input.files?.[0];
        if (!file) return;
        const status = document.getElementById('regionUploadStatus');
        setRegionUploadStatus(status, 'در حال خواندن فایل...', false);

        try {
            const extension = file.name.toLowerCase().split('.').pop();
            let geojson;
            let bounds;
            if (extension !== 'shp') {
                pendingShp = null;
                showPrjPicker(false);
            }
            if (extension === 'geojson' || extension === 'json') {
                geojson = normaliseGeoJson(JSON.parse(await file.text()));
            } else if (extension === 'kml') {
                geojson = parseKml(await file.text());
            } else if (extension === 'kmz') {
                geojson = await parseKmz(file);
            } else if (extension === 'shp') {
                bounds = getShpExtent(await file.arrayBuffer());
                pendingShp = { bounds, file };
                const prjInput = document.getElementById('regionPrjInput');
                if (prjInput) prjInput.value = '';
                showPrjPicker(true);
                setRegionUploadStatus(status, 'فایل SHP دریافت شد؛ برای تعیین CRS، فایل PRJ متناظر را انتخاب کنید.', false, true);
                return;
            } else if (extension === 'zip') {
                if (typeof shp !== 'function') throw new Error('کتابخانه خواندن شیپ‌فایل بارگذاری نشد.');
                geojson = normaliseShapefile(await shp(await file.arrayBuffer()));
            } else {
                throw new Error('فرمت فایل پشتیبانی نمی‌شود.');
            }

            if (geojson && extension !== 'zip') {
                geojson = convertGeoJsonToWgs84(geojson);
            }
            bounds = bounds || getGeoJsonBounds(geojson);
            if (!bounds) throw new Error('فایل هندسه جغرافیایی معتبری ندارد.');

            ['North', 'South', 'East', 'West'].forEach((id, index) => {
                const values = [bounds.north, bounds.south, bounds.east, bounds.west];
                document.getElementById(id).value = values[index].toFixed(4);
            });
            AppState.mapDrawings = { type: 'uploaded', ...bounds };
            MapModule.clearSelectionBounds();
            MapModule.showSelectionBounds(bounds.north, bounds.south, bounds.east, bounds.west);
            MapModule.fitBounds(bounds.north, bounds.south, bounds.east, bounds.west);
            saveRegionPreference(bounds);
            setSummaryRegion(bounds.north, bounds.south, bounds.east, bounds.west);
            scheduleAvailableDatesRefresh();
            setRegionUploadStatus(status, `محدوده از فایل «${file.name}» بارگذاری شد. مختصات به WGS84 تبدیل شد.`, true);
        } catch (error) {
            input.value = '';
            setRegionUploadStatus(status, error.message || 'خواندن فایل انجام نشد.', false);
        }
    }

    async function loadPrjFile(input) {
        const prjFile = input.files?.[0];
        if (!prjFile || !pendingShp) return;
        const status = document.getElementById('regionUploadStatus');
        try {
            if (typeof proj4 !== 'function') throw new Error('کتابخانه تبدیل CRS بارگذاری نشد.');
            const sourceCrs = await prjFile.text();
            const bounds = transformShpExtent(pendingShp.bounds, sourceCrs);
            applyRegionExtent(bounds, 'مختصات با استفاده از PRJ به WGS84 تبدیل شد.');
            setRegionUploadStatus(status, `محدوده از «${pendingShp.file.name}» با فایل PRJ تبدیل شد.`, true);
        } catch (error) {
            input.value = '';
            setRegionUploadStatus(status, error.message || 'خواندن فایل PRJ انجام نشد.', false);
        }
    }

    function showPrjPicker(show) {
        const wrapper = document.getElementById('regionPrjUpload');
        if (wrapper) wrapper.hidden = !show;
        if (!show) {
            const input = document.getElementById('regionPrjInput');
            if (input) input.value = '';
        }
        if (show) document.getElementById('regionPrjInput')?.focus();
    }

    function applyRegionExtent(bounds, note = '') {
        ['North', 'South', 'East', 'West'].forEach((id, index) => {
            const values = [bounds.north, bounds.south, bounds.east, bounds.west];
            document.getElementById(id).value = values[index].toFixed(4);
        });
        AppState.mapDrawings = { type: 'uploaded', ...bounds };
        MapModule.clearSelectionBounds();
        MapModule.showSelectionBounds(bounds.north, bounds.south, bounds.east, bounds.west);
        MapModule.fitBounds(bounds.north, bounds.south, bounds.east, bounds.west);
        saveRegionPreference(bounds);
        setSummaryRegion(bounds.north, bounds.south, bounds.east, bounds.west);
        scheduleAvailableDatesRefresh();
        if (note) setRegionUploadStatus(document.getElementById('regionUploadStatus'), note, true);
    }

    function transformShpExtent(bounds, sourceCrs) {
        const corners = [
            [bounds.west, bounds.south], [bounds.west, bounds.north],
            [bounds.east, bounds.south], [bounds.east, bounds.north],
        ].map(point => proj4(sourceCrs, 'EPSG:4326', point));
        const longitudes = corners.map(point => point[0]);
        const latitudes = corners.map(point => point[1]);
        const transformed = {
            north: Math.max(...latitudes),
            south: Math.min(...latitudes),
            east: Math.max(...longitudes),
            west: Math.min(...longitudes),
        };
        if (![transformed.north, transformed.south, transformed.east, transformed.west].every(Number.isFinite)
            || transformed.east <= transformed.west || transformed.north <= transformed.south) {
            throw new Error('فایل PRJ محدوده قابل تبدیل معتبری ندارد.');
        }
        return transformed;
    }

    function setRegionUploadStatus(element, message, success, pending = false) {
        if (!element) return;
        element.textContent = message;
        element.classList.toggle('is-success', success);
        element.classList.toggle('is-error', !success && !pending);
        element.classList.toggle('is-pending', pending);
    }

    function normaliseShapefile(value) {
        const collections = Array.isArray(value) ? value : [value];
        const features = collections.flatMap(item => normaliseGeoJson(item).features);
        return { type: 'FeatureCollection', features };
    }

    function getShpExtent(buffer) {
        if (buffer.byteLength < 68) throw new Error('فایل SHP ناقص یا نامعتبر است.');
        const view = new DataView(buffer);
        if (view.getInt32(0, false) !== 9994 || view.getInt32(28, true) !== 1000) {
            throw new Error('فایل SHP معتبر نیست.');
        }

        const xmin = view.getFloat64(36, true);
        const ymin = view.getFloat64(44, true);
        const xmax = view.getFloat64(52, true);
        const ymax = view.getFloat64(60, true);
        if (![xmin, ymin, xmax, ymax].every(Number.isFinite)
            || xmax <= xmin || ymax <= ymin) {
            throw new Error('فایل SHP محدوده معتبری ندارد.');
        }
        return { north: ymax, south: ymin, east: xmax, west: xmin };
    }

    function normaliseGeoJson(value) {
        if (!value || typeof value !== 'object') throw new Error('فایل GeoJSON معتبر نیست.');
        if (value.type === 'FeatureCollection') return value;
        if (value.type === 'Feature') return { type: 'FeatureCollection', features: [value] };
        if (value.type && value.coordinates) {
            return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: value }] };
        }
        throw new Error('فایل هندسه جغرافیایی معتبر نیست.');
    }

    function convertGeoJsonToWgs84(geojson) {
        const crsText = geojson.crs?.properties?.name
            || geojson.crs?.properties?.href
            || geojson.crs?.properties?.code
            || '';
        if (!crsText || /(?:EPSG[^0-9]*4326|CRS84)/i.test(crsText)) return geojson;
        const crsCodes = crsText.match(/\d+/g);
        const sourceCode = crsCodes?.[crsCodes.length - 1];
        if (!sourceCode || typeof proj4 !== 'function') {
            throw new Error(`سیستم مختصات «${crsText}» پشتیبانی نمی‌شود.`);
        }

        const sourceCrs = `EPSG:${sourceCode}`;
        const transformGeometry = geometry => {
            if (!geometry) return geometry;
            if (geometry.coordinates) {
                return { ...geometry, coordinates: transformCoordinates(geometry.coordinates) };
            }
            return { ...geometry, geometries: geometry.geometries?.map(transformGeometry) };
        };
        const transformCoordinates = coordinates => {
            if (!Array.isArray(coordinates)) return coordinates;
            if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
                const transformed = proj4(sourceCrs, 'EPSG:4326', coordinates.slice(0, 2));
                return coordinates.length > 2 ? [...transformed, ...coordinates.slice(2)] : transformed;
            }
            return coordinates.map(transformCoordinates);
        };

        return {
            ...geojson,
            crs: undefined,
            features: geojson.features.map(feature => ({
                ...feature,
                geometry: transformGeometry(feature.geometry),
            })),
        };
    }

    function parseKml(text) {
        if (!window.toGeoJSON?.kml) throw new Error('کتابخانه خواندن KML بارگذاری نشد.');
        const documentNode = new DOMParser().parseFromString(text, 'application/xml');
        if (documentNode.querySelector('parsererror')) throw new Error('فایل KML معتبر نیست.');
        return normaliseGeoJson(window.toGeoJSON.kml(documentNode));
    }

    async function parseKmz(file) {
        if (!window.JSZip) throw new Error('کتابخانه خواندن KMZ بارگذاری نشد.');
        const archive = await window.JSZip.loadAsync(await file.arrayBuffer());
        const kmlEntry = Object.values(archive.files).find(entry => entry.name.toLowerCase().endsWith('.kml'));
        if (!kmlEntry) throw new Error('فایل KMZ شامل KML نیست.');
        return parseKml(await kmlEntry.async('text'));
    }

    function getGeoJsonBounds(geojson) {
        const bounds = { north: -Infinity, south: Infinity, east: -Infinity, west: Infinity };
        const visit = coordinates => {
            if (!Array.isArray(coordinates)) return;
            if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
                const [lng, lat] = coordinates;
                if (Number.isFinite(lat) && Number.isFinite(lng)) {
                    bounds.north = Math.max(bounds.north, lat);
                    bounds.south = Math.min(bounds.south, lat);
                    bounds.east = Math.max(bounds.east, lng);
                    bounds.west = Math.min(bounds.west, lng);
                }
                return;
            }
            coordinates.forEach(visit);
        };
        geojson.features.forEach(feature => {
            const geometry = feature.geometry;
            if (geometry?.coordinates) visit(geometry.coordinates);
            (geometry?.geometries || []).forEach(child => visit(child.coordinates));
        });
        return Number.isFinite(bounds.north) && Number.isFinite(bounds.south)
            && Number.isFinite(bounds.east) && Number.isFinite(bounds.west)
            ? bounds : null;
    }

    /**
     * Execute search with current form values
     */
    function execute() {
        const parseCoordinate = (id) => {
            const value = parseFloat(document.getElementById(id).value);
            return Number.isFinite(value) ? value : null;
        };

        // Gather criteria
        const dateRange = JalaliDatePicker.getRange();
        const criteria = {
            north: parseCoordinate('North'),
            south: parseCoordinate('South'),
            east: parseCoordinate('East'),
            west: parseCoordinate('West'),
            dateFrom: dateRange.start,
            dateTo: dateRange.end,
            cloudMax: parseInt(document.getElementById('CloudCover').value),
            dataset: AppState.searchCriteria.dataset,
            bands: AppState.searchCriteria.bands || [],
            ghsYears: [...document.querySelectorAll('.ghs-year-checkbox:checked')].map(input => Number(input.value)),
            minmagnitude: parseOptionalNumber('eqMinMagnitude'), maxmagnitude: parseOptionalNumber('eqMaxMagnitude'),
            mindepth: parseOptionalNumber('eqMinDepth'), maxdepth: parseOptionalNumber('eqMaxDepth'),
            alertlevel: document.getElementById('eqAlertLevel')?.value || '',
            eventtype: document.getElementById('eqEventType')?.value || '',
            orderby: document.getElementById('eqOrderBy')?.value || '',
            usgsLimit: parseOptionalNumber('eqLimit'), usgsOffset: parseOptionalNumber('eqOffset'),
            catalog: document.getElementById('eqCatalog')?.value.trim() || '',
            contributor: document.getElementById('eqContributor')?.value.trim() || '',
            queryPairs: collectEarthquakeQueryPairs(),
        };

        function parseOptionalNumber(id) {
            const value = document.getElementById(id)?.value;
            return value === '' || value == null ? null : Number(value);
        }

        const isOsm = criteria.dataset === 'OSM';
        const isWeather = criteria.dataset === 'WTH';
        const isDem = criteria.dataset === 'DEM';
        const isOvt = criteria.dataset === 'OVT';
        const isEarthquake = criteria.dataset === 'USGS_EQ';
        const isGhs = criteria.dataset?.startsWith('GHS_');

        // Buildings query uses only the region - no dates or cloud filter
        if (isOvt) {
            criteria.dateFrom = null;
            criteria.dateTo = null;
            criteria.cloudMax = null;
        }


        // Validate coordinates
        if ([criteria.north, criteria.south, criteria.east, criteria.west].some(value => value === null)) {
            showToast('لطفاً محدوده جغرافیایی را مشخص کنید', 'warning');
            return;
        }

        if (criteria.north <= criteria.south) {
            showToast('عرض شمالی باید بزرگتر از عرض جنوبی باشد', 'error');
            return;
        }
        if (criteria.east <= criteria.west) {
            showToast('طول شرقی باید بزرگتر از طول غربی باشد', 'error');
            return;
        }

        // OSM dataset uses tag filters instead of dates
        if (isOsm) {
            const tags = OsmModule.collectPairs();
            if (tags.length === 0) {
                showToast('لطفاً حداقل یک جفت کلید-مقدار برای جستجوی OSM تعریف کنید', 'warning');
                return;
            }
            criteria.tags = tags;
            criteria.dateFrom = null;
            criteria.dateTo = null;
        } else if (isDem) {
            criteria.dateFrom = null;
            criteria.dateTo = null;
        } else if (isGhs) {
            criteria.dateFrom = null;
            criteria.dateTo = null;
            criteria.cloudMax = null;
            if (!criteria.ghsYears.length) {
                showToast('حداقل یک سال GHS را انتخاب کنید', 'warning');
                return;
            }
        } else if (isWeather) {
            // Weather stations always need a date range
            if (!criteria.dateFrom || !criteria.dateTo) {
                showToast('برای ایستگاه‌های هواشناسی، بازه زمانی الزامی است', 'warning');
                return;
            }
            if (criteria.dateFrom > criteria.dateTo) {
                showToast('تاریخ شروع باید قبل از تاریخ پایان باشد', 'error');
                return;
            }
        } else if (isEarthquake) {
            if (!criteria.dateFrom || !criteria.dateTo) {
                showToast('برای جستجوی زمین‌لرزه، بازه زمانی الزامی است', 'warning');
                return;
            }
            if (criteria.usgsLimit != null && (!Number.isInteger(criteria.usgsLimit) || criteria.usgsLimit < 1 || criteria.usgsLimit > 20000)) {
                showToast('حداکثر تعداد نتایج باید بین ۱ تا ۲۰۰۰۰ باشد', 'warning');
                return;
            }
        } else if (criteria.dateFrom && criteria.dateTo && criteria.dateFrom > criteria.dateTo) {
            showToast('تاریخ شروع باید قبل از تاریخ پایان باشد', 'error');
            return;
        }

        // Validate dataset
        if (!criteria.dataset) {
            showToast('لطفاً یک دیتاست انتخاب کنید', 'warning');
            return;
        }

        // Preserve the exact drawn polygon when it still matches the form
        // bounds. Otherwise use the four corners of the coordinate rectangle.
        const drawing = AppState.mapDrawings;
        const drawingMatchesBounds = drawing
            && ['north', 'south', 'east', 'west'].every(key =>
                Number.isFinite(drawing[key])
                && Math.abs(drawing[key] - criteria[key]) < 0.001
            );

        criteria.regionGeometry = drawingMatchesBounds
            && drawing.type === 'polygon'
            && Array.isArray(drawing.vertices)
            && drawing.vertices.length >= 3
            ? drawing.vertices.map(vertex => ({ lat: vertex.lat, lng: vertex.lng }))
            : [
                { lat: criteria.north, lng: criteria.west },
                { lat: criteria.north, lng: criteria.east },
                { lat: criteria.south, lng: criteria.east },
                { lat: criteria.south, lng: criteria.west },
            ];

        // Update app state
        AppState.searchCriteria = { ...AppState.searchCriteria, ...criteria };

        // Show loading
        setLoading(true);

        // Fit map to search bounds
        MapModule.fitBounds(criteria.north, criteria.south, criteria.east, criteria.west);

        // Call API
        return ApiService.search(criteria)
            .then(response => {
                setLoading(false);

                if (response.success) {
                    AppState.searchResults = response.data;
                    AppState.osmInfo = response.osm || null;
                    AppState.overtureInfo = response.overture || null;
                    AppState.weatherInfo = response.weather || null;
                    AppState.earthquakeInfo = response.earthquake || null;
                    AppState.demInfo = response.dem || null;
                    AppState.ghsInfo = response.ghs || null;

                    // Build params summary
                    const params = [];
                    if (criteria.dataset === 'OVT') {
                        params.push({ label: 'منبع', value: 'Overture Maps ساختمانها' });
                    }
                    if (criteria.dataset === 'USGS_EQ') params.push({ label: 'مرجع', value: 'USGS Earthquake Catalog' });
                    if (criteria.dateFrom) params.push({ label: 'از تاریخ', value: isoToJalaliString(criteria.dateFrom) });
                    if (criteria.dateTo && criteria.dateTo !== criteria.dateFrom) {
                        params.push({ label: 'تا تاریخ', value: isoToJalaliString(criteria.dateTo) });
                    }
                    if (!isOsm && !isDem && !isGhs && !isWeather && criteria.cloudMax != null) {
                        params.push({ label: 'حداکثر ابر', value: toPersianNum(criteria.cloudMax) + '٪' });
                    }
                    if (isGhs && criteria.ghsYears?.length) {
                        params.push({ label: 'سال‌های GHS', value: criteria.ghsYears.map(toPersianNum).join('، ') });
                    }
                    if (isOsm && criteria.tags) {
                        params.push({ label: 'تگها', value: criteria.tags.map(t => `${t.key}${t.value ? '=' + t.value : ''}${t.any ? ' (هر مقدار)' : ''}`).join(', ') });
                    }
                    setSummaryParams(params.length > 0 ? params : null);

                    // Set results summary
                    const total = response.total || (Array.isArray(response.data) ? response.data.length : 0);
                    setSummaryResults(total, AppState.selectedScenes ? AppState.selectedScenes.length : null, response.message);

                    EventBus.emit('search:completed', response);
                    showToast(response.message, 'success');

                    // Advance wizard to Results step (or directly to Process
                    // for OVT, which skips the results/query mechanism)
                    if (window.WizardNavigation) {
                        if (criteria.dataset === 'OVT') {
                            window.WizardNavigation.goToStep(5);
                        } else {
                            window.WizardNavigation.goToStep(4);
                        }
                    }
                } else {
                    showToast(response.message, 'error');
                }
            })
            .catch(error => {
                setLoading(false);
                showToast('خطا در ارتباط با سرور', 'error');
                console.error('Search error:', error);
            });
    }

    function scheduleAvailableDatesRefresh() {
        clearTimeout(availDebounceTimer);
        availDebounceTimer = setTimeout(refreshAvailableDates, 300);
    }

    /**
     * Fetch imagery availability for the currently visible calendar months
     * and current region + dataset, then highlight those days.
     */
    function refreshAvailableDates() {
        if (!lastVisibleWindow) return;
        const bounds = readFormBounds();
        const dataset = AppState.searchCriteria.dataset;
        if (!bounds || !dataset || !AVAILABLE_DATASETS.has(dataset)) return;

        const seq = ++availReqSeq;
        ApiService.fetchAvailableDates(
            bounds, dataset, lastVisibleWindow.start, lastVisibleWindow.end
        ).then(dates => {
            if (seq !== availReqSeq) return;   // a newer request superseded this one
            JalaliDatePicker.setAvailableDates(dates);
        });
    }

    function readFormBounds() {
        const parse = (id) => parseFloat(document.getElementById(id).value);
        const north = parse('North'), south = parse('South');
        const east = parse('East'), west = parse('West');
        if (![north, south, east, west].every(Number.isFinite)) return null;
        if (north <= south || east <= west) return null;
        return { north, south, east, west };
    }

    function addEarthquakeQueryPair() {
        const container = document.getElementById('earthquakeQueryPairs');
        if (!container) return;
        const row = document.createElement('div');
        row.className = 'row g-2 mb-2 earthquake-query-pair';
        row.innerHTML = '<div class="col-5"><input class="form-control form-control-sm eq-query-key" dir="ltr" placeholder="parameter"></div>'
            + '<div class="col-5"><input class="form-control form-control-sm eq-query-value" dir="ltr" placeholder="value"></div>'
            + '<div class="col-2"><button type="button" class="btn btn-outline-danger btn-sm w-100 eq-query-remove" title="حذف"><i class="bi bi-trash"></i></button></div>';
        row.querySelector('.eq-query-remove').addEventListener('click', () => row.remove());
        container.appendChild(row);
    }

    function collectEarthquakeQueryPairs() {
        return [...document.querySelectorAll('.earthquake-query-pair')].map(row => ({
            key: row.querySelector('.eq-query-key')?.value.trim(),
            value: row.querySelector('.eq-query-value')?.value.trim(),
        })).filter(pair => pair.key && pair.value);
    }

    return {
        init,
        execute,
        loadGhsYears,
    };
})();

// Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', SearchModule.init);
} else {
    SearchModule.init();
}
