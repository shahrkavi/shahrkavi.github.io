/**
 * Shahrkavi - Results Tab Module
 * Paginated results table with thumbnails, metadata, and download/cart actions
 */

const ResultsModule = (() => {
    const RESULTS_PER_PAGE = 10;
    let currentPage = 1;
    let currentResults = [];
    let allResults = [];
let selectedDate = 'all';

    function init() {
        // Listen for search completion
        EventBus.on('search:completed', onCompleted);

        // Cart updates
        EventBus.on('cart:updated', onCartUpdated);

        // Add all to cart button
        const btnAddAll = document.getElementById('btnAddAllToCart');
        if (btnAddAll) {
            btnAddAll.addEventListener('click', () => {
                if (currentResults.length > 0) {
                    currentResults.forEach(item => {
                        if (!AppState.cart.includes(item.id)) {
                            AppState.cart.push(item.id);
                        }
                    });
                    updateCartUI();
                    EventBus.emit('cart:updated', AppState.cart);
                    showToast(`${toPersianNum(currentResults.length)} تصویر به سبد اضافه شد`, 'success');
                }
            });
        }

        const btnSelectAll = document.getElementById('btnSelectAllResults');
        if (btnSelectAll) {
            btnSelectAll.addEventListener('click', () => {
                const currentIds = currentResults.map(item => item.id);
                const selected = new Set(AppState.selectedScenes || []);
                const allSelected = currentIds.length > 0 && currentIds.every(id => selected.has(id));

                currentIds.forEach(id => {
                    if (allSelected) selected.delete(id);
                    else selected.add(id);
                });

                updateSelection([...selected]);
                renderResults();
            });
        }

        // Export button (placeholder)
        const btnExport = document.getElementById('btnExportResults');
        if (btnExport) {
            btnExport.addEventListener('click', () => {
                showToast('خروجی CSV آماده دانلود است', 'info');
            });
        }

        // Cart button click - download all cart items as a ZIP file
        const btnCart = document.getElementById('btnCart');
        if (btnCart) {
            btnCart.addEventListener('click', () => {
                downloadCart();
            });
        }

        const dateFilter = document.getElementById('resultDateFilter');
        if (dateFilter) {
            dateFilter.addEventListener('change', () => {
                selectedDate = dateFilter.value;
                AppState.selectedResultDate = selectedDate;
                applyResultFilters();
            });
        }

        EventBus.on('tab:changed', (tab) => {
            if (tab === 'results') {
                if (isOsmMode() && AppState.osmInfo) renderResults();
                else if (isWeatherMode() && AppState.weatherInfo) renderResults();
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

    function onCompleted(response) {
        allResults = Array.isArray(response.data) ? response.data : [];
        const total = response.total || allResults.length;

        if (isWeatherMode()) {
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

        const dates = getAvailableDates();
        selectedDate = dates[0] || 'all';
        currentResults = selectedDate === 'all' ? allResults.slice() : allResults.filter(item => item.date === selectedDate);
        AppState.selectedResultDate = selectedDate;
        currentPage = 1;
        AppState.processSelectionInitialized = false;
        updateSelection(currentResults.map(item => item.id));
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

        if (isDemMode()) {
            renderDemResults();
            return;
        }

        renderDateFilter();
        renderCloudAverage();

        // Restore scene-oriented controls
        const dateFilterRow = document.getElementById('dateFilterRow');
        const osmSummary = document.getElementById('osmResultsSummary');
        const btnGoProcess = document.getElementById('btnGoProcess');
        const btnAddAll = document.getElementById('btnAddAllToCart');
        const btnSelectAll = document.getElementById('btnSelectAllResults');
        const btnExport = document.getElementById('btnExportResults');
        if (dateFilterRow) dateFilterRow.classList.remove('d-none');
        if (osmSummary) osmSummary.classList.add('d-none');
        if (btnGoProcess) {
            btnGoProcess.style.display = '';
            btnGoProcess.innerHTML = '<i class="bi bi-gear"></i> پردازش تصویر';
        }
        if (btnAddAll) btnAddAll.style.display = '';
        if (btnSelectAll) btnSelectAll.style.display = '';
        if (btnExport) btnExport.style.display = '';
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

        // Toggle action buttons
        const hasResults = currentResults.length > 0;
        if (btnAddAll) btnAddAll.disabled = !hasResults;
        if (btnSelectAll) {
            btnSelectAll.disabled = !hasResults;
            const selected = new Set(AppState.selectedScenes || []);
            const allSelected = hasResults && currentResults.every(item => selected.has(item.id));
            btnSelectAll.innerHTML = allSelected
                ? '<i class="bi bi-square"></i> لغو انتخاب همه'
                : '<i class="bi bi-check2-square"></i> انتخاب همه';
        }
        if (btnExport) btnExport.disabled = !hasResults;

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

function getAvailableDates() {
        return [...new Set(allResults.map(item => item.date).filter(Boolean))].sort().reverse();
    }

    function renderDateFilter() {
        const dateFilter = document.getElementById('resultDateFilter');
        if (!dateFilter) return;

        const dates = getAvailableDates();
        dateFilter.innerHTML = dates.map(date => {
            const count = allResults.filter(item => item.date === date).length;
            return `<option value="${date}">${toPersianDate(date)} (${toPersianNum(count)} تصویر)</option>`;
        }).join('');

        if (!dates.includes(selectedDate)) {
            selectedDate = dates[0] || 'all';
        }
        dateFilter.value = selectedDate;
    }

function applyResultFilters() {
        currentResults = allResults.filter(item => item.date === selectedDate);
        currentPage = 1;
        updateSelection(currentResults.map(item => item.id));
        renderResults();
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
        const btnAddAll = document.getElementById('btnAddAllToCart');
        const btnSelectAll = document.getElementById('btnSelectAllResults');
        const btnExport = document.getElementById('btnExportResults');
        const btnGoProcess = document.getElementById('btnGoProcess');
        const selectionCount = document.getElementById('resultsSelectionCount');
        if (dateFilterRow) dateFilterRow.classList.add('d-none');
        if (osmSummary) osmSummary.classList.remove('d-none');
        if (btnAddAll) btnAddAll.style.display = 'none';
        if (btnSelectAll) btnSelectAll.style.display = 'none';
        if (btnExport) btnExport.style.display = 'none';
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
        const dl = document.getElementById('btnOsmDownload');
        if (dl) {
            const needsProcess = totalCount > OSM_DOWNLOAD_LIMIT || osm.downloadable === false;
            if (osm.download_url && !needsProcess) {
                dl.href = osm.download_url;
                dl.classList.remove('disabled');
                dl.setAttribute('aria-disabled', 'false');
                dl.innerHTML = '<i class="bi bi-download"></i> دانلود داده‌های OSM (GeoJSON)';
                dl.onclick = null;
            } else {
                dl.removeAttribute('href');
                dl.classList.add('disabled');
                dl.setAttribute('aria-disabled', 'true');
                dl.innerHTML = '<i class="bi bi-gear"></i> نیازمند پردازش';
                dl.onclick = (e) => e.preventDefault();
            }
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
                <th class="col-thumb">پیش‌نمایش</th>
                <th>شناسه</th>
                <th>تاریخ</th>
                <th>ماهواره</th>
                <th>مسیر / ردیف</th>
                <th>پوشش منطقه</th>
                <th>پوشش ابر</th>
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
                            <i class="bi bi-gear"></i> نیازمند پردازش
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
                </tr>
            `;
        }).join('');

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
        const btnAddAll = document.getElementById('btnAddAllToCart');
        const btnSelectAll = document.getElementById('btnSelectAllResults');
        const btnExport = document.getElementById('btnExportResults');
        const btnGoProcess = document.getElementById('btnGoProcess');
        const selectionCount = document.getElementById('resultsSelectionCount');
        if (dateFilterRow) dateFilterRow.classList.add('d-none');
        if (osmSummary) osmSummary.classList.add('d-none');
        if (btnAddAll) btnAddAll.style.display = 'none';
        if (btnSelectAll) btnSelectAll.style.display = 'none';
        if (btnExport) btnExport.style.display = 'none';
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
        const btnAddAll = document.getElementById('btnAddAllToCart');
        const btnSelectAll = document.getElementById('btnSelectAllResults');
        const btnExport = document.getElementById('btnExportResults');
        const btnGoProcess = document.getElementById('btnGoProcess');
        const selectionCount = document.getElementById('resultsSelectionCount');
        if (dateFilterRow) dateFilterRow.classList.add('d-none');
        if (osmSummary) osmSummary.classList.add('d-none');
        if (btnAddAll) btnAddAll.style.display = 'none';
        if (btnSelectAll) btnSelectAll.style.display = 'none';
        if (btnExport) btnExport.style.display = 'none';
        if (btnGoProcess) {
            btnGoProcess.style.display = '';
            btnGoProcess.innerHTML = '<i class="bi bi-gear"></i> پردازش DEM';
        }
        if (selectionCount) selectionCount.style.display = 'inline';
        updateSelectionSummary();

        setDemTableHeader();
        renderDemTable(tiles);

        // Show tile footprints on map
        tiles.forEach(tile => {
            if (tile.bbox && tile.bbox.length >= 4) {
                const [w, s, e, n] = tile.bbox;
                MapModule.showFootprint([
                    { lat: n, lng: w },
                    { lat: n, lng: e },
                    { lat: s, lng: e },
                    { lat: s, lng: w },
                ], '#2ecc71');
            }
        });

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
                <th>شناسه کاشی</th>
                <th>پوشش منطقه</th>
                <th>محدوده</th>
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
                    <td colspan="5" class="text-center text-muted py-4">
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
            const bboxStr = bbox.length >= 4
                ? `${toPersianNum(bbox[1].toFixed(1))}–${toPersianNum(bbox[3].toFixed(1))}°`
                : '—';

            return `
                <tr data-scene-id="${escapeHtml(tile.id)}" class="${isSelected ? 'scene-selected' : ''}">
                    <td class="col-select">
                        <input class="form-check-input result-scene-checkbox" type="checkbox"
                               value="${escapeHtml(tile.id)}" aria-label="انتخاب ${escapeHtml(tile.id)}"
                               ${isSelected ? 'checked' : ''}>
                    </td>
                    <td>
                        <span class="fw-medium" dir="ltr">${escapeHtml(tile.name || tile.id)}</span>
                        <br><small class="text-muted">Copernicus DEM GLO-30</small>
                    </td>
                    <td class="text-nowrap">${toPersianNum(Number(tile.coverage || 0).toFixed(1))}٪</td>
                    <td class="text-nowrap text-muted small">${bboxStr}</td>
                    <td>
                        <div class="d-flex gap-1">
                            <a href="${escapeHtml(tile.download_url || '#')}"
                               download="${escapeHtml(tile.filename || 'dem.tif')}"
                               class="btn btn-sm btn-outline-primary btn-action"
                               title="دانلود">
                                <i class="bi bi-download"></i>
                            </a>
                            <button class="btn btn-sm btn-outline-success btn-action btn-add-cart"
                                    data-id="${escapeHtml(tile.id)}" title="افزودن به سبد"
                                    ${inCart ? 'disabled' : ''}>
                                <i class="bi bi-cart-plus"></i>
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
                    <td colspan="9" class="text-center text-muted py-4">
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
            const thumbnail = item.thumbnail
                ? `<img class="result-thumb" src="${item.thumbnail}" alt="پیش‌نمایش ${item.id}" loading="lazy"
                        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                   <span class="result-thumb result-thumb-placeholder" style="display:none">
                       <i class="bi bi-image"></i>
                   </span>`
                : `<span class="result-thumb result-thumb-placeholder"><i class="bi bi-image"></i></span>`;

            return `
                <tr data-scene-id="${item.id}" class="${isSelected ? 'scene-selected' : ''}">
                    <td class="col-select">
                        <input class="form-check-input result-scene-checkbox" type="checkbox"
                               value="${item.id}" aria-label="انتخاب ${item.id}"
                               ${isSelected ? 'checked' : ''}>
                    </td>
                    <td class="col-thumb">${thumbnail}</td>
                    <td>
                        <span class="fw-medium">${item.id}</span>
                        <br><small class="text-muted">${item.fullName}</small>
                    </td>
                    <td>${toPersianDate(item.date)}</td>
                    <td>${item.satellite}</td>
                    <td class="text-nowrap">${toPersianNum(item.path)} / ${toPersianNum(item.row)}</td>
                    <td class="text-nowrap">${toPersianNum(Number(item.coveragePercent ?? 0).toFixed(1))}٪</td>
                    <td>
                        <span class="result-cloud-badge ${cloudClass}">${cloudLabel}</span>
                    </td>
                    <td>
                        <div class="d-flex gap-1">
                            <button class="btn btn-sm btn-outline-secondary btn-action btn-metadata"
                                data-id="${item.id}" title="اطلاعات بیشتر">
                                <i class="bi bi-info-circle"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-secondary btn-action btn-download"
                                data-id="${item.id}" title="دانلود تصویر">
                                <i class="bi bi-download"></i>
                            </button>
                            ${inCart
                                ? `<button class="btn btn-sm btn-danger btn-action btn-remove-cart"
                                    data-id="${item.id}" title="حذف از سبد">
                                    <i class="bi bi-cart-x"></i>
                                   </button>`
                                : `<button class="btn btn-sm btn-outline-success btn-action btn-add-cart"
                                    data-id="${item.id}" title="افزودن به سبد">
                                    <i class="bi bi-cart-plus"></i>
                                   </button>`
                            }
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
            btn.addEventListener('click', () => showBandDownloadModal(btn.dataset.id));
        });
        tbody.querySelectorAll('.btn-metadata').forEach(btn => {
            btn.addEventListener('click', () => showMetadata(btn.dataset.id));
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

    function updateSelection(sceneIds) {
        const validIds = new Set(allResults.map(item => item.id));
        AppState.selectedScenes = sceneIds.filter(id => validIds.has(id));
        AppState.selectedScene = AppState.selectedScenes[0] || null;
        AppState.processSelectionInitialized = true;
        updateSelectionSummary();
        EventBus.emit('result:selected', AppState.selectedScene);
        // Update summary with selected count
        setSummaryResults(allResults.length, AppState.selectedScenes.length);
    }

    function updateSelectionSummary() {
        const summary = document.getElementById('resultsSelectionCount');
        if (summary) {
            summary.textContent = `${toPersianNum(AppState.selectedScenes.length)} تصویر انتخاب شده`;
        }

        const btnSelectAll = document.getElementById('btnSelectAllResults');
        if (btnSelectAll && currentResults.length > 0) {
            const selected = new Set(AppState.selectedScenes || []);
            const allSelected = currentResults.every(item => selected.has(item.id));
            btnSelectAll.innerHTML = allSelected
                ? '<i class="bi bi-square"></i> لغو انتخاب همه'
                : '<i class="bi bi-check2-square"></i> انتخاب همه';
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
    function showFootprintsOnMap(items) {
        MapModule.clearUserLayers();
        items.forEach((item, index) => {
            if (item.footprint) {
                // Vary colors slightly
                const hue = (index * 30) % 360;
                const color = `hsl(${hue}, 60%, 50%)`;
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

        fetch(API_BASE + `landsat/download-links?${params}`)
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
