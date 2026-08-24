/**
 * Shahrkavi - Search Tab Module
 * Handles the search form UI, validation, and orchestrates search execution
 */

const SearchModule = (() => {
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

        // Listen for map drawing events to auto-fill coordinates
        EventBus.on('map:drawing:created', (coords) => {
            if (coords && coords.type !== 'point') {
                document.getElementById('North').value = coords.north.toFixed(4);
                document.getElementById('South').value = coords.south.toFixed(4);
                document.getElementById('East').value = coords.east.toFixed(4);
                document.getElementById('West').value = coords.west.toFixed(4);
            }
        });

        // Set default dates
        const today = new Date();
        const sixMonthsAgo = new Date(today);
        sixMonthsAgo.setMonth(today.getMonth() - 6);

        document.getElementById('DateTo').value = today.toISOString().split('T')[0];
        document.getElementById('DateFrom').value = sixMonthsAgo.toISOString().split('T')[0];

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
        const criteria = {
            north: parseCoordinate('North'),
            south: parseCoordinate('South'),
            east: parseCoordinate('East'),
            west: parseCoordinate('West'),
            dateFrom: document.getElementById('DateFrom').value || null,
            dateTo: document.getElementById('DateTo').value || null,
            cloudMax: parseInt(document.getElementById('CloudCover').value),
            dataset: AppState.searchCriteria.dataset,
            bands: AppState.searchCriteria.bands || [],
        };

        const isOsm = criteria.dataset === 'OSM';
        const isWeather = criteria.dataset === 'WTH';
        const isDem = criteria.dataset === 'DEM';

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
        ApiService.search(criteria)
            .then(response => {
                setLoading(false);

                if (response.success) {
                    AppState.searchResults = response.data;
                    AppState.osmInfo = response.osm || null;
                    AppState.weatherInfo = response.weather || null;
                    AppState.demInfo = response.dem || null;

                    // Build params summary
                    const params = [];
                    if (criteria.dateFrom) params.push({ label: 'از تاریخ', value: criteria.dateFrom });
                    if (criteria.dateTo) params.push({ label: 'تا تاریخ', value: criteria.dateTo });
                    if (!isOsm && !isDem && !isWeather && criteria.cloudMax != null) {
                        params.push({ label: 'حداکثر ابر', value: toPersianNum(criteria.cloudMax) + '٪' });
                    }
                    if (isOsm && criteria.tags) {
                        params.push({ label: 'تگها', value: criteria.tags.map(([k,v]) => `${k}=${v}`).join(', ') });
                    }
                    setSummaryParams(params.length > 0 ? params : null);

                    // Set results summary
                    const total = response.total || (Array.isArray(response.data) ? response.data.length : 0);
                    setSummaryResults(total, AppState.selectedScenes ? AppState.selectedScenes.length : null, response.message);

                    EventBus.emit('search:completed', response);
                    showToast(response.message, 'success');

                    // Advance wizard to Results step
                    if (window.WizardNavigation) {
                        window.WizardNavigation.goToStep(4);
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
