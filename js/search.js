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

    let availReqSeq = 0;
    let availDebounceTimer = null;
    let lastVisibleWindow = null;

    function init() {
        const cloudSlider = document.getElementById('CloudCover');
        const cloudValue = document.getElementById('cloudCoverValue');
        const btnUseMap = document.getElementById('btnUseMapBounds');

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
                    if (!isOsm && !isDem && !isWeather && criteria.cloudMax != null) {
                        params.push({ label: 'حداکثر ابر', value: toPersianNum(criteria.cloudMax) + '٪' });
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
    };
})();

// Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', SearchModule.init);
} else {
    SearchModule.init();
}
