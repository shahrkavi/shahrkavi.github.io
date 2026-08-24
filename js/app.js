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
    weatherInfo: null,  // Weather search summary {count, stations}
    demInfo: null,  // DEM search summary {count, tiles}
    cart: [],
    mapDrawings: null,  // Current map drawing layer reference
    isLoading: false,
};

/**
 * Initialize the application
 */
document.addEventListener('DOMContentLoaded', () => {
    initWizardNavigation();
    initPanelResize();
    initToastContainer();
    initHelpButton();

    // Initialize cart
    updateCartUI();

    console.log('شهرکاوی - Shahrkavi initialized');
});

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
            if (targetStep >= 1 && targetStep <= 5) {
                nextStep(targetStep);
            }
        });
    });

    // Prev button handlers
    document.querySelectorAll('.btn-prev').forEach(btn => {
        btn.addEventListener('click', () => {
            let targetStep = parseInt(btn.dataset.prevStep);
            // For DEM, skip the query tab when going back from results
            const dataset = AppState.searchCriteria.dataset || '';
            if (targetStep === 3 && dataset === 'DEM' && AppState.currentStep >= 4) {
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
            // DEM skips the query step: run search and go to results
            const dataset = AppState.searchCriteria.dataset || '';
            if (targetStep === 3 && DatasetsModule && DatasetsModule.skipsQuery(dataset)) {
                SearchModule.execute();
                return;
            }
        } else if (AppState.currentStep === 3) {
            // Step 3 -> 4: execute search first
            SearchModule.execute();
            return; // goToStep(4) happens when search completes
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
        if (dataset === 'DEM') {
            // DEM tiles: require at least one tile selected
            if (!Array.isArray(AppState.selectedScenes) || AppState.selectedScenes.length === 0) {
                showToast('لطفاً حداقل یک کاشی DEM از جدول نتایج انتخاب کنید', 'warning');
                return false;
            }
            return true;
        }
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
 * Add all results to cart
 */
function addAllToCart() {
    const newItems = AppState.searchResults
        .map(r => r.id)
        .filter(id => !AppState.cart.includes(id));

    AppState.cart = [...AppState.cart, ...newItems];
    updateCartUI();
    EventBus.emit('cart:updated', AppState.cart);
    showToast(`${toPersianNum(newItems.length)} تصویر به سبد اضافه شد`, 'success');
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
 * Download a single scene as an image (no cart needed)
 */
function downloadScene(sceneId) {
    if (!sceneId) return;
    const url = `http://127.0.0.1:8000/landsat/download-image?scene_id=${encodeURIComponent(sceneId)}`;
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
    const url = `http://127.0.0.1:8000/landsat/download-zip?scene_ids=${ids}`;
    showToast(`در حال آماده‌سازی ${toPersianNum(AppState.cart.length)} تصویر به صورت فایل فشرده...`, 'info');
    triggerDownload(url);
}

/**
 * Convert English numbers to Persian numbers
 */
function toPersianNum(num) {
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return String(num).replace(/\d/g, d => persianDigits[parseInt(d)]);
}

/**
 * Convert Gregorian date to Jalali (Shamsi) date
 * @param {number} gy - Gregorian year
 * @param {number} gm - Gregorian month (1-12)
 * @param {number} gd - Gregorian day
 * @returns {number[]} [jy, jm, jd] Jalali year, month, day
 */
function gregorianToJalali(gy, gm, gd) {
    const gDm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let jy = gy <= 1600 ? 0 : 979;
    gy -= gy <= 1600 ? 621 : 1600;
    const gy2 = gm > 2 ? gy + 1 : gy;
    let days = 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100)
        + Math.floor((gy2 + 399) / 400) - 80 + gd + gDm[gm - 1];
    jy += 33 * Math.floor(days / 12053);
    days %= 12053;
    jy += 4 * Math.floor(days / 1461);
    days %= 1461;
    jy += Math.floor((days - 1) / 365);
    if (days > 365) days = (days - 1) % 365;
    const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
    const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
    return [jy, jm, jd];
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
