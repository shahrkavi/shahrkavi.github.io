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

    function getJobIdFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('job');
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

        // Metadata
        document.getElementById('jobIdLabel').textContent = job.job_id || '--';
        document.getElementById('jobDatasetLabel').textContent = job.dataset || '--';
        document.getElementById('jobProcessLabel').textContent =
            PROCESS_TYPE_LABELS[job.process_type] || job.process_type || '--';
        document.getElementById('jobSceneCountLabel').textContent =
            toFaNum((job.scene_ids || []).length);
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
                btnDownload.href = job.download_url;
                btnDownload.classList.remove('disabled');
                btnDownload.setAttribute('aria-disabled', 'false');
            } else {
                btnDownload.classList.add('disabled');
                btnDownload.setAttribute('aria-disabled', 'true');
            }

            // Preview
            const previewContainer = document.getElementById('jobPreviewContainer');
            const previewImg = document.getElementById('jobPreviewImg');
            if (job.preview_url) {
                previewImg.src = job.preview_url;
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
            const res = await fetch(API_BASE + `landsat/jobs/${encodeURIComponent(jobId)}`);
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
            const res = await fetch(API_BASE + 'landsat/jobs');
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
                const link = j.status === 'success' && j.download_url
                    ? `<a class="small" href="${j.download_url}"><i class="bi bi-download"></i> دانلود</a>`
                    : (j.status === 'queued' || j.status === 'running')
                        ? `<a class="small" href="processing.html?job=${encodeURIComponent(j.job_id)}"><i class="bi bi-arrow-left"></i> پیگیری</a>`
                        : '';
                return `
                    <div class="d-flex align-items-center justify-content-between py-2 border-bottom ${active ? 'bg-light rounded px-2' : ''}">
                        <div>
                            <div class="small fw-semibold">
                                ${PROCESS_TYPE_LABELS[j.process_type] || j.process_type || 'پردازش'}
                                <span class="text-muted">— ${j.dataset || ''}</span>
                                ${active ? '<span class="badge text-bg-info">جاری</span>' : ''}
                            </div>
                            <div class="text-muted" style="font-size:0.75rem">
                                ${toFaDate(j.created_at)} | ${toFaNum((j.scene_ids || []).length)} صحنه | شناسه: ${j.job_id}
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