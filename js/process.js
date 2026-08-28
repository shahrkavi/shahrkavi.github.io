/**
 * Shahrkavi - Process Tab Module
 * Image processing operations: crop, NDVI, band composites, etc.
 */

const ProcessModule = (() => {
    let currentProcessType = 'crop';
    let availableBands = [];

    function init() {
        // Listen for tab changes
        EventBus.on('tab:changed', onTabChanged);

        // Process type selector
        const processTypeSelect = document.getElementById('processType');
        if (processTypeSelect) {
            processTypeSelect.addEventListener('change', onProcessTypeChange);
        }

        // Optional crop based on the region defined in the first tab
        const cropCheckbox = document.getElementById('enableProcessCrop');
        if (cropCheckbox) {
            cropCheckbox.addEventListener('change', () => {
                updateCropRegionSummary();
                hideProcessResult();
            });
        }

        // Run process button
        const btnRun = document.getElementById('btnRunProcess');
        if (btnRun) {
            btnRun.addEventListener('click', () => withButtonLoading(btnRun, runProcess, 'در حال پردازش...'));
        }

        // Download processed result
        const btnDownload = document.getElementById('btnDownloadProcessed');
        if (btnDownload) {
            btnDownload.addEventListener('click', () => withButtonLoading(btnDownload, downloadProcessedResult, 'در حال دانلود...'));
        }

        // Add result to map
        const btnAddToMap = document.getElementById('btnAddResultToMap');
        if (btnAddToMap) {
            btnAddToMap.addEventListener('click', addResultToMap);
        }

        // OSM vector export
        const btnOsmExport = document.getElementById('btnOsmExport');
        if (btnOsmExport) {
            btnOsmExport.addEventListener('click', () => withButtonLoading(btnOsmExport, runOsmExport, 'در حال تبدیل و دانلود...'));
        }

        // Overture buildings export
        const btnOvtExport = document.getElementById('btnOvtExport');
        if (btnOvtExport) {
            btnOvtExport.addEventListener('click', () => withButtonLoading(btnOvtExport, runOvtExport, 'در حال ثبت درخواست...'));
        }

        // Listen for result selection
        EventBus.on('result:selected', onResultSelected);

        // Rebuild process options when the dataset changes
        EventBus.on('dataset:changed', () => {
            populateProcessTypes();
            populateBandsForDataset();
        });

        console.log('Process module initialized');
    }

    const PROCESS_TYPE_OPTIONS = [
        { value: 'crop', label: 'بدون شاخص (باندهای اصلی)' },
        { value: 'ndvi', label: 'شاخص گیاهی NDVI' },
        { value: 'ndwi', label: 'شاخص آبی NDWI' },
        { value: 'evi', label: 'شاخص گیاهی EVI' },
        { value: 'truecolor', label: 'تصویر رنگی واقعی' },
        { value: 'falsecolor', label: 'تصویر رنگی کاذب (NIR)' },
        { value: 'custom_band', label: 'ترکیب سفارشی باندها' },
        { value: 'hillshade', label: 'سایه‌رسانی (Hillshade)' },
        { value: 'elevation', label: 'نقشه ارتفاعی رنگی' },
        { value: 'height_points', label: 'نقاط ارتفاعی (نمونه‌برداری از DEM)' },
    ];

    const OPTICAL_PROCESS_TYPES = ['crop', 'ndvi', 'ndwi', 'evi', 'truecolor', 'falsecolor', 'custom_band'];
    const OPTICAL_DATASETS = new Set(['L4', 'L5', 'L7', 'L8', 'L9', 'S2', 'MOD', 'MYD']);
    const PROCESS_TYPES_BY_DATASET = {
        S1: ['crop'],
        DEM: ['crop', 'hillshade', 'elevation', 'height_points'],
    };

    /** Rebuild the process-type dropdown using only valid operations. */
    function populateProcessTypes() {
        const select = document.getElementById('processType');
        if (!select) return;

        const dataset = AppState.searchCriteria.dataset;
        const allowedValues = dataset
            ? (PROCESS_TYPES_BY_DATASET[dataset] || (OPTICAL_DATASETS.has(dataset) ? OPTICAL_PROCESS_TYPES : []))
            : [];
        const options = PROCESS_TYPE_OPTIONS.filter(o => allowedValues.includes(o.value));

        select.innerHTML = options.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
        select.disabled = options.length === 0;
        if (options.length === 0) return;

        currentProcessType = select.value;
        onProcessTypeChange({ target: select });
    }

    function onTabChanged(tab) {
        if (tab !== 'process') return;

        // Keep the selector correct even if the dataset changed before this
        // tab was opened or the tab is revisited after going back.
        populateProcessTypes();

        // Weather stations have no raster/vector processing pipeline; the tab
        // only explains that data can be downloaded from the results tab.
        if (isWeatherMode()) {
            showWeatherMode();
            return;
        }

        // DEM tiles use the image-processing pipeline with DEM-specific types.
        if (isDemMode()) {
            showImageProcessMode();
            updateSelectedSceneDisplay();
            populateProcessScenes();
            updateCropRegionSummary();
            return;
        }

        // OSM layers are converted to vector formats; raster datasets use
        // the image-processing pipeline.
        if (isOsmMode()) {
            showOsmExportMode();
            return;
        }

        // Overture buildings are exported to vector formats as well.
        if (isOvtMode()) {
            showOvtExportMode();
            return;
        }

        showImageProcessMode();
        updateSelectedSceneDisplay();
        populateProcessScenes();
        // Populate bands for current dataset
        populateBandsForDataset();
        // Show the region that will be used when crop is enabled
        updateCropRegionSummary();
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

    function isOvtMode() {
        return (AppState.searchCriteria.dataset || '') === 'OVT';
    }

    function showWeatherMode() {
        const ids = ['processSceneInfo', 'processInputScenes', 'processTypeSection',
                     'cropSettings', 'bandSettings', 'customBandSettings', 'processRunSection',
                     'osmExportSection'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // Show a short notice in place of the hidden sections
        const info = document.getElementById('processSceneInfo');
        if (info) {
            info.style.display = '';
            const title = info.querySelector('.section-title');
            if (title) title.innerHTML = '<i class="bi bi-thermometer-half"></i> ایستگاه‌های هواشناسی';
            const display = document.getElementById('selectedSceneDisplay');
            if (display) {
                display.innerHTML = `
                    <i class="bi bi-info-circle text-primary me-1"></i>
                    داده‌های روزانه هر ایستگاه را می‌توانید از جدول نتایج (تب نتایج) دانلود کنید.
                    پردازش تصویری برای این دیتاست معنی ندارد.
                `;
            }
        }
    }

    function showImageProcessMode() {
        const ids = ['processSceneInfo', 'processInputScenes', 'processTypeSection',
                     'cropSettings', 'bandSettings', 'customBandSettings', 'processRunSection'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = '';
        });
        const exportSection = document.getElementById('osmExportSection');
        if (exportSection) exportSection.style.display = 'none';

        // Re-apply section visibility for the currently selected process type
        updateSectionVisibility();
    }

    function showOsmExportMode() {
        const ids = ['processSceneInfo', 'processInputScenes', 'processTypeSection',
                     'cropSettings', 'bandSettings', 'customBandSettings', 'processRunSection'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        const exportSection = document.getElementById('osmExportSection');
        if (exportSection) exportSection.style.display = 'block';
        renderOsmExportLayers();
    }

    function renderOsmExportLayers() {
        const container = document.getElementById('osmExportLayers');
        if (!container) return;

        const layers = ((AppState.osmInfo && AppState.osmInfo.layers) || []).slice();
        if (layers.length === 0) {
            container.innerHTML = '<div class="text-muted small">لایه‌ای برای خروجی یافت نشد؛ ابتدا در تب نتایج جستجو کنید.</div>';
            return;
        }

        // Default to the layers selected in the results tab
        const selected = new Set(
            (AppState.selectedOsmLayers && AppState.selectedOsmLayers.length)
                ? AppState.selectedOsmLayers
                : layers.map(l => l.name)
        );

        container.innerHTML = layers.map(layer => `
            <div class="form-check small mb-1">
                <input class="form-check-input osm-export-layer-checkbox" type="checkbox"
                       value="${escapeHtml(layer.name)}" id="osm-export-${escapeHtml(layer.name)}"
                       ${selected.has(layer.name) ? 'checked' : ''}>
                <label class="form-check-label" for="osm-export-${escapeHtml(layer.name)}">
                    <span dir="ltr">${escapeHtml(layer.name)}</span>
                    <span class="text-muted">— ${toPersianNum(layer.total || 0)} عنصر</span>
                </label>
            </div>
        `).join('');
    }

    function showOvtExportMode() {
        const ids = ['processSceneInfo', 'processInputScenes', 'processTypeSection',
                     'cropSettings', 'bandSettings', 'customBandSettings', 'processRunSection',
                     'osmExportSection', 'heightPointsSettings'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        const exportSection = document.getElementById('ovtExportSection');
        if (exportSection) exportSection.style.display = 'block';

        const summary = document.getElementById('ovtExportSummary');
        if (summary) {
            const ovt = AppState.overtureInfo || {};
            summary.textContent = Number.isFinite(ovt.total) && ovt.total > 0
                ? `${toPersianNum(ovt.total)} ساختمان در محدوده انتخابی موجود است. فرمت خروجی را انتخاب کرده و دکمه تبدیل را بزنید.`
                : 'در حال جستجو... لطفاً صبر کنید یا دوباره جستجو را اجرا کنید.';
        }
    }

    function runOvtExport() {
        const bounds = getDefinedRegionBounds();
        if (!bounds) {
            showToast('ابتدا محدوده جغرافیایی را در تب اول تعریف کنید', 'warning');
            return;
        }

        const format = document.getElementById('ovtExportFormat')?.value || 'shp';
        showToast('در حال ارسال درخواست تبدیل...', 'info');

        return fetch(`${API_BASE}/overture/buildings/export-async`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                north: bounds.north,
                south: bounds.south,
                east: bounds.east,
                west: bounds.west,
                format,
                limit: 20000,
            }),
        })
            .then(async res => {
                const response = await res.json().catch(() => ({}));
                if (!res.ok) {
                    showToast(response.detail || response.message || `خطا در ارسال درخواست (${res.status})`, 'error');
                    return;
                }
                if (response.job_id) {
                    showToast('درخواست شما در صف پردازش قرار گرفت', 'success');
                    // Give the toast a moment to render, then open the job page
                    setTimeout(() => {
                        window.location.href = `processing.html?job=${encodeURIComponent(response.job_id)}&source=overture`;
                    }, 800);
                } else {
                    showToast(response.message || 'خطا در ارسال درخواست', 'error');
                }
            })
            .catch(error => {
                showToast('خطا در ارتباط با سرور: ' + error.message, 'error');
                console.error('OVT export error:', error);
            });
    }

    function runOsmExport() {
        const container = document.getElementById('osmExportLayers');
        const layers = ((AppState.osmInfo && AppState.osmInfo.layers) || []).slice();
        const byName = {};
        layers.forEach(l => { byName[l.name] = l; });

        const names = [];
        (container ? container.querySelectorAll('.osm-export-layer-checkbox:checked') : []).forEach(cb => {
            if (byName[cb.value]) names.push(cb.value);
        });
        if (names.length === 0) {
            showToast('حداقل یک لایه را برای خروجی انتخاب کنید', 'warning');
            return;
        }

        const bounds = getDefinedRegionBounds();
        if (!bounds) {
            showToast('ابتدا محدوده جغرافیایی را در تب اول تعریف کنید', 'warning');
            return;
        }

        const filters = names.map(name => {
            const l = byName[name];
            return { key: l.key, value: l.value || '', any: !!l.any };
        });

        const format = document.getElementById('osmExportFormat')?.value || 'shp';
        const params = new URLSearchParams({
            north: bounds.north,
            south: bounds.south,
            east: bounds.east,
            west: bounds.west,
            filters: JSON.stringify(filters),
            format,
            limit: 5000,
        });

        const url = `${API_BASE}/osm/export?${params}`;
        showToast('در حال آماده‌سازی فایل خروجی...', 'info');
        return fetchAndDownload(url, 'osm_export.zip')
            .then(() => showToast('دانلود آغاز شد', 'success'))
            .catch(error => showToast(error.message, 'error'));
    }

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function onResultSelected(sceneId) {
        AppState.selectedScene = sceneId;
        if (AppState.currentTab === 'process') {
            updateSelectedSceneDisplay();
            populateProcessScenes();
        }
    }

    function populateProcessScenes() {
        const container = document.getElementById('processSceneList');
        if (!container) return;

        const allScenes = Array.isArray(AppState.searchResults) ? AppState.searchResults : [];
        const selectedIds = new Set(AppState.selectedScenes || []);
        const scenes = allScenes.filter(scene => selectedIds.has(scene.id));
        if (scenes.length === 0) {
            container.innerHTML = '<div class="text-muted small">ابتدا در تب نتایج حداقل یک تصویر را انتخاب کنید</div>';
            AppState.selectedScenes = [];
            return;
        }

        const selected = scenes.map(scene => scene.id);
        AppState.selectedScenes = selected;
        AppState.selectedScene = selected[0] || null;

        container.innerHTML = scenes.map(scene => `
            <div class="form-check small mb-1">
                <input class="form-check-input process-scene-checkbox" type="checkbox"
                       value="${scene.id}" id="process-scene-${scene.id}"
                       ${selected.includes(scene.id) ? 'checked' : ''}>
                <label class="form-check-label" for="process-scene-${scene.id}">
                    ${scene.id} — ${toPersianDate(scene.date)} — ابر: ${toPersianNum(scene.cloudCover)}٪
                </label>
            </div>
        `).join('');

        container.querySelectorAll('.process-scene-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                AppState.selectedScenes = [...container.querySelectorAll('.process-scene-checkbox:checked')]
                    .map(input => input.value);
                AppState.processSelectionInitialized = true;
                AppState.selectedScene = AppState.selectedScenes[0] || null;
                updateSelectedSceneDisplay();
            });
        });
    }

    function updateSelectedSceneDisplay() {
        const display = document.getElementById('selectedSceneDisplay');
        const sceneId = AppState.selectedScene;

        if (!display) {
            return;
        }

        if (AppState.selectedScenes && AppState.selectedScenes.length > 1) {
            display.innerHTML = `
                <strong>${toPersianNum(AppState.selectedScenes.length)} تصویر برای ادغام انتخاب شده است</strong><br>
                <small class="text-muted">اولین تصویر: ${AppState.selectedScenes[0]}</small>
            `;
            return;
        }

        if (!sceneId) {
            if (display) display.innerHTML = 'هیچ تصویری انتخاب نشده است';
            return;
        }

        const scene = AppState.searchResults.find(r => r.id === sceneId);
        if (scene) {
            display.innerHTML = `
                <strong>${scene.id}</strong><br>
                <small class="text-muted">${scene.fullName} | ${toPersianDate(scene.date)} | ابر: ${toPersianNum(scene.cloudCover)}%</small>
            `;
        }
    }

    function populateBandsForDataset() {
        const dataset = AppState.searchCriteria.dataset;
        const bands = DatasetsModule.BANDS_BY_SATELLITE[dataset] || [];
        const bandLabels = DatasetsModule.BAND_LABELS;

        availableBands = bands;

        // Populate band list for band-based operations
        const bandList = document.getElementById('processBandList');
        if (bandList) {
            bandList.innerHTML = bands.map((band, idx) => `
                <div class="form-check">
                    <input class="form-check-input" type="checkbox" value="${band}" id="proc-band-${band}" ${idx < 3 ? 'checked' : ''}>
                    <label class="form-check-label small" for="proc-band-${band}">${bandLabels[band] || band}</label>
                </div>
            `).join('');
        }
        updateProcessBandSelection();

        // Populate custom band combo dropdowns
        const selects = ['customBandR', 'customBandG', 'customBandB'];
        selects.forEach(id => {
            const select = document.getElementById(id);
            if (select) {
                select.innerHTML = bands.map(band =>
                    `<option value="${band}">${bandLabels[band] || band}</option>`
                ).join('');
            }
        });

        // Set defaults for RGB
        const rSelect = document.getElementById('customBandR');
        const gSelect = document.getElementById('customBandG');
        const bSelect = document.getElementById('customBandB');
        if (rSelect && bands.includes('red')) rSelect.value = 'red';
        if (gSelect && bands.includes('green')) gSelect.value = 'green';
        if (bSelect && bands.includes('blue')) bSelect.value = 'blue';
    }

    function onProcessTypeChange(e) {
        currentProcessType = e.target.value;

        // Show/hide relevant settings sections
        updateSectionVisibility();
        updateProcessBandSelection();

        // Hide previous result
        hideProcessResult();
    }

    /**
     * Toggle crop/band/custom-band sections based on the selected process type.
     */
    function updateSectionVisibility() {
        const cropSettings = document.getElementById('cropSettings');
        const bandSettings = document.getElementById('bandSettings');
        const customBandSettings = document.getElementById('customBandSettings');
        const heightPointsSettings = document.getElementById('heightPointsSettings');

        // Hide optional settings first
        if (bandSettings) bandSettings.style.display = 'none';
        if (customBandSettings) customBandSettings.style.display = 'none';
        if (heightPointsSettings) heightPointsSettings.style.display = 'none';

        // Height points have their own sampling settings; crop is irrelevant
        if (currentProcessType === 'height_points') {
            if (cropSettings) cropSettings.style.display = 'none';
            if (heightPointsSettings) heightPointsSettings.style.display = 'block';
            return;
        }

        // Crop is independent from the selected processing operation
        if (cropSettings) cropSettings.style.display = 'block';

        // Show settings relevant to the selected operation
        if (currentProcessType === 'custom_band') {
            if (customBandSettings) customBandSettings.style.display = 'block';
        } else if (currentProcessType !== 'crop' && !isDemMode()) {
            // NDVI, NDWI, EVI, truecolor, falsecolor use band settings
            if (bandSettings) bandSettings.style.display = 'block';
        }
    }

    function requiredBandsForProcess() {
        const required = {
            ndvi: ['nir', 'red'],
            ndwi: ['green', 'nir'],
            evi: ['blue', 'red', 'nir'],
            truecolor: ['red', 'green', 'blue'],
            falsecolor: ['nir', 'red', 'green'],
            hillshade: ['dem'],
            elevation: ['dem'],
        };
        return required[currentProcessType] || availableBands.slice(0, 3);
    }

    function updateProcessBandSelection() {
        const bandList = document.getElementById('processBandList');
        if (!bandList) return;

        const required = requiredBandsForProcess();
        const labels = DatasetsModule.BAND_LABELS;
        bandList.innerHTML = required.map(band => `
            <div class="form-check">
                <input class="form-check-input" type="checkbox" checked disabled value="${band}" id="proc-band-${band}">
                <label class="form-check-label small" for="proc-band-${band}">
                    ${labels[band] || band}
                </label>
            </div>
        `).join('');
    }

    function runProcess() {
        const sceneIds = (AppState.selectedScenes && AppState.selectedScenes.length)
            ? AppState.selectedScenes
            : (AppState.selectedScene ? [AppState.selectedScene] : []);
        if (sceneIds.length === 0) {
            showToast('لطفاً حداقل یک تصویر برای پردازش انتخاب کنید', 'warning');
            return;
        }

        showToast('در حال پردازش تصویر...', 'info');

        // Crop is optional and always uses the region defined in the first tab.
        // Height points always need the region: it defines the sampling area.
        let cropBounds = null;
        const cropEnabled = document.getElementById('enableProcessCrop')?.checked === true;
        if (cropEnabled || currentProcessType === 'height_points') {
            cropBounds = getDefinedRegionBounds();
            if (!cropBounds) {
                showToast('ابتدا محدوده جغرافیایی را در تب اول تعریف کنید', 'warning');
                return;
            }
        }

        if (currentProcessType === 'height_points') {
            const count = parseInt(document.getElementById('hpPointCount')?.value, 10);
            if (!Number.isFinite(count) || count < 1 || count > 5000) {
                showToast('تعداد نقاط باید عددی بین ۱ تا ۵۰۰۰ باشد', 'warning');
                return;
            }
        }

        // Build request based on process type
        const request = buildProcessRequest(sceneIds, cropBounds);

        // Call backend API - jobs are queued and run in the background
        return fetch(`${API_BASE}/landsat/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request)
        })
            .then(async res => {
                const response = await res.json().catch(() => ({}));
                if (!res.ok) {
                    showToast(response.detail || response.message || `خطا در ارسال درخواست (${res.status})`, 'error');
                    return;
                }
                if (response.job_id) {
                    showToast('درخواست شما در صف پردازش قرار گرفت', 'success');
                    // Give the toast a moment to render, then open the job page
                    setTimeout(() => {
                        window.location.href = `processing.html?job=${encodeURIComponent(response.job_id)}`;
                    }, 800);
                } else if (response.success) {
                    // Backward-compatible synchronous result
                    showToast('پردازش با موفقیت انجام شد', 'success');
                    showProcessResult(response);
                } else {
                    showToast(response.message || 'خطا در پردازش', 'error');
                }
            })
            .catch(error => {
                showToast('خطا در ارتباط با سرور: ' + error.message, 'error');
                console.error('Process error:', error);
            });
    }

    function getDefinedRegionBounds() {
        // Read the first-tab fields directly so the latest edited values are used.
        const north = parseFloat(document.getElementById('North')?.value);
        const south = parseFloat(document.getElementById('South')?.value);
        const east = parseFloat(document.getElementById('East')?.value);
        const west = parseFloat(document.getElementById('West')?.value);
        const values = [north, south, east, west];

        if (!values.every(Number.isFinite)) {
            return null;
        }
        if (north <= south || east <= west) {
            return null;
        }
        return { north, south, east, west };
    }

    function updateCropRegionSummary() {
        const summary = document.getElementById('processCropRegionSummary');
        const cropEnabled = document.getElementById('enableProcessCrop')?.checked === true;
        if (!summary) return;

        if (!cropEnabled) {
            summary.textContent = 'برش غیرفعال است؛ کل تصویر پردازش می‌شود.';
            return;
        }

        const bounds = getDefinedRegionBounds();
        if (!bounds) {
            summary.textContent = 'محدوده جغرافیایی هنوز در تب اول تعریف نشده است.';
            return;
        }

        summary.innerHTML = `
            شمال: ${toPersianNum(bounds.north.toFixed(4))}،
            جنوب: ${toPersianNum(bounds.south.toFixed(4))}<br>
            شرق: ${toPersianNum(bounds.east.toFixed(4))}،
            غرب: ${toPersianNum(bounds.west.toFixed(4))}
        `;
    }

    function buildProcessRequest(sceneIds, cropBounds) {
        const dataset = AppState.searchCriteria.dataset;

        const baseRequest = {
            scene_ids: sceneIds,
            scene_id: sceneIds[0],
            dataset: dataset,
            process_type: currentProcessType,
        };

        if (cropBounds) {
            baseRequest.bounds = cropBounds;
        }

        // Add bands for band-based operations
        if (currentProcessType === 'ndvi') {
            // NDVI needs NIR and Red
            baseRequest.bands = ['nir', 'red'];
        } else if (currentProcessType === 'ndwi') {
            // NDWI needs Green and NIR or SWIR
            baseRequest.bands = ['green', 'nir'];
        } else if (currentProcessType === 'evi') {
            // EVI needs Blue, Red, NIR
            baseRequest.bands = ['blue', 'red', 'nir'];
        } else if (currentProcessType === 'truecolor') {
            baseRequest.bands = ['red', 'green', 'blue'];
        } else if (currentProcessType === 'falsecolor') {
            baseRequest.bands = ['nir', 'red', 'green'];
        } else if (currentProcessType === 'custom_band') {
            const r = document.getElementById('customBandR').value;
            const g = document.getElementById('customBandG').value;
            const b = document.getElementById('customBandB').value;
            baseRequest.bands = [r, g, b];
        } else if (currentProcessType === 'hillshade') {
            baseRequest.bands = ['dem'];
        } else if (currentProcessType === 'elevation') {
            baseRequest.bands = ['dem'];
        } else if (currentProcessType === 'height_points') {
            baseRequest.bands = ['dem'];
            baseRequest.point_count = parseInt(document.getElementById('hpPointCount').value, 10);
            baseRequest.sampling_method = document.getElementById('hpSamplingMethod')?.value || 'random';
            baseRequest.output_format = document.getElementById('hpOutputFormat')?.value || 'geojson';
        } else if (currentProcessType === 'crop') {
            // Just crop, no specific band requirement
            baseRequest.bands = availableBands.length > 0 ? availableBands.slice(0, 3) : ['red', 'green', 'blue'];
        }

        return baseRequest;
    }

    function showProcessResult(response) {
        const resultDiv = document.getElementById('processResult');
        const previewDiv = document.getElementById('processResultPreview');
        const btnDownload = document.getElementById('btnDownloadProcessed');

        if (!resultDiv || !previewDiv) return;

        // Store result info for download
        resultDiv.dataset.resultPath = response.output_path || '';
        resultDiv.dataset.resultUrl = response.download_url || '';

        // Show preview (if URL provided)
        if (response.preview_url) {
            previewDiv.innerHTML = `
                <img src="${response.preview_url}" alt="پیش‌نمایش نتیجه" style="width:100%; height:auto; max-height:300px; object-fit:contain;">
            `;
        } else if (response.output_path) {
            previewDiv.innerHTML = `
                <div class="d-flex align-items-center justify-content-center p-4 text-muted">
                    <i class="bi bi-file-earmark-image" style="font-size:3rem"></i>
                    <div class="ms-3">
                        <p>فایل پردازش شده آماده است</p>
                        <small>${response.output_path}</small>
                    </div>
                </div>
            `;
        }

        // Enable download button
        if (btnDownload) {
            btnDownload.disabled = !response.download_url;
        }

        resultDiv.style.display = 'block';
    }

    function hideProcessResult() {
        const resultDiv = document.getElementById('processResult');
        if (resultDiv) {
            resultDiv.style.display = 'none';
        }
    }

    function downloadProcessedResult() {
        const resultDiv = document.getElementById('processResult');
        if (!resultDiv) return;

        const url = resultDiv.dataset.resultUrl;
        const path = resultDiv.dataset.resultPath;

        if (url) {
            // download_url may be API-relative ("/landsat/...") — resolve it
            const absolute = url.startsWith('/') ? (window.API_BASE || '') + url : url;
            window.open(absolute, '_blank');
            showToast('دانلود آغاز شد', 'success');
            return;
        }

        if (path) {
            // Try to trigger download via backend
            return fetchAndDownload(
                `${API_BASE}/landsat/download-processed?path=${encodeURIComponent(path)}`,
                path.split('/').pop() || 'processed.tif'
            )
                .then(() => showToast('دانلود آغاز شد', 'success'))
                .catch(() => showToast('خطا در دانلود', 'error'));
        }

        showToast('فایل نتیجه یافت نشد', 'warning');
    }

    function addResultToMap() {
        const resultDiv = document.getElementById('processResult');
        if (!resultDiv) return;

        const path = resultDiv.dataset.resultPath;
        if (!path) {
            showToast('هیچ نتیجه‌ای برای نمایش وجود ندارد', 'warning');
            return;
        }

        showToast('نمایش روی نقشه در نسخه‌های آینده اضافه خواهد شد', 'info');
    }

    return {
        init,
    };
})();

// Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ProcessModule.init);
} else {
    ProcessModule.init();
}
