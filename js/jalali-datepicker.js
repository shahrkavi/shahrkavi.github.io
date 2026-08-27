/**
 * Shahrkavi - Jalali (Shamsi) Inline Range Calendar
 * Always-visible calendar for picking a specific date or a from/to range.
 * One click selects a specific date; a second click completes the range
 * (order-independent). Values are ISO Gregorian dates (YYYY-MM-DD).
 */

const JalaliDatePicker = (() => {
    const MONTH_NAMES = [
        'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
        'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
    ];
    const WEEK_DAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

    let instance = null;
    const changeListeners = [];
    const viewChangeListeners = [];

    // ISO dates (YYYY-MM-DD) that have imagery -> highlighted with a dot
    let availableIsoDates = new Set();

    function addMonths(jy, jm, delta) {
        let m = jm + delta;
        let y = jy;
        while (m > 12) { m -= 12; y++; }
        while (m < 1) { m += 12; y--; }
        return [y, m];
    }

    function toIso(jy, jm, jd) {
        const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
        return `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
    }

    function fromIso(iso) {
        if (!iso) return null;
        const d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        const [jy, jm, jd] = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
        return { jy, jm, jd };
    }

    function notify() {
        const range = getRange();
        changeListeners.forEach(cb => { try { cb(range); } catch (e) { console.error(e); } });
        if (instance) {
            instance.el.dispatchEvent(new CustomEvent('jalalirangechange', { detail: range }));
        }
    }

    /** First day of the left visible month to last day of the right month */
    function visibleWindow() {
        const [jy2, jm2] = addMonths(instance.viewJy, instance.viewJm, 1);
        return {
            start: toIso(instance.viewJy, instance.viewJm, 1),
            end: toIso(jy2, jm2, jalaliMonthLength(jy2, jm2)),
        };
    }

    function notifyViewChange() {
        const win = visibleWindow();
        viewChangeListeners.forEach(cb => { try { cb(win); } catch (e) { console.error(e); } });
    }

    /**
     * Attach the inline calendar to a container element
     */
    function attach(container) {
        if (!container || container.dataset.jalaliAttached) return;
        container.dataset.jalaliAttached = '1';

        const state = {
            el: container,
            viewJy: null,
            viewJm: null,
            start: null,   // ISO or null
            end: null,     // ISO or null
            picking: false // waiting for the second click of a range
        };
        instance = state;

        const today = new Date();
        [state.viewJy, state.viewJm] =
            gregorianToJalali(today.getFullYear(), today.getMonth() + 1, today.getDate());

        function buildYearOptions(current) {
            const start = current - 15;
            let html = '';
            for (let y = start; y < start + 40; y++) {
                html += `<option value="${y}" ${y === current ? 'selected' : ''}>${toPersianNum(y)}</option>`;
            }
            return html;
        }

        function renderMonth(jy, jm) {
            const length = jalaliMonthLength(jy, jm);

            // Weekday offset: Persian week starts Saturday
            const [gy1, gm1, gd1] = jalaliToGregorian(jy, jm, 1);
            const firstDay = new Date(gy1, gm1 - 1, gd1).getDay();
            const offset = (firstDay + 1) % 7;

            let daysHtml = '';
            for (let i = 0; i < offset; i++) daysHtml += '<span class="jdp-day jdp-empty"></span>';
            for (let day = 1; day <= length; day++) {
                daysHtml += `<button type="button" class="jdp-day" data-day="${day}">${toPersianNum(day)}</button>`;
            }

            return `
                <div class="jdp-month" data-jy="${jy}" data-jm="${jm}">
                    <div class="jdp-header">
                        <button type="button" class="jdp-nav" data-nav="-1">&rsaquo;</button>
                        <div class="jdp-title">
                            <select class="jdp-month-sel">
                                ${MONTH_NAMES.map((n, i) =>
                                    `<option value="${i + 1}" ${i + 1 === jm ? 'selected' : ''}>${n}</option>`
                                ).join('')}
                            </select>
                            <select class="jdp-year-sel">${buildYearOptions(jy)}</select>
                        </div>
                        <button type="button" class="jdp-nav" data-nav="1">&lsaquo;</button>
                    </div>
                    <div class="jdp-weekdays">
                        ${WEEK_DAYS.map(d => `<span>${d}</span>`).join('')}
                    </div>
                    <div class="jdp-grid">${daysHtml}</div>
                </div>
            `;
        }

        function dayClass(iso, jy, jm, day) {
            const classes = ['jdp-day'];
            const now = new Date();
            const [tjy, tjm, tjd] =
                gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
            if (tjy === jy && tjm === jm && tjd === day) classes.push('jdp-today');

            if (!state.start) {
                if (availableIsoDates.has(iso)) classes.push('jdp-hasdata');
                return classes;
            }
            if (state.picking) {
                if (iso === state.start) classes.push('jdp-selected');
                if (availableIsoDates.has(iso) && iso !== state.start) classes.push('jdp-hasdata');
                return classes;
            }
            const lo = state.start <= state.end ? state.start : state.end;
            const hi = state.start <= state.end ? state.end : state.start;
            if (iso === lo || iso === hi) {
                classes.push('jdp-selected');
            } else {
                if (iso > lo && iso < hi) classes.push('jdp-inrange');
                if (availableIsoDates.has(iso)) classes.push('jdp-hasdata');
            }
            return classes;
        }

        function footerHtml() {
            let label;
            if (!state.start) {
                label = 'تاریخی انتخاب نشده است';
            } else if (state.picking) {
                label = `${isoToJalaliString(state.start)} &ndash; روز پایانی را انتخاب کنید`;
            } else if (state.start === state.end) {
                label = `تاریخ: ${isoToJalaliString(state.start)}`;
            } else {
                label = `از ${isoToJalaliString(state.start)} تا ${isoToJalaliString(state.end)}`;
            }
            return `
                <div class="jdp-footer">
                    <span class="jdp-footer-label">${label}</span>
                    <span class="jdp-footer-actions">
                        <button type="button" class="btn btn-outline-secondary btn-sm jdp-btn" data-action="today">امروز</button>
                        <button type="button" class="btn btn-outline-secondary btn-sm jdp-btn" data-action="clear">پاک کردن</button>
                    </span>
                </div>
            `;
        }

        function render() {
            const [jy2, jm2] = addMonths(state.viewJy, state.viewJm, 1);

            state.el.innerHTML = `
                <div class="jdp-months">${renderMonth(state.viewJy, state.viewJm)}${renderMonth(jy2, jm2)}</div>
                ${footerHtml()}
            `;

            state.el.querySelectorAll('.jdp-month').forEach(monthEl => {
                const jy = parseInt(monthEl.dataset.jy, 10);
                const jm = parseInt(monthEl.dataset.jm, 10);
                monthEl.querySelectorAll('.jdp-day[data-day]').forEach(btn => {
                    const day = parseInt(btn.dataset.day, 10);
                    const iso = toIso(jy, jm, day);
                    btn.dataset.iso = iso;
                    dayClass(iso, jy, jm, day).forEach(c => {
                        if (c !== 'jdp-day') btn.classList.add(c);
                    });
                });
            });
        }
        state.render = render;

        container.addEventListener('click', (e) => {
            const nav = e.target.closest('.jdp-nav[data-nav]');
            if (nav) {
                e.preventDefault();
                [state.viewJy, state.viewJm] =
                    addMonths(state.viewJy, state.viewJm, parseInt(nav.dataset.nav, 10));
                render();
                notifyViewChange();
                return;
            }
            const action = e.target.closest('[data-action]');
            if (action) {
                e.preventDefault();
                if (action.dataset.action === 'clear') {
                    state.start = state.end = null;
                    state.picking = false;
                    render();
                    notify();
                } else if (action.dataset.action === 'today') {
                    const now = new Date();
                    const [ty, tm, td] =
                        gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
                    state.viewJy = ty;
                    state.viewJm = tm;
                    state.start = state.end = toIso(ty, tm, td);
                    state.picking = true;
                    render();
                    notify();
                }
                return;
            }
            const dayBtn = e.target.closest('.jdp-day[data-day]');
            if (dayBtn) {
                e.preventDefault();
                const iso = dayBtn.dataset.iso;
                if (!state.picking) {
                    // First click: a specific date (a second click may extend it)
                    state.start = state.end = iso;
                    state.picking = true;
                } else {
                    // Second click completes the range (order-independent)
                    if (iso < state.start) state.start = iso;
                    else state.end = iso;
                    state.picking = false;
                }
                render();
                notify();
            }
        });

        container.addEventListener('change', (e) => {
            const monthSel = e.target.closest('.jdp-month-sel');
            const yearSel = e.target.closest('.jdp-year-sel');
            if (!monthSel && !yearSel) return;
            const monthEl = e.target.closest('.jdp-month');
            const isFirst = monthEl === container.querySelector('.jdp-month');
            const y = parseInt(monthEl.querySelector('.jdp-year-sel').value, 10);
            const m = parseInt(monthEl.querySelector('.jdp-month-sel').value, 10);
            if (isFirst) {
                state.viewJy = y;
                state.viewJm = m;
            } else {
                [state.viewJy, state.viewJm] = addMonths(y, m, -1);
            }
            render();
            notifyViewChange();
        });

        render();
        notifyViewChange();
    }

    /**
     * Attach to every container matching the selector
     */
    function init(selector) {
        document.querySelectorAll(selector).forEach(attach);
    }

    /** Register a callback fired on every selection change: cb({start, end}) */
    function onChange(cb) {
        if (typeof cb === 'function') changeListeners.push(cb);
    }

    /** Register a callback fired when the visible months change: cb({start, end}) */
    function onViewChange(cb) {
        if (typeof cb === 'function') viewChangeListeners.push(cb);
    }

    /** Highlight the ISO dates that have imagery (dot under the day number) */
    function setAvailableDates(isoList) {
        availableIsoDates = new Set(isoList || []);
        if (instance && instance.render) instance.render();
    }

    /** Current selection: {start, end} ISO dates (start <= end) or nulls */
    function getRange() {
        if (!instance || !instance.start) return { start: null, end: null };
        return {
            start: instance.start,
            end: (instance.picking || !instance.end) ? instance.start : instance.end,
        };
    }

    /** Set the selection programmatically from ISO dates */
    function setRange(startIso, endIso) {
        if (!instance) return;
        let a = fromIso(startIso);
        let b = fromIso(endIso);
        if (a && b) {
            const ao = toIso(a.jy, a.jm, a.jd);
            const bo = toIso(b.jy, b.jm, b.jd);
            if (bo < ao) [a, b] = [b, a];
            instance.start = toIso(a.jy, a.jm, a.jd);
            instance.end = toIso(b.jy, b.jm, b.jd);
        } else if (a) {
            instance.start = instance.end = toIso(a.jy, a.jm, a.jd);
        } else {
            instance.start = instance.end = null;
        }
        instance.picking = false;
        if (a) {
            instance.viewJy = a.jy;
            instance.viewJm = a.jm;
        }
        instance.render();
        notifyViewChange();
    }

    /** Clear the selection */
    function clear() {
        if (!instance) return;
        instance.start = instance.end = null;
        instance.picking = false;
        instance.render();
        notify();
    }

    return { attach, init, onChange, onViewChange, setAvailableDates, getRange, setRange, clear };
})();

// Auto-initialize on DOM ready
function initJalaliCalendars() {
    JalaliDatePicker.init('.jalali-range-calendar');
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initJalaliCalendars);
} else {
    initJalaliCalendars();
}
