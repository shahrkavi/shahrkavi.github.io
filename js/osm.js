/**
 * Shahrkavi - OSM Tag Filter Module
 * Manages the key/value pair rows used to filter OpenStreetMap data.
 * Both fields are comboboxes: selectable from suggestions, searchable as
 * you type, and freely typable for arbitrary keys/values.
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
     * Markup for one combobox field (input + suggestion menu).
     */
    function comboHtml(inputClass, val, placeholder) {
        return `
            <div class="osm-combo position-relative">
                <input type="text" class="form-control form-control-sm ${inputClass}"
                       value="${escapeAttr(val)}" placeholder="${escapeAttr(placeholder)}"
                       dir="ltr" autocomplete="off" spellcheck="false">
                <div class="osm-combo-menu shadow d-none"></div>
            </div>
        `;
    }

    /**
     * Attach combobox behaviour to an input + menu pair.
     * getItems() must return [{ value, hint? }]. The list is filtered by
     * whatever the user types; any typed text is accepted as-is.
     */
    function attachCombo(input, menu, getItems) {
        function render() {
            const query = input.value.trim().toLowerCase();
            const items = getItems().filter(it =>
                !query || it.value.toLowerCase().includes(query)
            );

            if (items.length === 0) {
                menu.innerHTML =
                    '<div class="osm-combo-empty">موردی یافت نشد — Enter برای استفاده از متن تایپ‌شده</div>';
            } else {
                menu.innerHTML = items.map((it, i) => `
                    <button type="button"
                            class="osm-combo-item${i === 0 ? ' active' : ''}"
                            data-value="${escapeAttr(it.value)}">
                        <span class="text-truncate" dir="ltr">${escapeAttr(it.value)}</span>
                        ${it.hint ? `<span class="text-muted small text-nowrap">${it.hint}</span>` : ''}
                    </button>
                `).join('');
            }
            menu.classList.remove('d-none');
        }

        function close() {
            menu.classList.add('d-none');
        }

        input.addEventListener('focus', render);
        input.addEventListener('input', render);

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                // Commit exactly what was typed
                e.preventDefault();
                input.dispatchEvent(new Event('change'));
                close();
                input.blur();
            } else if (e.key === 'Escape') {
                close();
                input.blur();
            }
        });

        // Delayed close so item mousedown registers first
        input.addEventListener('blur', () => setTimeout(close, 150));

        // mousedown beats the input blur
        menu.addEventListener('mousedown', (e) => {
            const item = e.target.closest('.osm-combo-item');
            if (!item) return;
            e.preventDefault();
            input.value = item.dataset.value;
            close();
            input.dispatchEvent(new Event('change'));
        });

        return { close };
    }

    async function fetchTagValues(key) {
        try {
            const res = await fetch(
                `${API_BASE}/osm/tag-values?key=${encodeURIComponent(key)}`
            );
            if (!res.ok) throw new Error('bad status');
            const data = await res.json();
            return (data.values || []).slice(0, VALUE_LIMIT).map(v => ({
                value: v.value,
                hint: formatCount(v.count),
            }));
        } catch (e) {
            console.error('OSM tag-values error:', e);
            return [];
        }
    }

    /**
     * Build a key/value pair row with two searchable/typable comboboxes.
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
                ${comboHtml('osm-key-input', key || '', 'کلید (مثلاً highway)...')}
            </div>
            <div class="col-5">
                ${comboHtml('osm-value-input', value || '', 'مقدار...')}
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

        const valueInput = row.querySelector('.osm-value-input');
        const valueMenu = valueInput.closest('.osm-combo').querySelector('.osm-combo-menu');
        const anyCheck = row.querySelector('.osm-any-check');

        let valueItems = [];
        let lastFetchedKey = null;

        attachCombo(keyInput, keyInput.closest('.osm-combo').querySelector('.osm-combo-menu'), () =>
            COMMON_KEYS.map(k => ({ value: k }))
        );
        attachCombo(valueInput, valueMenu, () => valueItems);

        // When the key is committed, refresh the value suggestions
        keyInput.addEventListener('change', async () => {
            const val = keyInput.value.trim();
            if (!val || val === lastFetchedKey) return;

            lastFetchedKey = val;
            // A new key invalidates the old value
            if (valueInput.value) {
                valueInput.value = '';
            }
            valueItems = [];
            valueItems = await fetchTagValues(val);
        });

        // --- "any value" checkbox -------------------------------------------

        anyCheck.addEventListener('change', () => {
            valueInput.disabled = anyCheck.checked;
            if (anyCheck.checked && valueInput.value) {
                valueInput.value = '';
            }
            valueInput.placeholder = anyCheck.checked ? 'هر مقداری' : 'مقدار...';
        });
        if (anyCheck.checked) valueInput.disabled = true;

        // --- Remove row ------------------------------------------------------

        row.querySelector('.osm-remove-pair').addEventListener('click', () => {
            row.remove();
        });

        container.appendChild(row);

        // Prefill: load values for a pre-set key
        if (key) {
            keyInput.dispatchEvent(new Event('change'));
        }

        return row;
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
