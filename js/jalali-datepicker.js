/**
 * Shahrkavi - Jalali (Shamsi) Range Date Picker Adapter
 * Wraps MD.BootstrapPersianDateTimePicker (v4.4.0) and exposes the same
 * public API as the previous inline JalaliDatePicker.
 *
 * Values are ISO Gregorian strings (YYYY-MM-DD) throughout.
 */

const JalaliDatePicker = (() => {
    const GROUP_ID = 'shahrkavi-range';

    let startInput = null;
    let endInput = null;
    let startIsoInput = null;
    let endIsoInput = null;
    let startPicker = null;
    let endPicker = null;
    let initialized = false;

    const changeListeners = [];
    const viewChangeListeners = [];
    let availableIsoDates = new Set();
    let lastNotifiedRangeKey = '';

    // ---------- helpers ----------

    function isoToDate(iso) {
        if (!iso) return null;
        const parts = String(iso).split('-').map(Number);
        if (parts.length !== 3 || parts.some(isNaN)) return null;
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }

    function dateToIso(date) {
        if (!date || isNaN(date.getTime())) return null;
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function readHiddenIso(input) {
        if (!input) return '';
        const v = (input.value || '').trim();
        const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
    }

    function notify() {
        const range = getRange();
        const key = `${range.start || ''}|${range.end || ''}`;
        if (key === lastNotifiedRangeKey) return;
        lastNotifiedRangeKey = key;
        changeListeners.forEach(cb => {
            try { cb(range); } catch (e) { console.error(e); }
        });
        if (startInput) {
            startInput.dispatchEvent(new CustomEvent('jalalirangechange', { detail: range }));
        }
    }

    function notifyViewChange() {
        if (!startPicker) return;
        const setting = startPicker.setting || {};
        const showDate = setting.selectedDateToShow || new Date();
        const y = showDate.getFullYear();
        const m = showDate.getMonth();
        const first = new Date(y, m - 1, 1);
        const last = new Date(y, m + 2, 0);
        const win = { start: dateToIso(first), end: dateToIso(last) };
        viewChangeListeners.forEach(cb => {
            try { cb(win); } catch (e) { console.error(e); }
        });
    }

    /**
     * Walk every currently-rendered MD popover and add/remove the
     * .jdp-hasdata class on day cells that match a date with imagery.
     * Does NOT reinitialize any picker instance, so the popover stays open.
     */
    function decoratePopoverDots() {
        if (!window.mds || !window.mds.MdsPersianDateTimePicker) return;
        const popovers = document.querySelectorAll('.mds-bs-persian-datetime-picker-popover');
        if (!popovers.length) return;

        popovers.forEach(pop => {
            pop.querySelectorAll('td.jdp-hasdata').forEach(td => td.classList.remove('jdp-hasdata'));
            pop.querySelectorAll('td[data-number]').forEach(td => {
                const numStr = td.getAttribute('data-number');
                if (!numStr) return;
                const num = parseInt(numStr, 10);
                if (!num) return;
                const jy = Math.floor(num / 10000);
                const jm = Math.floor(num / 100) % 100;
                const jd = num % 100;
                try {
                    const g = mds.MdsPersianDateTimePicker.toGregorian(jy, jm, jd);
                    const iso = `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
                    if (availableIsoDates.has(iso)) td.classList.add('jdp-hasdata');
                } catch (e) { /* ignore invalid cells */ }
            });
        });
    }

    // ---------- public API ----------

    function attach(/* container */) { /* kept for API compatibility */ }

    function init(/* selector */) {
        if (initialized) return;
        startInput = document.getElementById('dateRangeStart');
        endInput = document.getElementById('dateRangeEnd');
        startIsoInput = document.getElementById('dateRangeStartIso');
        endIsoInput = document.getElementById('dateRangeEndIso');
        if (!startInput || !endInput || !startIsoInput || !endIsoInput) {
            console.warn('JalaliDatePicker: range inputs not found in DOM');
            return;
        }
        if (!window.mds || !window.mds.MdsPersianDateTimePicker) {
            console.error('JalaliDatePicker: mds.MdsPersianDateTimePicker not loaded');
            return;
        }
        initialized = true;

        const today = new Date();

        startPicker = new mds.MdsPersianDateTimePicker(startInput, {
            targetTextSelector: '#dateRangeStart',
            targetDateSelector: '#dateRangeStartIso',
            fromDate: true,
            groupId: GROUP_ID,
            persianNumber: true,
            textFormat: 'yyyy/MM/dd',
            dateFormat: 'yyyy-MM-dd',            
            selectedDateToShow: today,
            calendarViewOnChange: function () {
                notifyViewChange();
                setTimeout(decoratePopoverDots, 30);
            }
        });

        endPicker = new mds.MdsPersianDateTimePicker(endInput, {
            targetTextSelector: '#dateRangeEnd',
            targetDateSelector: '#dateRangeEndIso',
            toDate: true,
            groupId: GROUP_ID,
            persianNumber: true,
            textFormat: 'yyyy/MM/dd',
            dateFormat: 'yyyy-MM-dd',            
            selectedDateToShow: today,
            calendarViewOnChange: function () {
                notifyViewChange();
                setTimeout(decoratePopoverDots, 30);
            }
        });

        startIsoInput.addEventListener('change', notify);
        endIsoInput.addEventListener('change', notify);

        // Whenever a popover opens, fire a view-change for the visible window
        // and decorate the popover DOM with dots for any dates we already have.
        function onPopoverShown() {
            notifyViewChange();
            setTimeout(decoratePopoverDots, 50);
        }
        startInput.addEventListener('shown.bs.popover', onPopoverShown);
        endInput.addEventListener('shown.bs.popover', onPopoverShown);
        startInput.addEventListener('inserted.bs.popover', () => setTimeout(decoratePopoverDots, 80));
        endInput.addEventListener('inserted.bs.popover', () => setTimeout(decoratePopoverDots, 80));

        setTimeout(notifyViewChange, 250);
    }

    function onChange(cb) { if (typeof cb === 'function') changeListeners.push(cb); }
    function onViewChange(cb) { if (typeof cb === 'function') viewChangeListeners.push(cb); }

    /** Highlight ISO dates that have imagery (dot under day number). */
    function setAvailableDates(isoList) {
        availableIsoDates = new Set(isoList || []);
        decoratePopoverDots();
    }

    function getRange() {
        const start = readHiddenIso(startIsoInput);
        const end = readHiddenIso(endIsoInput);
        return { start: start || null, end: end || start || null };
    }

    function setRange(startIso, endIso) {
        if (!startPicker || !endPicker) return;
        const a = isoToDate(startIso);
        const b = isoToDate(endIso || startIso);
        if (!a) { clear(); return; }
        try {
            startPicker.setDate(a);
            if (b) endPicker.setDate(b);
        } catch (e) { console.error('JalaliDatePicker.setRange failed', e); }
    }

    function clear() {
        if (!startPicker || !endPicker) return;
        try {
            startPicker.clearDate();
            endPicker.clearDate();
        } catch (e) { console.error('JalaliDatePicker.clear failed', e); }
        lastNotifiedRangeKey = '';
        notify();
    }

    function showRecentMonths() {
        if (!startPicker || !endPicker) return;
        const today = new Date();
        try {
            startPicker.updateOptions({ selectedDateToShow: today });
            endPicker.updateOptions({ selectedDateToShow: today });
        } catch (e) { /* ignore */ }
        notifyViewChange();
    }

    return {
        attach, init, onChange, onViewChange, setAvailableDates,
        getRange, setRange, clear, showRecentMonths
    };
})();

function initJalaliCalendars() { JalaliDatePicker.init(); }
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initJalaliCalendars);
} else {
    initJalaliCalendars();
}