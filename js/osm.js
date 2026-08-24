/**
 * Shahrkavi - OSM Tag Filter Module
 * Manages the key/value pair rows used to filter OpenStreetMap data.
 * Both the key and the value are Bootstrap dropdowns. Selecting a key
 * loads the common values for that tag key (via Taginfo) into the value
 * dropdown of the same row.
 */

const OsmModule = (() => {
    let rowCounter = 0;

    const COMMON_KEYS = [
        'highway', 'amenity', 'building', 'landuse', 'natural', 'waterway',
        'barrier', 'leisure', 'tourism', 'shop', 'office', 'power',
        'man_made', 'railway', 'aeroway', 'place', 'boundary', 'route',
        'craft', 'historic', 'military', 'aerialway', 'public_transport',
        'service', 'emergency', 'healthcare', 'sport', 'religion', 'surface',
        'name', 'ref', 'operator', 'access',
    ];

    const VALUE_LIMIT = 50;

    const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
    function toFaNum(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/\d/g, d => FA_DIGITS[+d]);
    }

    function formatCount(n) {
        const num = Number(n || 0);
        if (num >= 1e6) return toFaNum((num / 1e6).toFixed(1).replace(/\.0$/, '')) + ' میلیون';
        if (num >= 1e3) return toFaNum(Math.round(num / 1e3)) + ' هزار';
        return toFaNum(num);
    }

    function init() {
        const addBtn = document.getElementById('btnAddOsmPair');
        if (addBtn) {
            addBtn.addEventListener('click', () => addPairRow());
        }

        // Start with one empty row
        addPairRow();

        console.log('OSM module initialized');
    }

    /**
     * Build a key/value pair row with Bootstrap dropdowns.
     */
    function addPairRow(key, value) {
        const container = document.getElementById('osmTagPairs');
        if (!container) return null;

        rowCounter += 1;
        const rowId = rowCounter;

        const row = document.createElement('div');
        row.className = 'osm-pair-row row g-1 align-items-center mb-2';
        row.innerHTML = `
            <div class="col-5">
                <div class="dropdown osm-key-dropdown w-100">
                    <input type="hidden" class="osm-key-input" value="${escapeAttr(key || '')}">
                    <button class="btn btn-sm btn-outline-secondary w-100 dropdown-toggle text-truncate"
                            type="button" data-bs-toggle="dropdown" aria-expanded="false">
                        <span class="osm-key-label">${key ? escapeAttr(key) : 'کلید را انتخاب کنید'}</span>
                    </button>
                    <input type="text" class="form-control form-control-sm osm-key-custom d-none"
                           placeholder="کلید دلخواه (Enter برای ثبت)" dir="ltr">
                    <ul class="dropdown-menu osm-key-menu w-100" style="max-height:280px; overflow-y:auto;">
                        <li><a class="dropdown-item" href="#" data-custom="1"><i class="bi bi-keyboard"></i> کلید دلخواه...</a></li>
                        <li><hr class="dropdown-divider"></li>
                        ${COMMON_KEYS.map(k =>
                            `<li><a class="dropdown-item" href="#" data-key="${escapeAttr(k)}" dir="ltr">${escapeAttr(k)}</a></li>`
                        ).join('')}
                    </ul>
                </div>
            </div>
            <div class="col-5">
                <div class="dropdown osm-value-dropdown w-100">
                    <input type="hidden" class="osm-value-input" value="${escapeAttr(value || '')}">
                    <button class="btn btn-sm btn-outline-secondary w-100 dropdown-toggle text-truncate"
                            type="button" data-bs-toggle="dropdown" aria-expanded="false">
                        <span class="osm-value-label">${value ? escapeAttr(value) : 'مقدار را انتخاب کنید'}</span>
                    </button>
                    <ul class="dropdown-menu osm-value-menu w-100" style="max-height:280px; overflow-y:auto;">
                        <li><span class="dropdown-item-text small text-muted">ابتدا کلید را انتخاب کنید</span></li>
                    </ul>
                </div>
            </div>
            <div class="col-2 d-flex align-items-center gap-1">
                <div class="form-check form-check-inline m-0">
                    <input class="form-check-input osm-any-check" type="checkbox" id="any-${rowId}" title="هر مقداری">
                    <label class="form-check-label small" for="any-${rowId}" style="font-size:0.7rem">هر مقدار</label>
                </div>
                <button type="button" class="btn btn-sm btn-outline-danger osm-remove-pair ms-auto" title="حذف">
                    <i class="bi bi-x"></i>
                </button>
            </div>
        `;

        const keyInput = row.querySelector('.osm-key-input');
        const keyBtn = row.querySelector('.osm-key-dropdown .dropdown-toggle');
        const keyLabel = row.querySelector('.osm-key-label');
        const keyCustom = row.querySelector('.osm-key-custom');
        const keyMenu = row.querySelector('.osm-key-menu');

        const valueInput = row.querySelector('.osm-value-input');
        const valueLabel = row.querySelector('.osm-value-label');
        const valueBtn = row.querySelector('.osm-value-dropdown .dropdown-toggle');
        const valueMenu = row.querySelector('.osm-value-menu');
        const anyCheck = row.querySelector('.osm-any-check');

        // --- Key selection -------------------------------------------------

        function setKey(val) {
            keyInput.value = val;
            keyLabel.textContent = val;
            keyCustom.classList.add('d-none');
            keyBtn.classList.remove('d-none');
            // Selecting a new key invalidates the old value
            valueInput.value = '';
            valueLabel.textContent = 'مقدار را انتخاب کنید';
            loadValuesForKey(val, valueMenu);
        }

        function enterCustomKey() {
            keyBtn.classList.add('d-none');
            keyCustom.classList.remove('d-none');
            keyCustom.focus();
        }

        keyMenu.addEventListener('click', (e) => {
            const item = e.target.closest('.dropdown-item');
            if (!item) return;
            e.preventDefault();
            if (item.dataset.custom) {
                enterCustomKey();
                return;
            }
            const val = item.getAttribute('data-key');
            if (val) setKey(val);
        });

        keyCustom.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = keyCustom.value.trim();
                if (val) {
                    setKey(val);
                } else {
                    keyCustom.classList.add('d-none');
                    keyBtn.classList.remove('d-none');
                }
                keyCustom.blur();
            }
            if (e.key === 'Escape') {
                keyCustom.classList.add('d-none');
                keyBtn.classList.remove('d-none');
                keyCustom.value = '';
            }
        });

        // --- "any value" checkbox -------------------------------------------

        anyCheck.addEventListener('change', () => {
            valueBtn.disabled = anyCheck.checked;
            if (anyCheck.checked) {
                valueInput.value = '';
                valueLabel.textContent = 'هر مقدار';
            } else if (!valueInput.value) {
                valueLabel.textContent = 'مقدار را انتخاب کنید';
            }
        });

        // --- Value selection -------------------------------------------------

        valueMenu.addEventListener('click', (e) => {
            const item = e.target.closest('.dropdown-item');
            if (!item) return;
            e.preventDefault();
            const val = item.getAttribute('data-value');
            valueInput.value = val;
            valueLabel.textContent = val;
        });

        // --- Remove row ------------------------------------------------------

        row.querySelector('.osm-remove-pair').addEventListener('click', () => {
            row.remove();
        });

        container.appendChild(row);
        return row;
    }

    async function loadValuesForKey(key, valueMenu) {
        if (!key) return;

        valueMenu.innerHTML =
            '<li><span class="dropdown-item-text small text-muted">در حال بارگذاری مقادیر...</span></li>';

        try {
            const res = await fetch(
                `http://127.0.0.1:8000/osm/tag-values?key=${encodeURIComponent(key)}`
            );
            if (!res.ok) throw new Error('bad status');
            const data = await res.json();
            const values = (data.values || []).slice(0, VALUE_LIMIT);

            if (values.length === 0) {
                valueMenu.innerHTML =
                    '<li><span class="dropdown-item-text small text-muted">مقداری برای این کلید یافت نشد؛ مقدار دلخواه را در منوی کلید دلخواه تایپ کنید.</span></li>';
                return;
            }

            valueMenu.innerHTML = values.map(v =>
                `<li>
                    <a class="dropdown-item d-flex justify-content-between align-items-center gap-2" href="#"
                       data-value="${escapeAttr(v.value)}" dir="ltr">
                        <span class="text-truncate">${escapeAttr(v.value)}</span>
                        <span class="text-muted small text-nowrap">${formatCount(v.count)}</span>
                    </a>
                </li>`
            ).join('');
        } catch (e) {
            valueMenu.innerHTML =
                '<li><span class="dropdown-item-text small text-muted">خطا در بارگذاری مقادیر؛ مقدار دلخواه را تایپ کنید.</span></li>';
            console.error('OSM tag-values error:', e);
        }
    }

    /**
     * Collect all non-empty key/value pairs from the UI.
     * Returns [{ key, value, any }].
     */
    function collectPairs() {
        const pairs = [];
        document.querySelectorAll('.osm-pair-row').forEach(row => {
            const key = row.querySelector('.osm-key-input').value.trim();
            if (!key) return;
            const any = row.querySelector('.osm-any-check').checked;
            const value = any ? '' : row.querySelector('.osm-value-input').value.trim();
            pairs.push({ key, value, any });
        });
        return pairs;
    }

    function escapeAttr(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    return {
        init,
        addPairRow,
        collectPairs,
        COMMON_KEYS,
    };
})();

// Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', OsmModule.init);
} else {
    OsmModule.init();
}