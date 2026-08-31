/**
 * Shahrkavi - Processing Job Status Page
 * Polls the backend for a queued processing job and shows its progress,
 * download link, and preview once complete.
 */

const PROCESS_TYPE_LABELS = {
    'crop': 'باندهای اصلی (بدون شاخص)',
    'ndvi': 'شاخص گیاهی NDVI',
    'ndwi': 'شاخص آبی NDWI',
    'evi': 'شاخص گیاهی EVI',
    'truecolor': 'تصویر رنگی واقعی',
    'falsecolor': 'تصویر رنگی کاذب (NIR)',
    'custom_band': 'ترکیب سفارشی باندها',
    'overture_export': 'تبدیل ساختمانهای Overture Maps',
    'geh_download': 'دانلود تصویر تاریخی Google Earth',
};

const STATUS_TITLES = {
    'queued': 'در صف پردازش',
    'running': 'در حال پردازش',
    'success': 'پردازش موفق',
    'failed': 'پردازش ناموفق',
};

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
function toFaNum(value) {
    if (value === null || value === undefined) return '--';
    return String(value).replace(/\d/g, d => FA_DIGITS[+d]);
}

/** Resolve API-relative URLs ("/landsat/...") against the API base */
function apiUrl(url) {
    return typeof url === 'string' && url.startsWith('/')
        ? (window.API_BASE || '') + url
        : url;
}

function toFaDate(iso) {
    if (!iso) return '--';
    try {
        const d = new Date(iso);
        return new Intl.DateTimeFormat('fa-IR', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        }).format(d);
    } catch (e) {
        return iso;
    }
}

const ProcessingPage = (() => {
    let jobId = null;
    let pollTimer = null;
    let source = 'landsat';

    function getJobIdFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('job');
    }

    function getSourceFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const value = params.get('source');
        return value === 'overture' || value === 'ghs' || value === 'geh' ? value : 'landsat';
    }

    function jobApiBase() {
        if (source === 'overture') return `${API_BASE}/overture`;
        if (source === 'ghs') return `${API_BASE}/ghs`;
        if (source === 'geh') return `${API_BASE}/geh`;
        return `${API_BASE}/landsat`;
    }

    function showLoading() {
        document.getElementById('jobLoading').classList.remove('d-none');
        document.getElementById('jobBody').classList.add('d-none');
        document.getElementById('jobNotFound').classList.add('d-none');
    }

    function showNotFound() {
        clearInterval(pollTimer);
        document.getElementById('jobLoading').classList.add('d-none');
        document.getElementById('jobBody').classList.add('d-none');
        document.getElementById('jobNotFound').classList.remove('d-none');
    }

    function showJob(job) {
        document.getElementById('jobLoading').classList.add('d-none');
        document.getElementById('jobNotFound').classList.add('d-none');
        document.getElementById('jobBody').classList.remove('d-none');

        const status = job.status || 'queued';
        const isOverture = job.dataset === 'OVT' || source === 'overture';
        const isGhs = source === 'ghs' || String(job.dataset || '').startsWith('GHS_');
        const isGeh = source === 'geh' || job.dataset === 'GEH';

        // Metadata
        document.getElementById('jobIdLabel').textContent = job.job_id || '--';
        document.getElementById('jobDatasetLabel').textContent = job.dataset || '--';

        if (isOverture) {
            const fmtEl = document.getElementById('jobProcessLabel');
            const fmtTitle = { shp: 'Shapefile (ZIP)', geojson: 'GeoJSON', gpkg: 'GeoPackage (GPKG)' }[job.format] || job.format || '--';
            document.getElementById('jobProcessLabel').textContent = `تبدیل به ${fmtTitle}`;
            document.getElementById('jobSceneCountTitle').textContent = 'تعداد ساختمان';
            document.getElementById('jobSceneCountLabel').textContent =
                Number.isFinite(job.total_buildings) ? toFaNum(job.total_buildings) + ' ساختمان' : '--';
        } else if (isGeh) {
            document.getElementById('jobProcessLabel').textContent = 'دانلود تصویر تاریخی Google Earth';
            document.getElementById('jobSceneCountTitle').textContent = 'تعداد تایل';
            document.getElementById('jobSceneCountLabel').textContent =
                Number.isFinite(job.total_tiles) ? toFaNum(job.total_tiles) + ' تایل' : '--';
        } else {
            document.getElementById('jobProcessLabel').textContent = isGhs
                ? 'دانلود گروهی رسترها'
                : PROCESS_TYPE_LABELS[job.process_type] || job.process_type || '--';
            document.getElementById('jobSceneCountTitle').textContent = 'تعداد صحنه';
            document.getElementById('jobSceneCountLabel').textContent =
                toFaNum((job.scene_ids || []).length);
        }
        document.getElementById('jobCreatedLabel').textContent = toFaDate(job.created_at);

        // Status icon + title
        const statusArea = document.getElementById('jobStatusArea');
        const statusIcon = document.getElementById('statusIcon');
        const progressBar = document.getElementById('jobProgressBar');

        if (status === 'success') {
            document.getElementById('jobSuccess').classList.remove('d-none');
            document.getElementById('jobFailed').classList.add('d-none');
            statusArea.classList.add('d-none');
            clearInterval(pollTimer);

            // Download link
            const btnDownload = document.getElementById('btnJobDownload');
            if (job.download_url) {
                btnDownload.href = apiUrl(job.download_url);
                btnDownload.classList.remove('disabled');
                btnDownload.setAttribute('aria-disabled', 'false');
                 btnDownload.innerHTML = (isOverture || isGhs || isGeh) ? '<i class="bi bi-download"></i> دانلود فایل' : '<i class="bi bi-download"></i> دانلود تصویر پردازش‌شده';
            } else {
                btnDownload.classList.add('disabled');
                btnDownload.setAttribute('aria-disabled', 'true');
            }

            // Preview
            const previewContainer = document.getElementById('jobPreviewContainer');
            const previewImg = document.getElementById('jobPreviewImg');
            if (job.preview_url) {
                previewImg.src = apiUrl(job.preview_url);
                previewContainer.classList.remove('d-none');
            } else {
                previewContainer.classList.add('d-none');
            }
        } else if (status === 'failed') {
            document.getElementById('jobSuccess').classList.add('d-none');
            document.getElementById('jobFailed').classList.remove('d-none');
            statusArea.classList.add('d-none');
            clearInterval(pollTimer);
            document.getElementById('jobErrorText').textContent = job.error || 'خطای ناشناخته';
        } else {
            // queued / running
            document.getElementById('jobSuccess').classList.add('d-none');
            document.getElementById('jobFailed').classList.add('d-none');
            statusArea.classList.remove('d-none');

            statusIcon.className = status === 'queued'
                ? 'bi bi-hourglass-split text-warning job-status-icon'
                : 'bi bi-gear-wide-connected text-primary job-status-icon spinner-border-sm';
            document.getElementById('jobStatusTitle').textContent = STATUS_TITLES[status] || status;
            document.getElementById('jobStatusMessage').textContent = job.message || '';

            const progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
            progressBar.style.width = `${progress}%`;
            document.getElementById('jobProgressText').textContent = toFaNum(progress) + '٪';
        }
    }

    async function pollJob() {
        if (!jobId) return;
        try {
            const res = await fetch(`${jobApiBase()}/jobs/${encodeURIComponent(jobId)}`);
            if (res.status === 404) {
                showNotFound();
                return;
            }
            if (!res.ok) return;
            const job = await res.json();
            showJob(job);
        } catch (e) {
            console.error('Job poll error:', e);
        }
    }

    async function loadRecentJobs(activeJobId) {
        const container = document.getElementById('recentJobsList');
        try {
            const res = await fetch(`${jobApiBase()}/jobs`);
            if (!res.ok) throw new Error('bad status');
            const data = await res.json();
            const jobs = (data.jobs || []).slice(0, 10);
            if (jobs.length === 0) {
                container.innerHTML = '<div class="text-muted small">هنوز کار پردازشی ثبت نشده است.</div>';
                return;
            }
            container.innerHTML = jobs.map(j => {
                const active = j.job_id === activeJobId;
                const statusBadge = {
                    'queued': '<span class="badge text-bg-secondary">در صف</span>',
                    'running': '<span class="badge text-bg-primary">در حال پردازش</span>',
                    'success': '<span class="badge text-bg-success">موفق</span>',
                    'failed': '<span class="badge text-bg-danger">ناموفق</span>',
                }[j.status] || `<span class="badge text-bg-secondary">${j.status}</span>`;
                const isGeh = j.dataset === 'GEH';
                const isOverture = j.dataset === 'OVT';
                const label = isOverture
                    ? `تبدیل به ${({ shp: 'Shapefile', geojson: 'GeoJSON', gpkg: 'GeoPackage' }[j.format] || j.format || '')}`
                    : (PROCESS_TYPE_LABELS[j.process_type] || j.process_type || 'پردازش');
                const detail = isGeh
                    ? `${toFaNum((j.scene_ids || []).length)} تصویر`
                    : isOverture
                    ? `${toFaNum(j.total_buildings)} ساختمان`
                    : `${toFaNum((j.scene_ids || []).length)} صحنه`;
                const link = j.status === 'success' && j.download_url
                    ? `<a class="small" href="${apiUrl(j.download_url)}"><i class="bi bi-download"></i> دانلود</a>`
                    : (j.status === 'queued' || j.status === 'running')
                        ? `<a class="small" href="processing.html?job=${encodeURIComponent(j.job_id)}&source=${j.dataset === 'GEH' ? 'geh' : j.dataset?.startsWith('GHS_') ? 'ghs' : isOverture ? 'overture' : 'landsat'}"><i class="bi bi-arrow-left"></i> پیگیری</a>`
                        : '';
                return `
                    <div class="d-flex align-items-center justify-content-between py-2 border-bottom ${active ? 'bg-light rounded px-2' : ''}">
                        <div>
                            <div class="small fw-semibold">
                                ${label}
                                <span class="text-muted">— ${j.dataset || ''}</span>
                                ${active ? '<span class="badge text-bg-info">جاری</span>' : ''}
                            </div>
                            <div class="text-muted" style="font-size:0.75rem">
                                ${toFaDate(j.created_at)} | ${detail} | شناسه: ${j.job_id}
                            </div>
                        </div>
                        <div class="text-end">
                            ${statusBadge}
                            <div class="mt-1">${link}</div>
                        </div>
                    </div>`;
            }).join('');
        } catch (e) {
            container.innerHTML = '<div class="text-muted small">خطا در دریافت لیست کارها.</div>';
        }
    }

    function init() {
        source = getSourceFromUrl();
        jobId = getJobIdFromUrl();
        loadRecentJobs(jobId);

        if (!jobId) {
            showNotFound();
            return;
        }

        showLoading();
        pollJob();
        pollTimer = setInterval(pollJob, 2000);
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
    ProcessingPage.init();
});
