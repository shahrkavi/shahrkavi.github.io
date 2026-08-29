/**
 * Shahrkavi - Results Tab Module
 * Paginated results table with thumbnails, metadata, and download/cart actions
 */

const ResultsModule = (() => {
    const RESULTS_PER_PAGE = 10;
    let currentPage = 1;
    let currentResults = [];
    let allResults = [];
    let earthquakeMarkers = new Map();

    function init() {
        // Listen for search completion
        EventBus.on('search:completed', onCompleted);

        // Cart updates
        EventBus.on('cart:updated', onCartUpdated);

        // Cart button click - download all cart items as a ZIP file
        const btnCart = document.getElementById('btnCart');
        if (btnCart) {
            btnCart.addEventListener('click', () => {
                withButtonLoading(btnCart, downloadCart, 'در حال آماده‌سازی...');
            });
        }

        EventBus.on('tab:changed', (tab) => {
            if (tab === 'results') {
                if (isOsmMode() && AppState.osmInfo) renderResults();
                else if (isWeatherMode() && AppState.weatherInfo) renderResults();
                else if (isEarthquakeMode() && AppState.earthquakeInfo) renderResults();
                else if (isDemMode() && AppState.demInfo) renderResults();
                else if (allResults.length > 0) renderResults();
            }
        });

        console.log('Results module initialized');
    }

    function isOsmMode() {
        return (AppState.searchCriteria.dataset || '') === 'OSM';
    }

    function isWeatherMode() {
        return (AppState.searchCriteria.dataset || '') === 'WTH';
    }

    function isDemMode() {
        return (AppState.searchCriteria.dataset || '') === 'DEM';
    }

    function isEarthquakeMode() {
        return (AppState.searchCriteria.dataset || '') === 'USGS_EQ';
    }

    function isOvtMode() {
        return (AppState.searchCriteria.dataset || '') === 'OVT';
    }

    function onCompleted(response) {
        allResults = Array.isArray(response.data) ? response.data : [];
        const total = response.total || allResults.length;

        if (isOvtMode()) {
            renderOvtResults();
            return;
        }

        if (isWeatherMode()) {
            currentResults = [];
            currentPage = 1;
            AppState.selectedScenes = [];
            AppState.selectedScene = null;
            setSummaryResults(total, 0, response.message);
            renderResults();
            return;
        }

        if (isEarthquakeMode()) {
            currentResults = [];
            currentPage = 1;
            AppState.selectedScenes = [];
            AppState.selectedScene = null;
            setSummaryResults(total, 0, response.message);
            renderResults();
            return;
        }

        if (isOsmMode()) {
            currentResults = allResults.slice();
            currentPage = 1;
            AppState.selectedScenes = [];
            AppState.selectedScene = null;
            // Default: every OSM layer is selected so it can be sent to the
            // process tab for format conversion.
            const layers = (AppState.osmInfo && AppState.osmInfo.layers) || [];
            AppState.selectedOsmLayers = layers.map(l => l.name);
            setSummaryResults(total, layers.length, response.message);
            renderResults();
            return;
        }

        if (isDemMode()) {
            currentResults = allResults.slice();
            currentPage = 1;
            AppState.selectedScenes = [];
            AppState.selectedScene = null;
            setSummaryResults(total, 0, response.message);
            renderResults();
            return;
        }

        // Show all results, newest first (no date grouping)
        allResults.sort((a, b) => new Date(b.date) - new Date(a.date));
        currentResults = allResults.slice();
        currentPage = 1;
        // Nothing is selected by default; the user picks images explicitly
        AppState.processSelectionInitialized = false;
        AppState.selectedScenes = [];
        AppState.selectedScene = null;
        updateSelectionSummary();
        renderResults();
    }

    function onCartUpdated(cart) {
        // Refresh the current page of the table to update cart button states
        if (currentResults.length > 0) {
            const startIdx = (currentPage - 1) * RESULTS_PER_PAGE;
            const pageItems = currentResults.slice(startIdx, startIdx + RESULTS_PER_PAGE);
            renderTable(pageItems);
            renderPagination();
        }
    }

    /**
     * Render the full results panel
     */
    function renderResults() {
        if (isOsmMode()) {
            renderOsmResults();
            return;
        }

        if (isWeatherMode()) {
            renderWeatherResults();
            return;
        }

        if (isEarthquakeMode()) {
            renderEarthquakeResults();
            return;
        }

        if (isDemMode()) {
            renderDemResults();
            return;
        }

        renderCloudAverage();

        // Restore scene-oriented controls
        const dateFilterRow = document.getElementById('dateFilterRow');
        const osmSummary = document.getElementById('osmResultsSummary');
        const btnGoProcess = document.getElementById('btnGoProcess');
        if (dateFilterRow) dateFilterRow.classList.remove('d-none');
        if (osmSummary) osmSummary.classList.add('d-none');
        if (btnGoProcess) {
            btnGoProcess.style.display = '';
            btnGoProcess.innerHTML = '<i class="bi bi-gear"></i> پردازش تصویر';
        }
        restoreSceneTableHeader();

        // Update count
        const countEl = document.getElementById('resultsCount');
        if (countEl) {
            countEl.textContent = `${toPersianNum(currentResults.length)} نتیجه یافت شد`;
        }

        // Update badge on tab
        const badge = document.getElementById('resultsBadge');
        if (badge) {
            badge.textContent = toPersianNum(currentResults.length);
            badge.style.display = currentResults.length > 0 ? 'inline' : 'none';
        }

        // Render table
        const startIdx = (currentPage - 1) * RESULTS_PER_PAGE;
        const endIdx = startIdx + RESULTS_PER_PAGE;
        const pageItems = currentResults.slice(startIdx, endIdx);

        renderTable(pageItems);
        renderPagination();
        updateSelectionSummary();

        // Show footprints on map
        showFootprintsOnMap(pageItems);
    }

    function renderCloudAverage() {
        const averageEl = document.getElementById('resultsCloudAverage');
        if (!averageEl) return;

        if (currentResults.length === 0) {
            averageEl.textContent = 'میانگین پوشش ابر: ---';
            return;
        }

        const average = currentResults.reduce((sum, item) => sum + Number(item.cloudCover || 0), 0) / currentResults.length;
        averageEl.textContent = `میانگین پوشش ابر: ${toPersianNum(average.toFixed(1))}٪`;
    }

    // === OSM results rendering ===

    const OSM_TYPE_LABELS = { point: 'نقطه', polyline: 'پلی‌خط', polygon: 'چندضلعی' };
    const OSM_TYPES = ['point', 'polyline', 'polygon'];
    const OSM_DOWNLOAD_LIMIT = 1000;

    function renderOsmResults() {
        MapModule.clearUserLayers();
        MapModule.hideGeoJsonOverlay();

        const osm = AppState.osmInfo || {};
        const layers = Array.isArray(osm.layers) ? osm.layers : [];
        const totalCount = Number.isFinite(osm.count)
            ? osm.count
            : layers.reduce((sum, l) => sum + (l.total || 0), 0);

        // Count
        const countEl = document.getElementById('resultsCount');
        if (countEl) {
            countEl.textContent = `${toPersianNum(totalCount)} عنصر یافت شد`;
        }
        const badge = document.getElementById('resultsBadge');
        if (badge) {
            badge.textContent = toPersianNum(totalCount);
            badge.style.display = totalCount > 0 ? 'inline' : 'none';
        }

        // Hide scene-oriented controls, show the OSM summary. The process
        // button and the selection counter are kept for OSM layers.
        const dateFilterRow = document.getElementById('dateFilterRow');
        const osmSummary = document.getElementById('osmResultsSummary');
        const btnGoProcess = document.getElementById('btnGoProcess');
        const selectionCount = document.getElementById('resultsSelectionCount');
        if (dateFilterRow) dateFilterRow.classList.add('d-none');
        if (osmSummary) osmSummary.classList.remove('d-none');
        if (btnGoProcess) {
            btnGoProcess.style.display = '';
            btnGoProcess.innerHTML = '<i class="bi bi-layers"></i> پردازش لایه‌ها';
        }
        if (selectionCount) selectionCount.style.display = 'inline';
        updateOsmSelectionUI();

        // Summary note + overall download link
        const note = document.getElementById('osmResultsNote');
        const filters = (AppState.searchCriteria.tags || [])
            .map(t => `<code>${t.key}${t.any ? '' : '=' + t.value}</code>`)
            .join('، ');
        if (note) {
            note.innerHTML = `عبارت جستجو: ${filters || '—'} | تعداد کل: ${toPersianNum(totalCount)} عنصر` +
                (osm.truncated ? '<br><span class="text-warning"><i class="bi bi-exclamation-triangle"></i> نتایج بیش از حد مجاز است؛ فقط بخشی نمایش داده می‌شود. برای دریافت کامل از دکمه دانلود استفاده کنید.</span>' : '');
        }

        setOsmTableHeader();
        renderOsmLayersTable(layers);

        // Layer table is a compact summary - no pagination
        const paginationNav = document.getElementById('resultsPagination');
        if (paginationNav) paginationNav.style.display = 'none';
    }

    function setOsmTableHeader() {
        const thead = document.querySelector('#resultsTable thead');
        if (!thead) return;
        thead.innerHTML = `
            <tr>
                <th class="col-select">
                    <input class="form-check-input" type="checkbox" id="osmSelectAll"
                           title="انتخاب همه لایه‌ها">
                </th>
                <th>نام لایه</th>
                <th>تعداد</th>
                <th>دانلود</th>
                <th class="text-center">پیش‌نمایش</th>
            </tr>
        `;
    }

    function restoreSceneTableHeader() {
        const thead = document.querySelector('#resultsTable thead');
        if (!thead) return;
        thead.innerHTML = `
            <tr>
                <th class="col-select">
                    <input class="form-check-input" type="checkbox" id="resultSelectPage"
                           title="انتخاب تصاویر این صفحه">
                </th>
                <th>شناسه تصویر</th>
                <th>تاریخ</th>
                <th>ابر / پوشش</th>
                <th>عملیات</th>
            </tr>
        `;
    }

    function renderOsmLayersTable(layers) {
        const tbody = document.getElementById('resultsTableBody');
        if (!tbody) return;

        if (layers.length === 0) {
            tbody.innerHTML = `
                <tr class="results-empty">
                    <td colspan="5" class="text-center text-muted py-4">
                        <i class="bi bi-inbox" style="font-size:2rem"></i>
                        <p class="mt-2">لایه‌ای با این فیلترها یافت نشد</p>
                        <small>کلیدها و مقادیر را بررسی کنید</small>
                    </td>
                </tr>
            `;
            syncOsmSelectAll(layers);
            return;
        }

        const selected = new Set(AppState.selectedOsmLayers || []);

        tbody.innerHTML = layers.map(layer => {
            const total = layer.total || 0;
            const dlUrl = layer.download_url || '';
            const needsProcess = layer.downloadable === false || total > OSM_DOWNLOAD_LIMIT;
            const dlBtn = dlUrl
                ? (needsProcess
                    ? `<button type="button" class="btn btn-sm btn-outline-secondary" disabled
                            title="تعداد عناصر بیش از حد مجاز برای دانلود مستقیم؛ از پردازش استفاده کنید">
                            <i class="bi bi-gear"></i> پردازش
                        </button>`
                    : `<a href="${escapeHtml(dlUrl)}" download class="btn btn-sm btn-outline-primary">
                           <i class="bi bi-download"></i> دانلود
                       </a>`)
                : '<span class="text-muted small">—</span>';

            const typeChips = OSM_TYPES
                .filter(type => (layer.counts && layer.counts[type]) > 0)
                .map(type => {
                    const count = layer.counts[type];
                    return `
                        <span class="osm-type-chip" title="${OSM_TYPE_LABELS[type]}: ${toPersianNum(count)}">
                            ${osmTypeIcon(type)}
                            <span class="small">${toPersianNum(count)}</span>
                        </span>
                    `;
                })
                .join('');

            return `
                <tr data-osm-layer="${escapeHtml(layer.name)}" class="${selected.has(layer.name) ? 'row-selected' : ''}">
                    <td class="col-select">
                        <input class="form-check-input osm-layer-checkbox" type="checkbox"
                               value="${escapeHtml(layer.name)}" aria-label="انتخاب ${escapeHtml(layer.name)}"
                               ${selected.has(layer.name) ? 'checked' : ''}>
                    </td>
                    <td><span class="fw-medium" dir="ltr">${escapeHtml(layer.name)}</span></td>
                    <td class="text-nowrap">
                        ${typeChips
                            ? `<div class="d-flex flex-wrap gap-2">${typeChips}</div>`
                            : '<span class="text-muted small">—</span>'}                    
                    </td>
                    <td>${dlBtn}</td>
                    <td class="text-center">
                        <button type="button" class="btn btn-sm btn-outline-primary btn-action btn-osm-preview"
                                data-layer="${escapeHtml(layer.name)}" title="پیش‌نمایش لایه روی نقشه">
                            <i class="bi bi-eye"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        // Preview buttons: one layer preview on the map at a time
        tbody.querySelectorAll('.btn-osm-preview').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleOsmLayerPreview(btn);
            });
        });
        syncOsmPreviewButtons();

        // Row checkboxes drive the layer selection
        tbody.querySelectorAll('.osm-layer-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                const names = new Set(AppState.selectedOsmLayers || []);
                if (checkbox.checked) names.add(checkbox.value);
                else names.delete(checkbox.value);
                updateOsmLayerSelection([...names]);
                checkbox.closest('tr').classList.toggle('row-selected', checkbox.checked);
                syncOsmSelectAll(layers);
            });
        });

        // Clicking a row toggles its selection
        tbody.querySelectorAll('tr[data-osm-layer]').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('button, input, a')) return;
                const checkbox = row.querySelector('.osm-layer-checkbox');
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            });
            row.style.cursor = 'pointer';
        });

        syncOsmSelectAll(layers);
    }

    /**
     * Toggle a single OSM layer feature preview on the map. Fetches the
     * layer's GeoJSON (capped by the server) and draws it; only one layer
     * preview is visible at a time.
     */
    async function toggleOsmLayerPreview(btn) {
        const name = btn.dataset.layer;
        const layers = (AppState.osmInfo && AppState.osmInfo.layers) || [];
        const layer = layers.find(l => l.name === name);

        // Clicking the active layer's button removes its preview
        if (MapModule.getActiveGeoJsonId() === name) {
            MapModule.hideGeoJsonOverlay();
            syncOsmPreviewButtons();
            return;
        }

        if (!layer || !layer.download_url) {
            showToast('آدرس پیش‌نمایش این لایه در دسترس نیست', 'warning');
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        try {
            const url = layer.download_url.startsWith('/')
                ? API_BASE + layer.download_url
                : layer.download_url;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const geojson = await res.json();
            if (!geojson.features || geojson.features.length === 0) {
                showToast('عنصری برای پیش‌نمایش این لایه یافت نشد', 'info');
                return;
            }
            // Replaces any previously shown preview -> only one at a time
            MapModule.showGeoJsonOverlay(name, geojson);
        } catch (error) {
            console.error('OSM preview error:', error);
            showToast('خطا در دریافت پیش‌نمایش لایه', 'error');
        } finally {
            btn.disabled = false;
            syncOsmPreviewButtons();
        }
    }

    /** Reflect which layer (if any) is currently previewed on the buttons */
    function syncOsmPreviewButtons() {
        const activeId = MapModule.getActiveGeoJsonId();
        document.querySelectorAll('#resultsTableBody .btn-osm-preview').forEach(btn => {
            const active = btn.dataset.layer === activeId;
            btn.classList.toggle('btn-primary', active);
            btn.classList.toggle('btn-outline-primary', !active);
            btn.title = active ? 'حذف پیش‌نمایش از نقشه' : 'پیش‌نمایش لایه روی نقشه';
            btn.innerHTML = active ? '<i class="bi bi-eye-slash"></i>' : '<i class="bi bi-eye"></i>';
        });
    }

    // === Overture Maps buildings results rendering ===

    const OVT_TABLE_ROW_LIMIT = 200;
    let ovtPreviewAbort = null;

    function ovtParams(limit) {
        const c = AppState.searchCriteria;
        return new URLSearchParams({
            north: c.north, south: c.south, east: c.east, west: c.west,
            limit: limit || 5000,
        });
    }

    function renderOvtResults() {
        MapModule.clearUserLayers();
        MapModule.clearImageOverlays();
        MapModule.hideGeoJsonOverlay();

        const ovt = AppState.overtureInfo || {};
        const totalCount = Number.isFinite(ovt.total) ? ovt.total : 0;

        // Count + badge
        const countEl = document.getElementById('resultsCount');
        if (countEl) countEl.textContent = `${toPersianNum(totalCount)} ساختمان یافت شد`;
        const badge = document.getElementById('resultsBadge');
        if (badge) {
            badge.textContent = toPersianNum(totalCount);
            badge.style.display = totalCount > 0 ? 'inline' : 'none';
        }

        // Toggle header controls
        const dateFilterRow = document.getElementById('dateFilterRow');
        const osmSummary = document.getElementById('osmResultsSummary');
        const ovtSummary = document.getElementById('ovtResultsSummary');
        const selectionCount = document.getElementById('resultsSelectionCount');
        if (dateFilterRow) dateFilterRow.classList.add('d-none');
        if (osmSummary) osmSummary.classList.add('d-none');
        if (ovtSummary) ovtSummary.classList.remove('d-none');
        if (selectionCount) selectionCount.style.display = 'none';

        const btnGoProcess = document.getElementById('btnGoProcess');
        if (btnGoProcess) {
            btnGoProcess.disabled = false;
            btnGoProcess.innerHTML = '<i class="bi bi-gear"></i> تبدیل و دانلود';
        }
        AppState.selectedScenes = [];

        // Summary note + download link
        const note = document.getElementById('ovtResultsNote');
        if (note) {
            note.innerHTML =
                `منبع: Overture Maps ساختمانها | تعداد کل: ${toPersianNum(totalCount)} ساختمان` +
                (ovt.truncated
                    ? '<br><span class="text-warning"><i class="bi bi-exclamation-triangle"></i> نتایج بیش از حد مجاز است؛ فقط بخشی نمایش داده می‌شود. برای دریافت کامل از دکمه دانلود استفاده کنید.</span>'
                    : '');
        }
        const dl = document.getElementById('btnOvtDownloadGeojson');
        if (dl) {
            dl.onclick = (e) => {
                e.preventDefault();
                withButtonLoading(dl, () =>
                    fetchAndDownload(`${API_BASE}/overture/buildings/download?${ovtParams(50000)}`, 'overture_buildings.geojson'),
                    'در حال دانلود...'
                );
            };
        }
        const btnPreview = document.getElementById('btnOvtPreview');
        if (btnPreview) {
            btnPreview.onclick = () => previewOvtBuildings(btnPreview);
        }

        setOvtTableHeader();
        renderOvtTable([]);

        // Layer table is a compact summary - no pagination
        const paginationNav = document.getElementById('resultsPagination');
        if (paginationNav) paginationNav.style.display = 'none';
    }

    /** Fetch buildings GeoJSON, draw them on the map and fill the table */
    async function previewOvtBuildings(btn) {
        if (ovtPreviewAbort) ovtPreviewAbort.abort();
        ovtPreviewAbort = new AbortController();

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> در حال دریافت...';
        try {
            const res = await fetch(`${API_BASE}/overture/buildings/geojson?${ovtParams(5000)}`,
                { signal: ovtPreviewAbort.signal });
            if (!res.ok) throw new Error(`Server error: ${res.status}`);
            const fc = await res.json();
            const features = Array.isArray(fc.features) ? fc.features : [];
            if (features.length === 0) {
                showToast('ساختمانی برای نمایش یافت نشد', 'info');
                return;
            }
            MapModule.showGeoJsonOverlay('ovt-buildings', fc);
            AppState.searchResults = features;   // keep for potential reuse
            renderOvtTable(features.slice(0, OVT_TABLE_ROW_LIMIT));
            showToast(`${toPersianNum(features.length)} ساختمان روی نقشه نمایش داده شد`, 'success');
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Overture preview error:', error);
                showToast('خطا در دریافت ساختمانهای Overture', 'error');
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-map"></i> نمایش روی نقشه';
        }
    }

    function setOvtTableHeader() {
        const thead = document.querySelector('#resultsTable thead');
        if (!thead) return;
        thead.innerHTML = `
            <tr>
                <th>#</th>
                <th>نام</th>
                <th>کلاس</th>
                <th>ارتفاع (متر)</th>
                <th>طبقات</th>
            </tr>
        `;
    }

    function renderOvtTable(features) {
        const tbody = document.getElementById('resultsTableBody');
        if (!tbody) return;

        if (!features || features.length === 0) {
            tbody.innerHTML = `
                <tr class="results-empty">
                    <td colspan="5" class="text-center text-muted py-4">
                        <i class="bi bi-map" style="font-size:2rem"></i>
                        <p class="mt-2">برای مشاهده فهرست ساختمانها، دکمه «نمایش روی نقشه» را بزنید</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = features.map((f, i) => {
            const p = f.properties || {};
            return `
                <tr>
                    <td>${toPersianNum(i + 1)}</td>
                    <td>${p.name ? escapeHtml(p.name) : '<span class="text-muted">—</span>'}</td>
                    <td dir="ltr">${p.class ? escapeHtml(p.class) : '<span class="text-muted">—</span>'}</td>
                    <td>${Number.isFinite(p.height) ? toPersianNum(Math.round(p.height)) : '<span class="text-muted">—</span>'}</td>
                    <td>${Number.isFinite(p.num_floors) ? toPersianNum(p.num_floors) : '<span class="text-muted">—</span>'}</td>
                </tr>
            `;
        }).join('');
    }

    function updateOsmLayerSelection(names) {
        const valid = new Set(((AppState.osmInfo && AppState.osmInfo.layers) || []).map(l => l.name));
        AppState.selectedOsmLayers = names.filter(n => valid.has(n));
        updateOsmSelectionUI();
    }

    function updateOsmSelectionUI() {
        const count = (AppState.selectedOsmLayers || []).length;
        const selectionCount = document.getElementById('resultsSelectionCount');
        if (selectionCount) {
            selectionCount.textContent = `${toPersianNum(count)} لایه انتخاب شده`;
        }
        const btnGoProcess = document.getElementById('btnGoProcess');
        if (btnGoProcess) {
            btnGoProcess.disabled = count === 0;
        }
    }

    function syncOsmSelectAll(layers) {
        const selectAll = document.getElementById('osmSelectAll');
        if (!selectAll) return;
        if (!layers || layers.length === 0) {
            selectAll.checked = false;
            selectAll.disabled = true;
            return;
        }
        const selected = new Set(AppState.selectedOsmLayers || []);
        selectAll.checked = layers.every(l => selected.has(l.name));
        selectAll.disabled = false;
        selectAll.onchange = () => {
            const names = new Set(AppState.selectedOsmLayers || []);
            layers.forEach(l => {
                if (selectAll.checked) names.add(l.name);
                else names.delete(l.name);
            });
            updateOsmLayerSelection([...names]);
            renderOsmLayersTable(layers);
        };
    }

    function osmTypeIcon(type) {
        const icons = {
            point: '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7.5" cy="7.5" r="3.4"/></svg>',
            polyline: '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12 L5.5 3.5 L12.5 10"/></svg>',
            polygon: '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M7.5 1.5 L13 4.8 V11.2 L7.5 14.5 L2 11.2 V4.8 Z"/></svg>',
        };
        return icons[type] || '';
    }

    // === Weather stations results rendering ===

    function renderWeatherResults() {
        MapModule.clearUserLayers();

        const weather = AppState.weatherInfo || {};
        const stations = Array.isArray(weather.stations) ? weather.stations : [];
        const totalCount = stations.length;

        const countEl = document.getElementById('resultsCount');
        if (countEl) {
            countEl.textContent = `${toPersianNum(totalCount)} ایستگاه هواشناسی یافت شد`;
        }
        const badge = document.getElementById('resultsBadge');
        if (badge) {
            badge.textContent = toPersianNum(totalCount);
            badge.style.display = totalCount > 0 ? 'inline' : 'none';
        }

        // Hide scene-oriented controls; the process step does not apply here.
        const dateFilterRow = document.getElementById('dateFilterRow');
        const osmSummary = document.getElementById('osmResultsSummary');
        const btnGoProcess = document.getElementById('btnGoProcess');
        const selectionCount = document.getElementById('resultsSelectionCount');
        if (dateFilterRow) dateFilterRow.classList.add('d-none');
        if (osmSummary) osmSummary.classList.add('d-none');
        if (btnGoProcess) btnGoProcess.style.display = 'none';
        if (selectionCount) selectionCount.style.display = 'none';

        const paginationNav = document.getElementById('resultsPagination');
        if (paginationNav) paginationNav.style.display = 'none';

        setWeatherTableHeader();
        renderWeatherTable(stations);

        // Show each station as a marker on the map
        stations.forEach(station => {
            if (Number.isFinite(station.latitude) && Number.isFinite(station.longitude)) {
                MapModule.showStation(
                    station.latitude,
                    station.longitude,
                    '#dc3545',
                    station.name || station.id
                );
            }
        });
    }

    // === USGS earthquake results ===
    function renderEarthquakeResults() {
        MapModule.clearUserLayers();
        earthquakeMarkers = new Map();
        const info = AppState.earthquakeInfo || {};
        const features = Array.isArray(info.features) ? info.features : [];
        const countEl = document.getElementById('resultsCount');
        if (countEl) countEl.textContent = `${toPersianNum(features.length)} رویداد زمین‌لرزه یافت شد`;
        const badge = document.getElementById('resultsBadge');
        if (badge) {
            badge.textContent = toPersianNum(features.length);
            badge.style.display = features.length ? 'inline' : 'none';
        }

        document.getElementById('dateFilterRow')?.classList.add('d-none');
        document.getElementById('osmResultsSummary')?.classList.add('d-none');
        const selectionCount = document.getElementById('resultsSelectionCount');
        if (selectionCount) selectionCount.style.display = 'none';
        const btnGoProcess = document.getElementById('btnGoProcess');
        if (btnGoProcess) {
            btnGoProcess.style.display = '';
            btnGoProcess.disabled = features.length === 0;
            btnGoProcess.innerHTML = '<i class="bi bi-download"></i> ادامه به دانلود';
        }

        setEarthquakeTableHeader();
        renderEarthquakeTable(features);
        const paginationNav = document.getElementById('resultsPagination');
        if (paginationNav) paginationNav.style.display = 'none';
    }

    function setEarthquakeTableHeader() {
        const thead = document.querySelector('#resultsTable thead');
        if (!thead) return;
        thead.innerHTML = `<tr><th>بزرگی</th><th>زمان</th><th>مکان</th><th>عمق</th><th>مختصات</th><th>وضعیت</th></tr>`;
    }

    function renderEarthquakeTable(features) {
        const tbody = document.getElementById('resultsTableBody');
        if (!tbody) return;
        if (!features.length) {
            tbody.innerHTML = '<tr class="results-empty"><td colspan="6" class="text-center text-muted py-4"><i class="bi bi-inbox" style="font-size:2rem"></i><p class="mt-2">رویدادی یافت نشد</p><small>فیلترها یا بازه زمانی را بررسی کنید</small></td></tr>';
            return;
        }
        tbody.innerHTML = features.map(feature => {
            const p = feature.properties || {};
            const coords = feature.geometry?.coordinates || [];
            const magnitude = Number(p.mag);
            const eventDate = p.time ? new Date(Number(p.time)) : null;
            const dateText = eventDate && !Number.isNaN(eventDate.getTime()) ? toPersianDate(eventDate.toISOString()) : '---';
            const timeText = eventDate && !Number.isNaN(eventDate.getTime()) ? eventDate.toISOString().slice(11, 19) : '---';
            const place = escapeHtml(p.place || p.title || '---');
            const depth = Number.isFinite(Number(coords[2])) ? `${toPersianNum(Number(coords[2]).toFixed(1))} km` : '---';
            const coordinateText = coords.length >= 2 ? `${Number(coords[1]).toFixed(4)}, ${Number(coords[0]).toFixed(4)}` : '---';
            const eventId = escapeHtml(feature.id || `event-${features.indexOf(feature)}`);
            return `<tr data-earthquake-id="${eventId}"><td class="fw-bold">${Number.isFinite(magnitude) ? toPersianNum(magnitude.toFixed(1)) : '---'}</td><td class="text-nowrap">${dateText}<small class="text-muted d-block" dir="ltr">${timeText} UTC</small></td><td>${place}</td><td class="text-nowrap">${depth}</td><td dir="ltr">${coordinateText}</td><td>${escapeHtml(p.status || '---')}</td></tr>`;
        }).join('');

        features.forEach((feature, index) => {
            const coords = feature.geometry?.coordinates || [];
            if (coords.length < 2) return;
            const magnitude = Number(feature.properties?.mag);
            const color = magnitude >= 6 ? '#dc3545' : magnitude >= 4 ? '#fd7e14' : '#ffc107';
            const radius = Number.isFinite(magnitude) ? Math.max(2, Math.min(10, 3 + magnitude)) : 3;
            const marker = MapModule.showStation(coords[1], coords[0], color, feature.properties?.place || feature.properties?.title || 'زلزله', { radius });
            earthquakeMarkers.set(String(feature.id || `event-${index}`), { marker, radius, color });
        });

        tbody.querySelectorAll('tr[data-earthquake-id]').forEach(row => {
            const eventId = row.dataset.earthquakeId;
            row.addEventListener('mouseenter', () => highlightEarthquakeMarker(eventId));
            row.addEventListener('mouseleave', clearEarthquakeMarkerHighlight);
        });
    }

    function highlightEarthquakeMarker(eventId) {
        earthquakeMarkers.forEach(({ marker, radius, color }) => {
            const selected = marker === earthquakeMarkers.get(eventId)?.marker;
            marker.setStyle({
                color: selected ? '#212529' : '#fff',
                weight: selected ? 3 : 2,
                fillColor: color,
                fillOpacity: selected ? 1 : 0.72,
            });
            marker.setRadius(selected ? radius + 5 : radius);
            if (selected) marker.bringToFront();
        });
    }

    function clearEarthquakeMarkerHighlight() {
        earthquakeMarkers.forEach(({ marker, radius }) => {
            marker.setStyle({ color: '#fff', weight: 2, fillOpacity: 0.9 });
            marker.setRadius(radius);
        });
    }

    // === DEM results rendering ===

    function renderDemResults() {
        MapModule.clearUserLayers();

        const dem = AppState.demInfo || {};
        const tiles = Array.isArray(dem.tiles) ? dem.tiles : [];

        const countEl = document.getElementById('resultsCount');
        if (countEl) {
            countEl.textContent = `${toPersianNum(tiles.length)} کاشی DEM یافت شد`;
        }
        const badge = document.getElementById('resultsBadge');
        if (badge) {
            badge.textContent = toPersianNum(tiles.length);
            badge.style.display = tiles.length > 0 ? 'inline' : 'none';
        }

        // Hide scene-oriented controls
        const dateFilterRow = document.getElementById('dateFilterRow');
        const osmSummary = document.getElementById('osmResultsSummary');
        const btnGoProcess = document.getElementById('btnGoProcess');
        const selectionCount = document.getElementById('resultsSelectionCount');
        if (dateFilterRow) dateFilterRow.classList.add('d-none');
        if (osmSummary) osmSummary.classList.add('d-none');
        if (btnGoProcess) {
            btnGoProcess.style.display = '';
            btnGoProcess.innerHTML = '<i class="bi bi-gear"></i> پردازش DEM';
        }
        if (selectionCount) selectionCount.style.display = 'inline';
        updateSelectionSummary();

        setDemTableHeader();
        renderDemTable(tiles);

        // Show tile footprints on map (normalized so selection highlight works)
        const mappedTiles = [];
        tiles.forEach(tile => {
            if (tile.bbox && tile.bbox.length >= 4) {
                const [w, s, e, n] = tile.bbox;
                mappedTiles.push({
                    id: tile.id,
                    footprint: [
                        { lat: n, lng: w },
                        { lat: n, lng: e },
                        { lat: s, lng: e },
                        { lat: s, lng: w },
                    ],
                    baseColor: '#2ecc71',
                });
            }
        });
        showFootprintsOnMap(mappedTiles);

        const paginationNav = document.getElementById('resultsPagination');
        if (paginationNav) paginationNav.style.display = 'none';
    }

    function setDemTableHeader() {
        const thead = document.querySelector('#resultsTable thead');
        if (!thead) return;
        thead.innerHTML = `
            <tr>
                <th class="col-select">
                    <input class="form-check-input" type="checkbox" id="demSelectAll"
                           title="انتخاب همه کاشیها">
                </th>
                <th>کاشی DEM</th>
                <th>پوشش</th>
                <th>عملیات</th>
            </tr>
        `;
    }

    function renderDemTable(tiles) {
        const tbody = document.getElementById('resultsTableBody');
        if (!tbody) return;

        if (tiles.length === 0) {
            tbody.innerHTML = `
                <tr class="results-empty">
                    <td colspan="4" class="text-center text-muted py-4">
                        <i class="bi bi-inbox" style="font-size:2rem"></i>
                        <p class="mt-2">کاشی DEMای در این محدوده یافت نشد</p>
                        <small>محدوده جغرافیایی را بررسی کنید</small>
                    </td>
                </tr>
            `;
            return;
        }

        const selected = new Set(AppState.selectedScenes || []);

        tbody.innerHTML = tiles.map(tile => {
            const inCart = AppState.cart.includes(tile.id);
            const isSelected = selected.has(tile.id);
            const bbox = tile.bbox || [];
            const hasPreview = !!tile.tilejson;
            const bboxStr = bbox.length >= 4
                ? `${toPersianNum(bbox[0].toFixed(2))}–${toPersianNum(bbox[2].toFixed(2))}°E, ${toPersianNum(bbox[1].toFixed(2))}–${toPersianNum(bbox[3].toFixed(2))}°N`
                : '—';

            return `
                <tr data-scene-id="${escapeHtml(tile.id)}" class="${isSelected ? 'scene-selected' : ''}">
                    <td class="col-select">
                        <input class="form-check-input result-scene-checkbox" type="checkbox"
                               value="${escapeHtml(tile.id)}" aria-label="انتخاب ${escapeHtml(tile.id)}"
                               ${isSelected ? 'checked' : ''}>
                    </td>
                    <td class="scene-cell">
                        <span class="fw-medium d-block text-truncate scene-id-text" dir="ltr" title="${escapeHtml(tile.id)}">${escapeHtml(tile.name || tile.id)}</span>
                        <small class="text-muted d-block" dir="ltr">Copernicus GLO-30</small>
                    </td>
                    <td class="text-nowrap text-muted small">
                        ${toPersianNum(Number(tile.coverage || 0).toFixed(1))}٪
                    </td>
                    <td>
                        <div class="d-flex gap-1">
                            <button class="btn btn-sm btn-outline-primary btn-action btn-preview"
                                    data-id="${escapeHtml(tile.id)}" title="نمایش سایه‌روشن (Hillshade) روی نقشه"
                                    ${hasPreview ? '' : 'disabled'}>
                                <i class="bi bi-map"></i>
                            </button>
                            <a href="${escapeHtml(tile.download_url || '#')}"
                               download="${escapeHtml(tile.filename || 'dem.tif')}"
                               class="btn btn-sm btn-outline-secondary btn-action"
                               title="دانلود">
                                <i class="bi bi-download"></i>
                            </a>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // Attach event listeners
        tbody.querySelectorAll('.btn-add-cart').forEach(btn => {
            btn.addEventListener('click', () => addToCart(btn.dataset.id));
        });
        tbody.querySelectorAll('.btn-preview:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => withButtonLoading(btn, () => toggleScenePreview(btn, btn.dataset.id), 'در حال دریافت...'));
        });
        tbody.querySelectorAll('.result-scene-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                setSceneSelected(checkbox.value, checkbox.checked);
                checkbox.closest('tr')?.classList.toggle('scene-selected', checkbox.checked);
            });
        });

        tbody.querySelectorAll('tr[data-scene-id]').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('button, input, a')) return;
                const checkbox = row.querySelector('.result-scene-checkbox');
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            });
            row.style.cursor = 'pointer';
        });

        // Select all checkbox
        const selectAll = document.getElementById('demSelectAll');
        if (selectAll) {
            const allIds = tiles.map(t => t.id);
            const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id));
            selectAll.checked = allSelected;
            selectAll.onchange = () => {
                const ids = new Set(AppState.selectedScenes || []);
                if (selectAll.checked) {
                    allIds.forEach(id => ids.add(id));
                } else {
                    allIds.forEach(id => ids.delete(id));
                }
                updateSelection([...ids]);
                renderDemTable(tiles);
            };
        }
    }

    function setWeatherTableHeader() {
        const thead = document.querySelector('#resultsTable thead');
        if (!thead) return;
        thead.innerHTML = `
            <tr>
                <th>ایستگاه</th>
                <th>کد ایستگاه</th>
                <th>مختصات</th>
                <th>ارتفاع (m)</th>
                <th>میانگین دما (°C)</th>
                <th>رطوبت (%)</th>
                <th>بارش کل (mm)</th>
                <th>روزهای داده</th>
                <th>منبع</th>
                <th>دانلود</th>
            </tr>
        `;
    }

    function renderWeatherTable(stations) {
        const tbody = document.getElementById('resultsTableBody');
        if (!tbody) return;

        if (stations.length === 0) {
            tbody.innerHTML = `
                <tr class="results-empty">
                    <td colspan="10" class="text-center text-muted py-4">
                        <i class="bi bi-inbox" style="font-size:2rem"></i>
                        <p class="mt-2">ایستگاه هواشناسی در این محدوده یافت نشد</p>
                        <small>محدوده یا بازه زمانی را بررسی کنید</small>
                    </td>
                </tr>
            `;
            return;
        }

        const fmt = (value, suffix = '', decimals = 1) => {
            if (!Number.isFinite(value)) return '—';
            return `${toPersianNum(value.toFixed(decimals))}${suffix}`;
        };

        tbody.innerHTML = stations.map(station => {
            const name = escapeHtml(station.name || station.id);
            const region = station.region
                ? `<br><small class="text-muted">${escapeHtml(station.region)}${station.country ? ' / ' + escapeHtml(station.country) : ''}</small>`
                : '';
            const coords = `${toPersianNum(station.latitude.toFixed(3))}، ${toPersianNum(station.longitude.toFixed(3))}`;

            return `
                <tr data-station-id="${escapeHtml(station.id)}">
                    <td>
                        <span class="fw-medium">${name}</span>
                        ${region}
                    </td>
                    <td><span dir="ltr">${escapeHtml(station.id)}</span></td>
                    <td class="text-nowrap" dir="ltr">${coords}</td>
                    <td class="text-nowrap">${fmt(station.elevation, '', 0)}</td>
                    <td class="text-nowrap">${fmt(station.tavg_avg, '°')}</td>
                    <td class="text-nowrap">${fmt(station.rhum_avg, '٪')}</td>
                    <td class="text-nowrap">${fmt(station.prcp_total)}</td>
                    <td class="text-nowrap">${station.days ? toPersianNum(station.days) : '—'}</td>
                    <td>
                        <span class="badge ${station.source === 'open-meteo' ? 'text-bg-warning' : 'text-bg-secondary'}">
                            ${station.source === 'open-meteo' ? 'Open-Meteo' : station.source === 'meteostat' ? 'Meteostat' : '—'}
                        </span>
                    </td>
                    <td>
                        <a href="${escapeHtml(station.download_url)}" download
                           class="btn btn-sm btn-outline-primary btn-action">
                            <i class="bi bi-download"></i> دانلود
                        </a>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * Render the results table
     */
    function renderTable(items) {
        const tbody = document.getElementById('resultsTableBody');
        if (!tbody) return;

        if (items.length === 0) {
            tbody.innerHTML = `
                <tr class="results-empty">
                    <td colspan="5" class="text-center text-muted py-4">
                        <i class="bi bi-inbox" style="font-size:2rem"></i>
                        <p class="mt-2">تصویری با فیلتر فعلی یافت نشد</p>
                        <small>محدوده، تاریخ یا پوشش ابر را بررسی کنید</small>
                    </td>
                </tr>
            `;
            syncPageSelectionControl([]);
            return;
        }

        tbody.innerHTML = items.map(item => {
            const inCart = AppState.cart.includes(item.id);
            const isSelected = AppState.selectedScenes.includes(item.id);
            const cloudClass = `cloud-${item.cloudCategory}`;
            const cloudLabel = `${toPersianNum(item.cloudCover)}٪`;
            const hasPreview = !!((item.thumbnail || item.tilejson) && item.footprint);

            return `
                <tr data-scene-id="${item.id}" class="${isSelected ? 'scene-selected' : ''}">
                    <td class="col-select">
                        <input class="form-check-input result-scene-checkbox" type="checkbox"
                               value="${item.id}" aria-label="انتخاب ${item.id}"
                               ${isSelected ? 'checked' : ''}>
                    </td>
                    <td class="scene-cell">
                        <span class="fw-medium d-block text-truncate scene-id-text" dir="ltr" title="${item.id}">${item.id}</span>
                        <small class="text-muted d-block text-truncate">${item.fullName}</small>
                    </td>
                    <td class="text-nowrap">
                        ${toPersianDate(item.date)}
                        <small class="text-muted d-block" dir="ltr">P/R: ${toPersianNum(item.path)}/${toPersianNum(item.row)}</small>
                    </td>
                    <td class="text-nowrap">
                        <span class="result-cloud-badge ${cloudClass}">${cloudLabel}</span>
                        <small class="text-muted d-block">${toPersianNum(Number(item.coveragePercent ?? 0).toFixed(1))}٪ منطقه</small>
                    </td>
                    <td>
                        <div class="d-flex gap-1">
                            <button class="btn btn-sm btn-outline-primary btn-action btn-preview"
                                data-id="${item.id}" title="نمایش پیش‌نمایش روی نقشه"
                                ${hasPreview ? '' : 'disabled'}>
                                <i class="bi bi-map"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-secondary btn-action btn-metadata"
                                data-id="${item.id}" title="اطلاعات بیشتر">
                                <i class="bi bi-info-circle"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-secondary btn-action btn-download"
                                data-id="${item.id}" title="دانلود تصویر">
                                <i class="bi bi-download"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // Attach event listeners
        tbody.querySelectorAll('.btn-add-cart').forEach(btn => {
            btn.addEventListener('click', () => addToCart(btn.dataset.id));
        });
        tbody.querySelectorAll('.btn-remove-cart').forEach(btn => {
            btn.addEventListener('click', () => removeFromCart(btn.dataset.id));
        });
        tbody.querySelectorAll('.btn-download').forEach(btn => {
            btn.addEventListener('click', () => withButtonLoading(btn, () => showBandDownloadModal(btn.dataset.id), 'در حال دریافت لینک‌ها...'));
        });
        tbody.querySelectorAll('.btn-metadata').forEach(btn => {
            btn.addEventListener('click', () => showMetadata(btn.dataset.id));
        });
        tbody.querySelectorAll('.btn-preview:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => withButtonLoading(btn, () => toggleScenePreview(btn, btn.dataset.id), 'در حال دریافت...'));
        });

        tbody.querySelectorAll('.result-scene-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                setSceneSelected(checkbox.value, checkbox.checked);
                checkbox.closest('tr')?.classList.toggle('scene-selected', checkbox.checked);
                syncPageSelectionControl(items);
            });
        });

        // Clicking a row toggles its image selection.
        tbody.querySelectorAll('tr[data-scene-id]').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('button, input, a')) return;
                const checkbox = row.querySelector('.result-scene-checkbox');
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            });
            row.style.cursor = 'pointer';
        });

        syncPageSelectionControl(items);
    }

    function setSceneSelected(sceneId, selected) {
        const ids = new Set(AppState.selectedScenes || []);
        if (selected) ids.add(sceneId);
        else ids.delete(sceneId);
        updateSelection([...ids]);
    }

    /**
     * Toggle a scene preview on the map. TileJSON (true geometry) is
     * preferred; the flat image overlay is only a fallback.
     * Works for satellite scenes (footprint) and DEM tiles (bbox).
     */
    async function toggleScenePreview(btn, sceneId) {
        const item = currentResults.find(r => r.id === sceneId);
        if (!item) {
            showToast('پیش‌نمایشی برای این تصویر موجود نیست', 'warning');
            return;
        }

        let lats = null;
        let lngs = null;
        if (Array.isArray(item.footprint) && item.footprint.length >= 3) {
            lats = item.footprint.map(p => p.lat);
            lngs = item.footprint.map(p => p.lng);
        } else if (Array.isArray(item.bbox) && item.bbox.length >= 4) {
            const [w, s, e, n] = item.bbox;
            lats = [s, n];
            lngs = [w, e];
        }
        if (!lats || (!item.thumbnail && !item.tilejson)) {
            showToast('پیش‌نمایشی برای این تصویر موجود نیست', 'warning');
            return;
        }

        const bounds = [
            [Math.min(...lats), Math.min(...lngs)],
            [Math.max(...lats), Math.max(...lngs)],
        ];

        let result;
        if (item.tilejson) {
            result = await MapModule.toggleTileJsonOverlay(item.id, item.tilejson, bounds);
            if (result === null && item.thumbnail) {
                // TileJSON unavailable -> fall back to stretched image
                result = MapModule.toggleImageOverlay(item.id, item.thumbnail, bounds);
            }
        } else if (item.thumbnail) {
            result = MapModule.toggleImageOverlay(item.id, item.thumbnail, bounds);
        }

        if (result === null || result === undefined) {
            showToast('خطا در بارگذاری پیش‌نمایش', 'error');
            return;
        }
        btn.classList.toggle('active', result);
        showToast(result ? 'پیش‌نمایش روی نقشه نمایش داده شد' : 'پیش‌نمایش از نقشه حذف شد', 'info');
    }

    function updateSelection(sceneIds) {
        const validIds = new Set(allResults.map(item => item.id));
        AppState.selectedScenes = sceneIds.filter(id => validIds.has(id));
        AppState.selectedScene = AppState.selectedScenes[0] || null;
        AppState.processSelectionInitialized = true;
        updateSelectionSummary();
        redrawFootprints();
        EventBus.emit('result:selected', AppState.selectedScene);
        // Update summary with selected count
        setSummaryResults(allResults.length, AppState.selectedScenes.length);
    }

    function updateSelectionSummary() {
        const summary = document.getElementById('resultsSelectionCount');
        if (summary) {
            summary.textContent = `${toPersianNum(AppState.selectedScenes.length)} تصویر انتخاب شده`;
        }
    }

    function syncPageSelectionControl(items) {
        const selectPage = document.getElementById('resultSelectPage');
        if (!selectPage) return;

        const selected = new Set(AppState.selectedScenes || []);
        const selectedCount = items.filter(item => selected.has(item.id)).length;
        selectPage.disabled = items.length === 0;
        selectPage.checked = items.length > 0 && selectedCount === items.length;
        selectPage.indeterminate = selectedCount > 0 && selectedCount < items.length;

        selectPage.onchange = () => {
            const ids = new Set(AppState.selectedScenes || []);
            items.forEach(item => {
                if (selectPage.checked) ids.add(item.id);
                else ids.delete(item.id);
            });
            updateSelection([...ids]);
            renderTable(items);
        };
    }

    /**
     * Render pagination
     */
    function renderPagination() {
        const paginationNav = document.getElementById('resultsPagination');
        if (!paginationNav) return;

        const totalPages = Math.ceil(currentResults.length / RESULTS_PER_PAGE);

        if (totalPages <= 1) {
            paginationNav.style.display = 'none';
            return;
        }

        paginationNav.style.display = 'block';
        const ul = paginationNav.querySelector('ul');

        let html = '';

        // Previous
        html += `
            <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
                <a class="page-link" href="#" data-page="${currentPage - 1}">
                    <i class="bi bi-chevron-right"></i> قبلی
                </a>
            </li>
        `;

        // Page numbers
        const maxVisible = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);
        if (endPage - startPage + 1 < maxVisible) {
            startPage = Math.max(1, endPage - maxVisible + 1);
        }

        if (startPage > 1) {
            html += `<li class="page-item"><a class="page-link" href="#" data-page="1">۱</a></li>`;
            if (startPage > 2) html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }

        for (let i = startPage; i <= endPage; i++) {
            html += `
                <li class="page-item ${i === currentPage ? 'active' : ''}">
                    <a class="page-link" href="#" data-page="${i}">${toPersianNum(i)}</a>
                </li>
            `;
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
            html += `<li class="page-item"><a class="page-link" href="#" data-page="${totalPages}">${toPersianNum(totalPages)}</a></li>`;
        }

        // Next
        html += `
            <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
                <a class="page-link" href="#" data-page="${currentPage + 1}">
                    بعدی <i class="bi bi-chevron-left"></i>
                </a>
            </li>
        `;

        ul.innerHTML = html;

        // Pagination click handlers
        ul.querySelectorAll('.page-link[data-page]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = parseInt(link.dataset.page);
                if (page >= 1 && page <= totalPages) {
                    currentPage = page;
                    const startIdx = (currentPage - 1) * RESULTS_PER_PAGE;
                    const endIdx = startIdx + RESULTS_PER_PAGE;
                    const pageItems = currentResults.slice(startIdx, endIdx);
                    renderTable(pageItems);
                    renderPagination();
                    showFootprintsOnMap(pageItems);

                    // Scroll to top of results
                    document.getElementById('pane-results').scrollTop = 0;
                }
            });
        });
    }

    /**
     * Show footprints of current page results on map
     */
    let mappedFootprintItems = [];

    function showFootprintsOnMap(items) {
        mappedFootprintItems = items || [];
        // Page changed / new search: drop stale preview overlays
        MapModule.clearImageOverlays();
        MapModule.hideGeoJsonOverlay();
        redrawFootprints();
    }

    /**
     * Redraw footprints, highlighting those selected in the results table
     */
    function redrawFootprints() {
        if (!mappedFootprintItems.length) return;

        MapModule.clearUserLayers();

        const selected = new Set(AppState.selectedScenes || []);
        const hasSelection = selected.size > 0;

        // Draw unselected first so highlighted footprints sit on top
        const ordered = [
            ...mappedFootprintItems.filter(item => !selected.has(item.id)),
            ...mappedFootprintItems.filter(item => selected.has(item.id)),
        ];

        ordered.forEach(item => {
            if (!item.footprint) return;

            if (selected.has(item.id)) {
                MapModule.showFootprint(item.footprint, '#ffc107', {
                    weight: 3,
                    dashArray: null,
                    fillOpacity: 0.25,
                });
            } else {
                const index = mappedFootprintItems.indexOf(item);
                const color = hasSelection
                    ? 'hsl(210, 15%, 60%)'
                    : (item.baseColor || `hsl(${(index * 30) % 360}, 60%, 50%)`);
                MapModule.showFootprint(item.footprint, color);
            }
        });
    }

    /**
     * Show metadata modal/dialog for a scene
     */
    function showMetadata(sceneId) {
        const item = currentResults.find(r => r.id === sceneId);
        if (!item) return;

        // Build a simple modal using Bootstrap
        let modalHtml = `
            <div class="modal fade" id="metadataModal" tabindex="-1">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">اطلاعات تصویر</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <table class="table table-sm table-borderless">
                                <tr><td class="text-muted">شناسه:</td><td class="fw-medium">${item.id}</td></tr>
                                <tr><td class="text-muted">ماهواره:</td><td>${item.fullName}</td></tr>
                                <tr><td class="text-muted">تاریخ:</td><td>${toPersianDate(item.date)}</td></tr>
                                <tr><td class="text-muted">پوشش ابر:</td><td>${toPersianNum(item.cloudCover)}٪</td></tr>
                                <tr><td class="text-muted">قدرت تفکیک:</td><td>${item.resolution}</td></tr>
                                <tr><td class="text-muted">مسیر (Path):</td><td>${toPersianNum(item.path)}</td></tr>
                                <tr><td class="text-muted">ردیف (Row):</td><td>${toPersianNum(item.row)}</td></tr>
                                <tr><td class="text-muted">حجم فایل:</td><td>${item.size}</td></tr>
                                <tr><td class="text-muted">کیفیت:</td><td>${item.quality}/۱۰</td></tr>
                                <tr><td class="text-muted">مختصات مرکز:</td><td>${item.lat}، ${item.lng}</td></tr>
                            </table>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-outline-primary btn-sm btn-modal-download" data-id="${item.id}">
                                <i class="bi bi-download"></i> دانلود تصویر
                            </button>
                            <button type="button" class="btn btn-outline-success btn-sm btn-modal-cart" data-id="${item.id}">
                                <i class="bi bi-cart-plus"></i> افزودن به سبد
                            </button>
                            <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">بستن</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal
        const existing = document.getElementById('metadataModal');
        if (existing) existing.remove();

        // Add to body
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modalEl = document.getElementById('metadataModal');
        const modal = new bootstrap.Modal(modalEl);
        modal.show();

        // Clean up on hide
        modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());

        // Download button in modal → open band download modal
        const dlBtn = modalEl.querySelector('.btn-modal-download');
        if (dlBtn) {
            dlBtn.addEventListener('click', () => {
                modal.hide();
                showBandDownloadModal(sceneId);
            });
        }

        // Cart button in modal (single handler, depends on current cart state)
        const cartBtn = modalEl.querySelector('.btn-modal-cart');
        if (cartBtn) {
            if (AppState.cart.includes(sceneId)) {
                cartBtn.classList.remove('btn-outline-success');
                cartBtn.classList.add('btn-danger');
                cartBtn.innerHTML = '<i class="bi bi-cart-x"></i> حذف از سبد';
                cartBtn.addEventListener('click', function () {
                    removeFromCart(sceneId);
                    modal.hide();
                });
            } else {
                cartBtn.addEventListener('click', function () {
                    addToCart(sceneId);
                    modal.hide();
                });
            }
        }
    }

    /**
     * Show band download modal — fetches per-band TIFF links from the backend
     * and displays direct download links for each band separately.
     */
    function showBandDownloadModal(sceneId) {
        const dataset = AppState.searchCriteria.dataset || '';
        const params = `scene_id=${encodeURIComponent(sceneId)}&dataset=${encodeURIComponent(dataset)}`;

        showToast('در حال دریافت لینک‌های دانلود...', 'info');

        return fetch(`${API_BASE}/landsat/download-links?${params}`)
            .then(res => res.json())
            .then(response => {
                if (!response.success || !response.links || response.links.length === 0) {
                    showToast('لینک دانلودی یافت نشد', 'error');
                    return;
                }

                const sceneName = response.scene_id || sceneId;

                // Build modal content
                let buttonsHtml = '';
                response.links.forEach(link => {
                    buttonsHtml += `
                        <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
                            <div>
                                <span class="fw-medium">${link.label || link.band}</span>
                                <small class="text-muted d-block">${link.band}</small>
                            </div>
                            <a href="${link.url}"
                               download="${link.filename}"
                               class="btn btn-sm btn-outline-primary">
                                <i class="bi bi-download"></i> دانلود
                            </a>
                        </div>
                    `;
                });

                // Remove existing modal
                const existing = document.getElementById('bandDownloadModal');
                if (existing) existing.remove();

                const modalHtml = `
                    <div class="modal fade" id="bandDownloadModal" tabindex="-1">
                        <div class="modal-dialog modal-lg modal-dialog-centered">
                            <div class="modal-content">
                                <div class="modal-header">
                                    <h5 class="modal-title">دانلود باندها</h5>
                                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                                </div>
                                <div class="modal-body">
                                    <p class="text-muted small mb-3">
                                        شناسه صحنه: <code>${sceneName}</code>
                                    </p>
                                    <p class="text-muted small mb-2">
                                        برای دانلود هر باند به صورت جداگانه، روی دکمه مربوطه کلیک کنید.
                                    </p>
                                    <div class="border rounded" style="max-height: 400px; overflow-y: auto;">
                                        ${buttonsHtml}
                                    </div>
                                </div>
                                <div class="modal-footer">
                                    <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">بستن</button>
                                </div>
                            </div>
                        </div>
                    </div>
                `;

                document.body.insertAdjacentHTML('beforeend', modalHtml);

                const modalEl = document.getElementById('bandDownloadModal');
                const modal = new bootstrap.Modal(modalEl);
                modal.show();
                modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
            })
            .catch(error => {
                showToast('خطا در دریافت لینک‌های دانلود', 'error');
                console.error('Band download links error:', error);
            });
    }

    return {
        init,
        showBandDownloadModal,
    };
})();

// Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ResultsModule.init);
} else {
    ResultsModule.init();
}
