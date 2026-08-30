/**
 * Shahrkavi - Application Core
 * EventBus for cross-module communication, tab switching, and app initialization
 */

const EventBus = (() => {
    const events = {};

    function on(event, callback) {
        if (!events[event]) events[event] = [];
        events[event].push(callback);
        return () => off(event, callback);
    }

    function off(event, callback) {
        if (!events[event]) return;
        events[event] = events[event].filter(cb => cb !== callback);
    }

    function emit(event, data) {
        if (!events[event]) return;
        events[event].forEach(cb => {
            try {
                cb(data);
            } catch (e) {
                console.error(`EventBus error in "${event}":`, e);
            }
        });
    }

    return { on, off, emit };
})();

// Summary box state
const SummaryState = {
    region: null,
    dataset: null,
    params: null,
    results: null,
};

// Application-wide state
const AppState = {
    currentTab: '',
    currentStep: 1,   // Wizard step (1: region, 2: dataset, 3: query, 4: results, 5: process)
    selectedScene: null,  // Single selected scene ID for processing
    selectedScenes: [],   // Multiple scene IDs used for mosaics and processing
    selectedOsmLayers: [], // Names of the OSM layers selected for export/processing
    processSelectionInitialized: false,
    selectedResultDate: 'all',
    searchCriteria: {
        north: null,
        south: null,
        east: null,
        west: null,
        dateFrom: null,
        dateTo: null,
        cloudMax: 30,
        dataset: null,  // No default dataset
        bands: [],      // Selected bands for download
    },
    searchResults: [],
    osmInfo: null,  // OSM search summary {count, truncated, download_url}
    overtureInfo: null,  // Overture Maps buildings summary {total, truncated, download_url}
    weatherInfo: null,  // Weather search summary {count, stations}
    earthquakeInfo: null,
    demInfo: null,  // DEM search summary {count, tiles}
    ghsInfo: null,
    cart: [],
    mapDrawings: null,  // Current map drawing layer reference
    isLoading: false,
};

const PREVIOUS_REGION_KEY = 'shahrkavi.previousRegion.v1';

/**
 * Initialize the application
 */
document.addEventListener('DOMContentLoaded', () => {
    initWizardNavigation();
    initPanelResize();
    initToastContainer();
    initHelpButton();
    initPreviousRegion();

    // Initialize cart
    updateCartUI();

    console.log('شهرکاوی - Shahrkavi initialized');
});

/** Remember the last valid region locally so it can be reused later. */
function initPreviousRegion() {
    const fieldIds = ['North', 'South', 'East', 'West'];
    fieldIds.forEach(id => {
        const field = document.getElementById(id);
        if (field) field.addEventListener('change', saveRegionFromForm);
    });

    const useButton = document.getElementById('btnUsePreviousRegion');
    if (useButton) useButton.addEventListener('click', usePreviousRegion);

    const clearButton = document.getElementById('btnClearPreviousRegion');
    if (clearButton) clearButton.addEventListener('click', clearPreviousRegion);

    EventBus.on('map:drawing:created', coords => {
        if (coords && coords.type !== 'point') saveRegionPreference(coords);
    });

    updatePreviousRegionUI(readPreviousRegion());
}

function readPreviousRegion() {
    try {
        const stored = JSON.parse(localStorage.getItem(PREVIOUS_REGION_KEY) || 'null');
        if (!stored) return null;
        const values = ['north', 'south', 'east', 'west'].map(key => Number(stored[key]));
        if (!values.every(Number.isFinite) || values[0] <= values[1] || values[2] <= values[3]) return null;
        return { north: values[0], south: values[1], east: values[2], west: values[3] };
    } catch (e) {
        return null;
    }
}

function saveRegionFromForm() {
    const region = {
        north: parseFloat(document.getElementById('North')?.value),
        south: parseFloat(document.getElementById('South')?.value),
        east: parseFloat(document.getElementById('East')?.value),
        west: parseFloat(document.getElementById('West')?.value),
    };
    if (Object.values(region).every(Number.isFinite)
        && region.north > region.south && region.east > region.west) {
        saveRegionPreference(region);
    }
}

function saveRegionPreference(region) {
    if (!region) return;
    const values = [region.north, region.south, region.east, region.west].map(Number);
    if (!values.every(Number.isFinite) || values[0] <= values[1] || values[2] <= values[3]) return;
    const saved = { north: values[0], south: values[1], east: values[2], west: values[3] };
    try {
        localStorage.setItem(PREVIOUS_REGION_KEY, JSON.stringify(saved));
    } catch (e) { /* storage may be unavailable in private/restricted contexts */ }
    updatePreviousRegionUI(saved);
}

function usePreviousRegion() {
    const region = readPreviousRegion();
    if (!region) {
        updatePreviousRegionUI(null);
        showToast('منطقه ذخیره‌شده‌ای یافت نشد', 'warning');
        return;
    }

    ['North', 'South', 'East', 'West'].forEach(id => {
        const key = id.toLowerCase();
        const field = document.getElementById(id);
        if (field) field.value = region[key].toFixed(4);
    });

    AppState.mapDrawings = null;
    if (typeof MapModule !== 'undefined' && MapModule.showSelectionBounds) {
        MapModule.showSelectionBounds(region.north, region.south, region.east, region.west);
        if (MapModule.fitBounds) {
            MapModule.fitBounds(region.north, region.south, region.east, region.west);
        }
    }
    setSummaryRegion(region.north, region.south, region.east, region.west);
    showToast('منطقه قبلی استفاده شد', 'success');
}

function clearPreviousRegion() {
    try {
        localStorage.removeItem(PREVIOUS_REGION_KEY);
    } catch (e) { /* ignore unavailable storage */ }
    updatePreviousRegionUI(null);
    showToast('منطقه ذخیره‌شده حذف شد', 'info');
}

function updatePreviousRegionUI(region) {
    const card = document.getElementById('previousRegionCard');
    const summary = document.getElementById('previousRegionSummary');
    const useButton = document.getElementById('btnUsePreviousRegion');
    const clearButton = document.getElementById('btnClearPreviousRegion');
    const hasRegion = !!region;
    if (card) card.classList.toggle('has-region', hasRegion);
    if (summary) {
        summary.textContent = hasRegion
            ? `شمال ${toPersianNum(region.north.toFixed(4))}، جنوب ${toPersianNum(region.south.toFixed(4))}، شرق ${toPersianNum(region.east.toFixed(4))}، غرب ${toPersianNum(region.west.toFixed(4))}`
            : 'هنوز منطقه‌ای ذخیره نشده است';
    }
    if (useButton) useButton.disabled = !hasRegion;
    if (clearButton) clearButton.disabled = !hasRegion;
}

/**
 * Help button handler - shows usage instructions
 */
function initHelpButton() {
    const btnHelp = document.getElementById('btnHelp');
    if (!btnHelp) return;

    btnHelp.addEventListener('click', () => {
        const helpHtml = `
            <div class="modal fade" id="helpModal" tabindex="-1">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">
                                <i class="bi bi-question-circle text-primary me-2"></i>راهنمای استفاده
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <h6 class="fw-bold"><i class="bi bi-search text-primary me-1"></i> جستجو</h6>
                            <p class="text-muted small">محدوده جغرافیایی را در فرم وارد کنید یا از ابزارهای نقشه برای ترسیم محدوده استفاده کنید. سپس دیتاست موردنظر را انتخاب کرده و دکمه جستجو را بزنید.</p>
                            <hr>
                            <h6 class="fw-bold"><i class="bi bi-pentagon text-primary me-1"></i> ابزارهای نقشه</h6>
                            <p class="text-muted small">با ابزارهای نقطه، مستطیل و چندضلعی می‌توانید محدوده موردنظر را روی نقشه انتخاب کنید. دکمه پاک‌کن برای حذف شکل‌های ترسیم‌شده است.</p>
                            <hr>
                            <h6 class="fw-bold"><i class="bi bi-database text-primary me-1"></i> دیتاست‌ها</h6>
                            <p class="text-muted small">از درخت دیتاست‌ها، ماهواره‌های Landsat، Sentinel، MODIS و غیره را انتخاب کنید.</p>
                            <hr>
                            <h6 class="fw-bold"><i class="bi bi-cart text-primary me-1"></i> سبد دانلود</h6>
                            <p class="text-muted small">نتایج موردنظر را به سبد اضافه کرده و سپس از دکمه سبد، دانلود را آغاز کنید.</p>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-primary btn-sm" data-bs-dismiss="modal">باشه</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const existing = document.getElementById('helpModal');
        if (existing) existing.remove();

        document.body.insertAdjacentHTML('beforeend', helpHtml);

        const modalEl = document.getElementById('helpModal');
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
        modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove());
    });
}

/**
 * Wizard navigation logic
 * Steps: 1 = Search, 2 = Datasets, 3 = Layers, 4 = Results
 * Tabs are locked: users move forward/backward only via the wizard buttons.
 */
function initWizardNavigation() {
    // Step tab mapping
    const STEP_TABS = {
        1: 'tab-region',
        2: 'tab-dataset',
        3: 'tab-query',
        4: 'tab-results',
        5: 'tab-process',
    };

    // Lock tab buttons: clicking them does nothing (wizard-only navigation)
    document.querySelectorAll('#appTabs .nav-link').forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
        });
    });

    // Next button handlers
    document.querySelectorAll('.btn-next').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetStep = parseInt(btn.dataset.nextStep);
            if (targetStep < 1 || targetStep > 5) return;

            // A search is triggered when leaving the dataset step for a
            // skip-query dataset (DEM/OVT) or when leaving the query step,
            // so spin the button until the search responds.
            const dataset = AppState.searchCriteria.dataset || '';
            const triggersSearch =
                (AppState.currentStep === 2 && targetStep === 3
                    && DatasetsModule && DatasetsModule.skipsQuery(dataset)) ||
                (AppState.currentStep === 3 && targetStep === 4);

            if (triggersSearch) {
                withButtonLoading(btn, () => nextStep(targetStep), 'در حال جستجو...');
            } else {
                nextStep(targetStep);
            }
        });
    });

    // Prev button handlers
    document.querySelectorAll('.btn-prev').forEach(btn => {
        btn.addEventListener('click', () => {
            let targetStep = parseInt(btn.dataset.prevStep);
            const dataset = AppState.searchCriteria.dataset || '';
            // For DEM, skip the query tab when going back from results
            if (targetStep === 3 && dataset === 'DEM' && AppState.currentStep >= 4) {
                targetStep = 2;
            }
            // For OVT, skip both query and results tabs when going back from process
            if (targetStep === 4 && dataset === 'OVT' && AppState.currentStep === 5) {
                targetStep = 2;
            }
            if (targetStep >= 1 && targetStep <= 5) {
                goToStep(targetStep);
            }
        });
    });

    /**
     * Move to the next step in the wizard
     */
    function nextStep(targetStep) {
        // Validate current step before advancing
        if (AppState.currentStep === 1) {
            if (!validateRegionStep()) return;
        } else if (AppState.currentStep === 2) {
            if (!validateDatasetStep()) return;
            // DEM and OVT skip the query step: run search and go to results/process
            const dataset = AppState.searchCriteria.dataset || '';
            if (targetStep === 3 && DatasetsModule && DatasetsModule.skipsQuery(dataset)) {
                return SearchModule.execute();
            }
        } else if (AppState.currentStep === 3) {
            // Step 3 -> 4: execute search first
            return SearchModule.execute();
        } else if (AppState.currentStep === 4) {
            // Step 4 -> 5: validate that a scene is selected
            if (!validateResultsStep()) return;
        }

        goToStep(targetStep);
    }

    /**
     * Navigate to a specific wizard step
     */
    function goToStep(step) {
        if (step < 1 || step > 5) return;
        AppState.currentStep = step;

        const tabEl = document.getElementById(STEP_TABS[step]);
        if (tabEl) {
            const tab = bootstrap.Tab.getOrCreateInstance(tabEl);
            tab.show();
        }

        AppState.currentTab = tabEl ? tabEl.id.replace('tab-', '') : '';
        EventBus.emit('tab:changed', AppState.currentTab);

        // Resize map when returning to a step
        if (typeof MapModule !== 'undefined' && MapModule.map()) {
            setTimeout(() => MapModule.invalidateSize(), 100);
        }

        updateWizardButtons();
    }

    /**
     * Enable/disable wizard buttons based on current step
     */
    function updateWizardButtons() {
        const step = AppState.currentStep;

        document.querySelectorAll('.btn-prev').forEach(btn => {
            btn.disabled = step === 1;
        });
        document.querySelectorAll('.btn-next').forEach(btn => {
            btn.disabled = step === 5;
        });
    }

    /**
     * Validate the region step (Step 1) - coordinates required
     */
    function validateRegionStep() {
        const north = parseFloat(document.getElementById('North').value);
        const south = parseFloat(document.getElementById('South').value);
        const east = parseFloat(document.getElementById('East').value);
        const west = parseFloat(document.getElementById('West').value);

        if (![north, south, east, west].every(Number.isFinite)) {
            showToast('لطفاً محدوده جغرافیایی را مشخص کنید (فرم یا نقشه)', 'warning');
            return false;
        }
        if (north <= south) {
            showToast('عرض شمالی باید بزرگتر از عرض جنوبی باشد', 'error');
            return false;
        }
        if (east <= west) {
            showToast('طول شرقی باید بزرگتر از طول غربی باشد', 'error');
            return false;
        }
        saveRegionPreference({ north, south, east, west });
        // Update summary
        setSummaryRegion(north, south, east, west);
        return true;
    }

    /**
     * Validate the dataset step (Step 2) - single dataset required
     */
    function validateDatasetStep() {
        const selected = AppState.searchCriteria.dataset;
        if (!selected) {
            showToast('لطفاً یک دیتاست انتخاب کنید', 'warning');
            return false;
        }
        // Update summary
        const ds = DatasetsModule.DATASETS.find(d => d.id === selected);
        setSummaryDataset(selected, ds ? ds.name : selected, ds ? ds.info : null);
        return true;
    }

    /**
     * Validate the results step (Step 4) - at least one scene or OSM layer
     * must be selected depending on the active dataset.
     */
    function validateResultsStep() {
        const dataset = AppState.searchCriteria.dataset || '';
        if (dataset === 'OSM') {
            if (!Array.isArray(AppState.selectedOsmLayers) || AppState.selectedOsmLayers.length === 0) {
                showToast('لطفاً حداقل یک لایه از جدول نتایج انتخاب کنید', 'warning');
                return false;
            }
            return true;
        }
        if (dataset === 'WTH') {
            // Weather stations have no selection step; the process tab is not
            // applicable, so nothing is validated here.
            return true;
        }
        if (dataset === 'USGS_EQ') return true;
        if (dataset === 'OVT') {
            // Overture buildings have no selection step either.
            return true;
        }
        if (dataset === 'DEM') {
            // DEM tiles: require at least one tile selected
            if (!Array.isArray(AppState.selectedScenes) || AppState.selectedScenes.length === 0) {
                showToast('لطفاً حداقل یک کاشی DEM از جدول نتایج انتخاب کنید', 'warning');
                return false;
            }
            return true;
        }
        if (dataset.startsWith('GHS_')) return true;
        if (!Array.isArray(AppState.selectedScenes) || AppState.selectedScenes.length === 0) {
            showToast('لطفاً حداقل یک تصویر از جدول نتایج انتخاب کنید', 'warning');
            return false;
        }
        return true;
    }

    // Expose wizard navigation for other modules
    window.WizardNavigation = {
        goToStep,
        nextStep,
    };
}

/**
 * Panel resize functionality
 */
function initPanelResize() {
    const handle = document.getElementById('panelResizeHandle');
    const sidePanel = document.getElementById('sidePanel');
    let isResizing = false;
    let startX, startWidth;

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = sidePanel.offsetWidth;
        handle.classList.add('active');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
        if (!isResizing) return;
        // RTL: the handle is on the left edge of the side panel
        const delta = startX - e.clientX;
        const newWidth = Math.max(280, Math.min(600, startWidth + delta));
        sidePanel.style.width = newWidth + 'px';
    }

    function onMouseUp() {
        isResizing = false;
        handle.classList.remove('active');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        // Invalidate map size after resize
        if (typeof MapModule !== 'undefined' && MapModule.map()) {
            MapModule.invalidateSize();
        }
    }
}

/**
 * Toast notification container
 */
function initToastContainer() {
    const container = document.createElement('div');
    container.className = 'app-toast toast-container';
    document.body.appendChild(container);
}

/**
 * Show a toast notification
 */
function showToast(message, type = 'info') {
    const container = document.querySelector('.app-toast');
    if (!container) return;

    const icons = {
        success: 'bi-check-circle-fill text-success',
        error: 'bi-exclamation-circle-fill text-danger',
        warning: 'bi-exclamation-triangle-fill text-warning',
        info: 'bi-info-circle-fill text-primary',
    };

    const toastEl = document.createElement('div');
    toastEl.className = `toast align-items-center border-0 fade-in`;
    toastEl.setAttribute('role', 'alert');
    toastEl.innerHTML = `
        <div class="d-flex">
            <div class="toast-body d-flex align-items-center gap-2">
                <i class="bi ${icons[type] || icons.info}"></i>
                ${message}
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
    `;

    container.appendChild(toastEl);

    const toast = new bootstrap.Toast(toastEl, { delay: 3000 });
    toast.show();

    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

/**
 * Update the cart UI
 */
function updateCartUI() {
    const btnCart = document.getElementById('btnCart');
    const cartCount = document.getElementById('cartCount');
    const count = AppState.cart.length;

    // Enable/disable the download cart button based on cart contents
    if (btnCart) btnCart.disabled = count === 0;

    // Update the badge count in place (never recreate the button markup,
    // otherwise the #cartCount element is lost and later updates throw)
    if (cartCount) {
        cartCount.textContent = toPersianNum(count);
    }

    // Toggle the cart icon
    if (btnCart) {
        const icon = btnCart.querySelector('i');
        if (icon) {
            icon.className = count > 0 ? 'bi bi-cart-check' : 'bi bi-cart';
        }
    }
}

/**
 * Add item to cart
 */
function addToCart(sceneId) {
    if (!AppState.cart.includes(sceneId)) {
        AppState.cart.push(sceneId);
        updateCartUI();
        EventBus.emit('cart:updated', AppState.cart);
        showToast(`تصویر ${sceneId} به سبد دانلود افزوده شد`, 'success');
    } else {
        showToast('این تصویر قبلاً به سبد اضافه شده است', 'warning');
    }
}

/**
 * Remove item from cart
 */
function removeFromCart(sceneId) {
    AppState.cart = AppState.cart.filter(id => id !== sceneId);
    updateCartUI();
    EventBus.emit('cart:updated', AppState.cart);
}

/**
 * Trigger a browser download for a URL
 */
function triggerDownload(url) {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
}

/**
 * Disable a button and replace its label with a spinner while an async
 * operation runs, then restores the original state once the returned
 * promise settles (success or failure).
 * @param {HTMLElement|null} btn
 * @param {() => any} task - function returning a promise (or a value)
 * @param {string} [label] - text shown next to the spinner while busy
 * @returns {Promise}
 */
function withButtonLoading(btn, task, label) {
    if (!btn) {
        return Promise.resolve().then(task);
    }
    const originalHtml = btn.innerHTML;
    const wasDisabled = btn.disabled;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> ${label || 'در حال بارگذاری...'}`;
    return Promise.resolve()
        .then(task)
        .finally(() => {
            btn.disabled = wasDisabled;
            btn.innerHTML = originalHtml;
        });
}

/**
 * Fetch a file from the backend and save it to disk as a blob download.
 * Useful so a caller can wait for the HTTP response before re-enabling the
 * triggering button (unlike `triggerDownload`, which is fire-and-forget).
 * @param {string} url
 * @param {string} [fallbackFilename]
 * @returns {Promise<string|null>} the resolved filename, or null on error
 */
async function fetchAndDownload(url, fallbackFilename) {
    const res = await fetch(url);
    if (!res.ok) {
        let msg = `خطا در دانلود (${res.status})`;
        try {
            const err = await res.json();
            if (err.detail || err.message) msg = err.detail || err.message;
        } catch (e) { /* ignore */ }
        throw new Error(msg);
    }
    const blob = await res.blob();
    let name = fallbackFilename || '';
    const cd = res.headers.get('Content-Disposition') || '';
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    if (match && match[1]) name = decodeURIComponent(match[1]);
    const urlObj = URL.createObjectURL(blob);
    try {
        const a = document.createElement('a');
        a.href = urlObj;
        a.download = name || 'download';
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        URL.revokeObjectURL(urlObj);
    }
    return name || null;
}

/**
 * Download a single scene as an image (no cart needed)
 */
function downloadScene(sceneId) {
    if (!sceneId) return;
    const url = `${API_BASE}/landsat/download-image?scene_id=${encodeURIComponent(sceneId)}`;
    showToast(`در حال دانلود تصویر ${sceneId}...`, 'info');
    triggerDownload(url);
}

/**
 * Download all cart items as a compressed ZIP file
 */
function downloadCart() {
    if (AppState.cart.length === 0) {
        showToast('سبد دانلود خالی است', 'warning');
        return;
    }
    const ids = AppState.cart.map(encodeURIComponent).join(',');
    const url = `${API_BASE}/landsat/download-zip?scene_ids=${ids}`;
    showToast(`در حال آماده‌سازی ${toPersianNum(AppState.cart.length)} تصویر به صورت فایل فشرده...`, 'info');
    return fetchAndDownload(url, 'shahrkavi_download.zip')
        .then(() => showToast('دانلود آغاز شد', 'success'))
        .catch(error => showToast(error.message, 'error'));
}

/**
 * Convert English numbers to Persian numbers
 */
function toPersianNum(num) {
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return String(num).replace(/\d/g, d => persianDigits[parseInt(d)]);
}

/**
 * Jalali <-> Gregorian conversion (jalaali-js algorithms).
 * Accurate across leap-year boundaries, unlike naive 33-year approximations.
 */
const JALALI_BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
    1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

function _jdiv(a, b) { return ~~(a / b); }
function _jmod(a, b) { return a - ~~(a / b) * b; }

function _jalCal(jy) {
    const bl = JALALI_BREAKS.length;
    const gy = jy + 621;
    let leapJ = -14;
    let jp = JALALI_BREAKS[0];
    let jm, jump = 0, leap, n, i;

    if (jy < jp || jy >= JALALI_BREAKS[bl - 1]) {
        throw new Error('Invalid Jalali year ' + jy);
    }
    for (i = 1; i < bl; i += 1) {
        jm = JALALI_BREAKS[i];
        jump = jm - jp;
        if (jy < jm) break;
        leapJ = leapJ + _jdiv(jump, 33) * 8 + _jdiv(_jmod(jump, 33), 4);
        jp = jm;
    }
    n = jy - jp;
    leapJ = leapJ + _jdiv(n, 33) * 8 + _jdiv(_jmod(n, 33) + 3, 4);
    if (_jmod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

    const leapG = _jdiv(gy, 4) - _jdiv((_jdiv(gy, 100) + 1) * 3, 4) - 150;
    const march = 20 + leapJ - leapG;

    if (jump - n < 6) n = n - jump + _jdiv(jump + 4, 33) * 33;
    leap = _jmod(_jmod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;

    return { leap: leap, gy: gy, march: march };
}

function _g2d(gy, gm, gd) {
    let d = _jdiv((gy + _jdiv(gm - 8, 6) + 100100) * 1461, 4)
        + _jdiv(153 * _jmod(gm + 9, 12) + 2, 5)
        + gd - 34840408;
    d = d - _jdiv(_jdiv(gy + 100100 + _jdiv(gm - 8, 6), 100) * 3, 4) + 752;
    return d;
}

function _d2g(jdn) {
    let j = 4 * jdn + 139361631;
    j = j + _jdiv(_jdiv(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    const i = _jdiv(_jmod(j, 1461), 4) * 5 + 308;
    const gd = _jdiv(_jmod(i, 153), 5) + 1;
    const gm = _jmod(_jdiv(i, 153), 12) + 1;
    const gy = _jdiv(j, 1461) - 100100 + _jdiv(8 - gm, 6);
    return [gy, gm, gd];
}

/**
 * Convert Gregorian date to Jalali (Shamsi) date
 * @param {number} gy - Gregorian year
 * @param {number} gm - Gregorian month (1-12)
 * @param {number} gd - Gregorian day
 * @returns {number[]} [jy, jm, jd] Jalali year, month, day
 */
function gregorianToJalali(gy, gm, gd) {
    const jdn = _g2d(gy, gm, gd);
    let jy = gy - 621;
    const r = _jalCal(jy);
    const jdn1f = _g2d(r.gy, 3, r.march);
    let k = jdn - jdn1f;
    let jm, jd;

    if (k >= 0) {
        if (k <= 185) {
            jm = 1 + _jdiv(k, 31);
            jd = _jmod(k, 31) + 1;
            return [jy, jm, jd];
        }
        k -= 186;
    } else {
        jy -= 1;
        k += 179;
        if (r.leap === 1) k += 1;
    }
    jm = 7 + _jdiv(k, 30);
    jd = _jmod(k, 30) + 1;
    return [jy, jm, jd];
}

/**
 * Convert Jalali (Shamsi) date to Gregorian date
 * @param {number} jy - Jalali year
 * @param {number} jm - Jalali month (1-12)
 * @param {number} jd - Jalali day
 * @returns {number[]} [gy, gm, gd] Gregorian year, month, day
 */
function jalaliToGregorian(jy, jm, jd) {
    const r = _jalCal(jy);
    const jdn = _g2d(r.gy, 3, r.march) + (jm - 1) * 31 - _jdiv(jm, 7) * (jm - 7) + jd - 1;
    return _d2g(jdn);
}

/**
 * Number of days in a Jalali month
 */
function jalaliMonthLength(jy, jm) {
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    return _jalCal(jy).leap === 0 ? 30 : 29;
}

/** ISO "YYYY-MM-DD" -> Jalali display string with Persian digits */
function isoToJalaliString(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const [jy, jm, jd] = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    const mm = String(jm).padStart(2, '0');
    const dd = String(jd).padStart(2, '0');
    return toPersianNum(`${jy}/${mm}/${dd}`);
}

/** Latin digits for parsing typed input */
function toLatinDigits(str) {
    return String(str ?? '')
        .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
        .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/** Jalali string like "1404/06/15" (either digit set) -> ISO "2025-09-06" or '' */
function jalaliStringToIso(str) {
    const clean = toLatinDigits(str).trim().replace(/[-.]/g, '/');
    const m = clean.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (!m) return '';
    const jy = parseInt(m[1], 10), jm = parseInt(m[2], 10), jd = parseInt(m[3], 10);
    if (jm < 1 || jm > 12 || jd < 1 || jd > jalaliMonthLength(jy, jm)) return '';
    const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
    return `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
}

/**
 * Format a date string to Persian (Jalali) display format
 */
function toPersianDate(dateStr) {
    if (!dateStr) return '---';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '---';
    const [jy, jm, jd] = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return `${toPersianNum(jy)}/${toPersianNum(jm)}/${toPersianNum(jd)}`;
}

/**
 * Toggle loading state
 */
function setLoading(loading) {
    AppState.isLoading = loading;
    const searchBtn = document.getElementById('btnSearch');
    if (searchBtn) {
        if (loading) {
            searchBtn.disabled = true;
            searchBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> در حال جستجو...';
        } else {
            searchBtn.disabled = false;
            searchBtn.innerHTML = '<i class="bi bi-search"></i> جستجو';
        }
    }
}

/**
 * Summary box helpers
 */
function toFaNum(n) {
    return String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

function formatCoord(v) {
    return Number.isFinite(v) ? toFaNum(v.toFixed(4)) : '---';
}

function updateSummary() {
    const body = document.getElementById('summaryBody');
    if (!body) return;

    const hasData = SummaryState.region || SummaryState.dataset || SummaryState.params || SummaryState.results;
    if (!hasData) {
        body.innerHTML = `<div class="summary-empty"><i class="bi bi-info-circle"></i><span>اطلاعات درخواست اینجا نمایش داده میشود</span></div>`;
        return;
    }

    let html = '';

    if (SummaryState.region) {
        const r = SummaryState.region;
        html += `<div class="summary-row"><span class="summary-key">محدوده:</span><span class="summary-value">${r.north}–${r.south}, ${r.east}–${r.west}</span></div>`;
    }

    if (SummaryState.dataset) {
        const d = SummaryState.dataset;
        html += `<div class="summary-row"><span class="summary-key">دیتاست:</span><span class="summary-value highlight">${d.name}</span><span class="summary-badge">${d.code}</span></div>`;
    }

    if (SummaryState.params) {
        html += '<div class="summary-row">'
        SummaryState.params.forEach(p => {
            html += `<span class="summary-key">${p.label}:</span><span class="summary-value">${p.value}</span>`;
        });
        html += '</div>'
    }

    if (SummaryState.results) {
        html += '<div class="summary-row">'
        SummaryState.results.forEach(r => {
            html += `<span class="summary-key">${r.label}:</span><span class="summary-value">${r.value}</span>`;
        html += '</div>'
        });
    }

    body.innerHTML = html;
}

function setSummaryRegion(north, south, east, west) {
    if (north == null) { SummaryState.region = null; }
    else {
        SummaryState.region = { north: formatCoord(north), south: formatCoord(south), east: formatCoord(east), west: formatCoord(west) };
    }
    updateSummary();
}

function setSummaryDataset(code, name, info) {
    if (!code) { SummaryState.dataset = null; }
    else { SummaryState.dataset = { code, name, info }; }
    updateSummary();
}

function setSummaryParams(params) {
    SummaryState.params = params || null;
    updateSummary();
}

function setSummaryResults(count, selectedCount, message) {
    if (count == null) { SummaryState.results = null; }
    else {
        SummaryState.results = [
            { label: 'تعداد', value: toFaNum(count) + ' مورد' },
            ...(selectedCount != null ? [{ label: 'انتخابشده', value: toFaNum(selectedCount) + ' مورد' }] : []),
            ...(message ? [{ label: 'وضعیت', value: message }] : []),
        ];
    }
    updateSummary();
}

function clearSummary() {
    SummaryState.region = null;
    SummaryState.dataset = null;
    SummaryState.params = null;
    SummaryState.results = null;
    updateSummary();
}

// Init summary
document.addEventListener('DOMContentLoaded', () => {
    const btnClear = document.getElementById('btnSummaryClear');
    if (btnClear) {
        btnClear.addEventListener('click', clearSummary);
    }
    updateSummary();
});
