/**
 * Shahrkavi - Dataset Tab Module
 * Minimal single-select dataset browser with recent-history support.
 */

const DatasetsModule = (() => {
    // Flat list of available datasets
    const DATASETS = [
        { id: 'L9', name: 'Landsat 9 OLI-2/TIRS-2', info: '2021-اکنون | 30 متر', category: 'Landsat' },
        { id: 'L8', name: 'Landsat 8 OLI/TIRS', info: '2013-اکنون | 30 متر', category: 'Landsat' },
        { id: 'L7', name: 'Landsat 7 ETM+', info: '1999-اکنون | 30 متر', category: 'Landsat' },
        { id: 'L5', name: 'Landsat 5 TM', info: '1984-2013 | 30 متر', category: 'Landsat' },
        { id: 'L4', name: 'Landsat 4 TM', info: '1982-1993 | 30 متر', category: 'Landsat' },
        { id: 'S2', name: 'Sentinel-2 MSI L2A', info: '2015-اکنون | 10 متر', category: 'Sentinel' },
        { id: 'S1', name: 'Sentinel-1 SAR GRD', info: '2014-اکنون | 10 متر', category: 'Sentinel' },
        { id: 'MOD', name: 'MODIS Terra Surface Reflectance', info: '2000-اکنون | 500 متر | 8 روزه', category: 'MODIS' },
        { id: 'MYD', name: 'MODIS Aqua Surface Reflectance', info: '2002-اکنون | 500 متر | 8 روزه', category: 'MODIS' },
        { id: 'DEM', name: 'Copernicus DEM GLO-30', info: 'دادههای ارتفاعی | 30 متر | کل جهان', category: 'DEMs' },
        { id: 'GHS_POP', name: 'Global Human Settlement (GHS)', info: 'POP | جمعیت | ۱۰۰ متر | ۱۹۷۵ تا ۲۰۳۰', category: 'GHS' },
        { id: 'GHS_BUILT', name: 'Global Human Settlement (GHS)', info: 'BUILT | سطح ساخته‌شده | ۱۰۰ متر | ۱۹۷۵ تا ۲۰۳۰', category: 'GHS' },
        { id: 'GHS_BUILT_V', name: 'Global Human Settlement (GHS)', info: 'BUILT_V | حجم ساخته‌شده | ۱۰۰ متر | ۱۹۷۵ تا ۲۰۳۰', category: 'GHS' },
        { id: 'OSM', name: 'OpenStreetMap', info: 'دادههای برداری | منطقه انتخابی', category: 'OSM' },
        { id: 'OVT', name: 'ساختمانهای Overture Maps', info: 'فوتپرینت ساختمانها | ارتفاع | کل جهان | جستجوی اول چند دقیقه', category: 'OSM' },
        { id: 'WTH', name: 'ایستگاههای هواشناسی', info: 'داده‌های روزانه | ایستگاه‌های منطقه انتخابی', category: 'هواشناسی' },
        { id: 'USGS_EQ', name: 'زمین‌لرزه‌های USGS', info: 'سری زمانی تاریخی | کاتالوگ زلزله آمریکا', category: 'سری زمانی' },
    ];

    // Families that expose cloud-cover metadata (per-planetary-computer)
    const CLOUD_CAPABLE = new Set(['L4', 'L5', 'L7', 'L8', 'L9', 'S2']);

    // Datasets that skip the query step and use a specialized flow
    const SKIPS_QUERY = new Set(['DEM', 'OVT']);
    const RECENT_DATASETS_KEY = 'shahrkavi.recentDatasets.v1';
    const MAX_RECENT_DATASETS = 5;

    const CATEGORY_META = {
        Landsat: { label: 'لندست', icon: 'bi-globe-americas' },
        Sentinel: { label: 'سنتینل', icon: 'bi-satellite' },
        MODIS: { label: 'مودیس', icon: 'bi-circle-half' },
        DEMs: { label: 'مدل‌های ارتفاعی', icon: 'bi-layers' },
        GHS: { label: 'Global Human Settlement', icon: 'bi-buildings' },
        OSM: { label: 'داده‌های برداری', icon: 'bi-signpost-2' },
        هواشناسی: { label: 'هواشناسی', icon: 'bi-cloud-sun' },
    };

    // Bands available per satellite
    const BANDS_BY_SATELLITE = {
        'L9': ['blue', 'green', 'red', 'nir08', 'swir16', 'swir22', 'coastal', 'lwir11'],
        'L8': ['blue', 'green', 'red', 'nir08', 'swir16', 'swir22', 'coastal', 'lwir11'],
        'L7': ['blue', 'green', 'red', 'nir08', 'swir16', 'swir22', 'lwir'],
        'L5': ['blue', 'green', 'red', 'nir08', 'swir16', 'swir22'],
        'L4': ['blue', 'green', 'red', 'nir08', 'swir16', 'swir22'],
        'S2': ['coastal', 'blue', 'green', 'red', 'rededge1', 'rededge2', 'rededge3', 'nir', 'nir08', 'nir09', 'swir16', 'swir22', 'scl'],
        'S1': ['vv', 'vh'],
        'MOD': ['red', 'green', 'blue', 'nir', 'swir16', 'swir22'],
        'MYD': ['red', 'green', 'blue', 'nir', 'swir16', 'swir22'],
        'DEM': ['dem'],
        'GHS_POP': ['pop'],
        'GHS_BUILT': ['built'],
        'GHS_BUILT_V': ['built_v'],
        'OSM': [],
        'OVT': [],
        'WTH': [],
        'USGS_EQ': [],
    };

    const BAND_LABELS = {
        'blue': 'آبی (Blue)',
        'green': 'سبز (Green)',
        'red': 'قرمز (Red)',
        'nir': 'مادون قرمز نزدیک (NIR)',
        'nir08': 'مادون قرمز نزدیک (NIR)',
        'nir09': 'مادون قرمز نزدیک باریک (NIR narrow)',
        'swir16': 'مادون قرمز کوتاه 1 (SWIR-1)',
        'swir22': 'مادون قرمز کوتاه 2 (SWIR-2)',
        'coastal': 'ساحلی (Coastal)',
        'rededge1': 'رد-لبه 1 (Red-edge 1)',
        'rededge2': 'رد-لبه 2 (Red-edge 2)',
        'rededge3': 'رد-لبه 3 (Red-edge 3)',
        'scl': 'طبقهبندی صحنه (SCL)',
        'lwir11': 'حرارتی (Thermal)',
        'lwir': 'حرارتی (Thermal)',
        'vv': 'VV (پلارایزاسیون عمودی)',
        'vh': 'VH (پلارایزاسیون متقاطع)',
        'dem': 'ارتفاع (Elevation)',
        'pop': 'جمعیت (POP)',
        'built': 'سطح ساخته‌شده (BUILT)',
        'built_v': 'حجم ساخته‌شده (BUILT_V)',
    };

    let openCategoryId = null;
    let openSubcategoryId = null;
    let searchQuery = '';
    let renderingTree = false;

    function readRecentDatasetIds() {
        try {
            const stored = JSON.parse(localStorage.getItem(RECENT_DATASETS_KEY) || '[]');
            if (!Array.isArray(stored)) return [];
            const validIds = new Set(DATASETS.map(ds => ds.id));
            return stored.filter((id, index) => validIds.has(id) && stored.indexOf(id) === index)
                .slice(0, MAX_RECENT_DATASETS);
        } catch (e) {
            return [];
        }
    }

    function rememberDataset(datasetId) {
        if (!DATASETS.some(ds => ds.id === datasetId)) return;
        const recent = [datasetId, ...readRecentDatasetIds().filter(id => id !== datasetId)]
            .slice(0, MAX_RECENT_DATASETS);
        try {
            localStorage.setItem(RECENT_DATASETS_KEY, JSON.stringify(recent));
        } catch (e) { /* local storage may be unavailable */ }
    }

    function datasetChildren(categoryName) {
        return DATASETS.filter(ds => ds.category === categoryName)
            .map(ds => ({ id: ds.id, name: ds.name, info: ds.info }));
    }

    function buildDatasetGroups() {
        const recentIds = readRecentDatasetIds();
        const groups = [{
            id: 'main-recent',
            name: 'انتخاب‌های اخیر',
            categoryName: 'recent',
            categoryIcon: 'bi-clock-history',
            recentCategory: true,
            children: recentIds.map(id => {
                const ds = DATASETS.find(item => item.id === id);
                return { id: ds.id, name: ds.name, info: ds.info };
            }),
            subcategories: false,
        }];

        groups.push(
            {
                id: 'main-raster',
                name: 'داده‌های رستری',
                categoryIcon: 'bi-grid-1x2',
                children: [
                    { id: 'sub-landsat', name: 'لندست', categoryIcon: 'bi-globe-americas', children: datasetChildren('Landsat') },
                    { id: 'sub-sentinel', name: 'سنتینل', categoryIcon: 'bi-satellite', children: datasetChildren('Sentinel') },
                    { id: 'sub-modis', name: 'مودیس', categoryIcon: 'bi-circle-half', children: datasetChildren('MODIS') },
                    { id: 'sub-dem', name: 'مدل‌های ارتفاعی', categoryIcon: 'bi-layers', children: datasetChildren('DEMs') },
                    {
                        id: 'sub-ghs',
                        name: 'Global Human Settlement',
                        categoryIcon: 'bi-buildings',
                        children: [
                            { id: 'GHS_POP', name: 'POP', info: 'جمعیت | ۱۰۰ متر | ۱۹۷۵ تا ۲۰۳۰' },
                            { id: 'GHS_BUILT', name: 'BUILT', info: 'سطح ساخته‌شده | ۱۰۰ متر | ۱۹۷۵ تا ۲۰۳۰' },
                            { id: 'GHS_BUILT_V', name: 'BUILT_V', info: 'حجم ساخته‌شده | ۱۰۰ متر | ۱۹۷۵ تا ۲۰۳۰' },
                        ],
                    },
                ],
                subcategories: true,
            },
            {
                id: 'main-vector',
                name: 'داده‌های برداری',
                categoryIcon: 'bi-bezier2',
                children: [
                    { id: 'sub-osm', name: 'OpenStreetMap', categoryIcon: 'bi-signpost-2', children: datasetChildren('OSM') },
                ],
                subcategories: true,
            },
            {
                id: 'main-timeseries',
                name: 'داده‌های سری زمانی',
                categoryIcon: 'bi-graph-up-arrow',
                children: [
                    { id: 'sub-weather', name: 'ایستگاه‌های هواشناسی', categoryIcon: 'bi-cloud-sun', children: datasetChildren('هواشناسی') },
                    { id: 'sub-earthquakes', name: 'زمین‌لرزه‌ها', categoryIcon: 'bi-activity', children: datasetChildren('سری زمانی') },
                ],
                subcategories: true,
            }
        );

        // Overture is a vector dataset but uses its own category label.
        const vector = groups.find(group => group.id === 'main-vector');
        vector.children.push({ id: 'sub-buildings', name: 'ساختمان‌ها', categoryIcon: 'bi-buildings', children: datasetChildren('OSM').filter(ds => ds.id === 'OVT') });
        vector.children[0].children = vector.children[0].children.filter(ds => ds.id !== 'OVT');
        return groups;
    }

    function renderDatasetTree(restoreSearchFocus = false) {
        const container = document.getElementById('datasetList');
        if (!container) return;

        const groups = buildDatasetGroups();
        if (!openCategoryId || !groups.some(group => group.id === openCategoryId)) {
            openCategoryId = groups.find(group => group.id === 'main-recent')?.id || null;
        }

        const query = searchQuery.trim().toLocaleLowerCase();
        const matchesDataset = dataset => `${dataset.name} ${dataset.info}`.toLocaleLowerCase().includes(query);
        const groupNameMatches = group => Boolean(query && group.name.toLocaleLowerCase().includes(query));
        const groupMatches = group => !query || groupNameMatches(group)
            || group.children.some(child => child.name.toLocaleLowerCase().includes(query)
                || (child.children || []).some(matchesDataset));
        const matchingGroups = groups.filter(groupMatches);
        if (query && !matchingGroups.some(group => group.id === openCategoryId)) {
            openCategoryId = matchingGroups[0]?.id || null;
        }

        renderingTree = true;
        container.innerHTML = '';

        const searchWrapper = document.createElement('div');
        searchWrapper.className = 'dataset-list-search';
        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.className = 'treeview-search-input form-control';
        searchInput.placeholder = 'جستجوی نام دیتاست...';
        searchInput.value = searchQuery;
        searchInput.setAttribute('aria-label', 'جستجوی دیتاست');
        const clearSearch = document.createElement('button');
        clearSearch.type = 'button';
        clearSearch.className = 'treeview-search-clear';
        clearSearch.innerHTML = '<i class="bi bi-x"></i>';
        clearSearch.title = 'پاک کردن جستجو';
        clearSearch.hidden = !searchQuery;
        searchWrapper.append(searchInput, clearSearch);
        container.appendChild(searchWrapper);

        const list = document.createElement('div');
        list.className = 'dataset-category-list';
        container.appendChild(list);

        if (matchingGroups.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'dataset-list-empty';
            empty.innerHTML = '<i class="bi bi-search"></i><span>دیتاستی با این نام پیدا نشد.</span>';
            list.appendChild(empty);
        }

        matchingGroups.forEach(group => {
            const categoryElement = document.createElement('section');
            categoryElement.className = 'dataset-category-row';
            categoryElement.dataset.categoryId = group.id;
            const isOpen = query ? true : group.id === openCategoryId;
            if (isOpen) categoryElement.classList.add('is-open');

            const categoryButton = document.createElement('button');
            categoryButton.type = 'button';
            categoryButton.className = 'dataset-category-toggle';
            categoryButton.setAttribute('aria-expanded', String(isOpen));
            categoryButton.innerHTML = `
                <i class="bi ${group.categoryIcon}"></i>
                <span>${group.name}</span>
                <small>${toPersianNum(group.children.reduce((count, child) => count + (child.children ? child.children.length : 1), 0))}</small>
                <i class="bi bi-chevron-down dataset-category-chevron"></i>
            `;
            categoryButton.addEventListener('click', () => {
                openCategoryId = openCategoryId === group.id ? null : group.id;
                openSubcategoryId = null;
                renderDatasetTree(true);
            });
            categoryElement.appendChild(categoryButton);

            const datasetList = document.createElement('div');
            datasetList.className = 'dataset-category-children';
            datasetList.hidden = !isOpen;
            if (group.subcategories) {
                group.children.filter(subcategory => !query || groupNameMatches(group)
                    || subcategory.name.toLocaleLowerCase().includes(query)
                    || subcategory.children.some(matchesDataset)).forEach(subcategory => {
                    const subElement = document.createElement('div');
                    subElement.className = 'dataset-subcategory-row';
                    const subNameMatches = Boolean(query && subcategory.name.toLocaleLowerCase().includes(query));
                    const subOpen = query
                        ? groupNameMatches(group) || subNameMatches || subcategory.children.some(matchesDataset)
                        : isOpen && subcategory.id === openSubcategoryId;
                    if (subOpen) subElement.classList.add('is-open');
                    const subButton = document.createElement('button');
                    subButton.type = 'button';
                    subButton.className = 'dataset-subcategory-toggle';
                    subButton.setAttribute('aria-expanded', String(subOpen));
                    subButton.innerHTML = `<i class="bi ${subcategory.categoryIcon}"></i><span>${subcategory.name}</span><small>${toPersianNum(subcategory.children.length)}</small><i class="bi bi-chevron-down"></i>`;
                    subButton.addEventListener('click', () => {
                        openCategoryId = group.id;
                        openSubcategoryId = openSubcategoryId === subcategory.id ? null : subcategory.id;
                        renderDatasetTree(true);
                    });
                    subElement.appendChild(subButton);
                    const subDatasetList = document.createElement('div');
                    subDatasetList.className = 'dataset-subcategory-children';
                    subDatasetList.hidden = !subOpen;
                    subcategory.children.filter(dataset => !query || groupNameMatches(group) || subNameMatches || matchesDataset(dataset))
                        .forEach(dataset => appendDatasetOption(subDatasetList, dataset));
                    subElement.appendChild(subDatasetList);
                    datasetList.appendChild(subElement);
                });
            } else {
                const visibleDatasets = group.children.filter(dataset => !query || matchesDataset(dataset));
                if (visibleDatasets.length === 0) {
                    const empty = document.createElement('div');
                    empty.className = 'dataset-subcategory-empty';
                    empty.textContent = group.id === 'main-recent'
                        ? 'هنوز دیتاستی انتخاب نشده است.'
                        : 'موردی برای نمایش وجود ندارد.';
                    datasetList.appendChild(empty);
                }
                visibleDatasets.forEach(dataset => {
                    appendDatasetOption(datasetList, dataset);
                });
            }
            categoryElement.appendChild(datasetList);
            list.appendChild(categoryElement);
        });

        function appendDatasetOption(parent, dataset) {
            const datasetButton = document.createElement('button');
            datasetButton.type = 'button';
            datasetButton.className = 'dataset-option';
            datasetButton.dataset.datasetId = dataset.id;
            datasetButton.setAttribute('aria-pressed', String(AppState.searchCriteria.dataset === dataset.id));
            if (AppState.searchCriteria.dataset === dataset.id) datasetButton.classList.add('is-selected');
            datasetButton.innerHTML = `
                <span class="dataset-option-radio"><i class="bi bi-check"></i></span>
                <span class="dataset-option-copy">
                    <strong>${dataset.name}</strong>
                    <small>${dataset.info}</small>
                </span>
            `;
            datasetButton.addEventListener('click', () => selectDataset(dataset.id));
            parent.appendChild(datasetButton);
        }

        searchInput.addEventListener('input', event => {
            searchQuery = event.target.value;
            renderDatasetTree(true);
        });
        clearSearch.addEventListener('click', () => {
            searchQuery = '';
            renderDatasetTree(true);
        });

        renderingTree = false;
        if (restoreSearchFocus) {
            searchInput.focus();
            searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
        }
    }

    function init() {
        const listContainer = document.getElementById('datasetList');
        if (!listContainer) return;

        renderDatasetTree();

        // Set initial selection
        const initialId = AppState.searchCriteria.dataset || null;
        if (initialId) {
            selectDataset(initialId);
        }

        console.log('Datasets module initialized');
    }

    function selectDataset(datasetId) {
        AppState.searchCriteria.dataset = datasetId;
        rememberDataset(datasetId);

        // Update tree selection (only if not already selected to avoid loop)
        if (!renderingTree) renderDatasetTree();

        // Update query parameter visibility
        updateQueryParamsForDataset(datasetId);

        const selected = DATASETS.find(d => d.id === datasetId);

        // Update the selected dataset card so the next action is obvious.
        const card = document.getElementById('datasetSelectionCard');
        if (card) {
            const empty = card.querySelector('.dataset-selection-empty');
            const filled = card.querySelector('.dataset-selection-filled');
            if (empty) empty.classList.add('d-none');
            if (filled) filled.classList.remove('d-none');
            const name = document.getElementById('datasetSelectionName');
            const info = document.getElementById('datasetSelectionInfo');
            if (name) name.textContent = selected ? selected.name : datasetId;
            if (info) info.textContent = selected ? selected.info : '';
            const icon = document.getElementById('datasetSelectionIcon');
            if (icon) icon.innerHTML = `<i class="bi ${datasetId === 'OVT' ? 'bi-buildings' : datasetId === 'DEM' ? 'bi-layers' : 'bi-database'}"></i>`;
        }

        // Update the next button label for datasets that skip the query step
        const nextBtn = document.querySelector('.btn-next[data-next-step="3"]');
        if (nextBtn) {
            nextBtn.disabled = false;
            if (datasetId === 'OVT') {
                nextBtn.innerHTML = 'ادامه به پردازش <i class="bi bi-arrow-left"></i>';
            } else if (datasetId === 'DEM') {
                nextBtn.innerHTML = 'ادامه به نتایج <i class="bi bi-arrow-left"></i>';
            } else if (SKIPS_QUERY.has(datasetId)) {
                nextBtn.innerHTML = 'ادامه <i class="bi bi-chevron-left"></i>';
            } else {
                nextBtn.innerHTML = 'ادامه به پارامترها <i class="bi bi-arrow-left"></i>';
            }
        }

        // Update summary
        setSummaryDataset(datasetId, selected ? selected.name : datasetId);

        EventBus.emit('dataset:changed', datasetId);
    }

    function clearDatasetSelection() {
        AppState.searchCriteria.dataset = null;
        updateQueryParamsForDataset(null);

        const card = document.getElementById('datasetSelectionCard');
        if (card) {
            card.querySelector('.dataset-selection-empty')?.classList.remove('d-none');
            card.querySelector('.dataset-selection-filled')?.classList.add('d-none');
        }

        const nextBtn = document.querySelector('.btn-next[data-next-step="3"]');
        if (nextBtn) {
            nextBtn.disabled = true;
            nextBtn.innerHTML = 'انتخاب منبع <i class="bi bi-arrow-left"></i>';
        }
        setSummaryDataset(null);
        EventBus.emit('dataset:changed', null);
    }

    /**
     * Show/hide query parameters that are relevant for this dataset.
     */
    function updateQueryParamsForDataset(datasetId) {
        const cloudSection = document.getElementById('cloudCoverSection');
        const cloudNote = document.getElementById('cloudCoverNote');
        const dateSection = document.getElementById('dateRangeSection');
        const osmSection = document.getElementById('osmTagSection');
        const earthquakeSection = document.getElementById('earthquakeSection');
        const ghsSection = document.getElementById('ghsYearSection');
        if (!cloudSection) return;

        if (!datasetId) {
            cloudSection.style.display = 'none';
            if (cloudNote) cloudNote.style.display = 'none';
            if (dateSection) dateSection.style.display = 'none';
            if (osmSection) osmSection.style.display = 'none';
            if (earthquakeSection) earthquakeSection.style.display = 'none';
            if (ghsSection) ghsSection.style.display = 'none';
            return;
        }

        const isOsm = datasetId === 'OSM';
        const isWeather = datasetId === 'WTH';
        const isDem = datasetId === 'DEM';
        const isOvt = datasetId === 'OVT';
        const isEarthquake = datasetId === 'USGS_EQ';
        const isGhs = datasetId?.startsWith('GHS_');
        if (isEarthquake && typeof JalaliDatePicker !== 'undefined') {
            JalaliDatePicker.clear();
            JalaliDatePicker.showRecentMonths();
        }
        const supportsCloud = CLOUD_CAPABLE.has(datasetId);

        cloudSection.style.display = (isOsm || isWeather || isDem || isGhs || isOvt || isEarthquake) ? 'none' : (supportsCloud ? 'block' : 'none');
        if (cloudNote) {
            cloudNote.style.display = (isOsm || isWeather || isDem || isGhs || isOvt || isEarthquake) ? 'none' : (supportsCloud ? 'none' : 'block');
        }
        if (dateSection) {
            dateSection.style.display = (isOsm || isDem || isGhs || isOvt) ? 'none' : 'block';
        }
        if (osmSection) {
            osmSection.style.display = isOsm ? 'block' : 'none';
        }
        if (earthquakeSection) earthquakeSection.style.display = isEarthquake ? 'block' : 'none';
        if (ghsSection) ghsSection.style.display = isGhs ? 'block' : 'none';
        if (isGhs && typeof SearchModule !== 'undefined' && SearchModule.loadGhsYears) SearchModule.loadGhsYears();
    }

    function supportsCloud(datasetId) {
        return CLOUD_CAPABLE.has(datasetId);
    }

    function skipsQuery(datasetId) {
        return SKIPS_QUERY.has(datasetId);
    }

    function getSelectedDataset() {
        return AppState.searchCriteria.dataset;
    }

    function getSelectedBands() {
        return AppState.searchCriteria.bands || [];
    }

    return {
        init,
        getSelectedDataset,
        getSelectedBands,
        selectDataset,
        supportsCloud,
        skipsQuery,
        DATASETS,
        BANDS_BY_SATELLITE,
        BAND_LABELS,
    };
})();

// Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', DatasetsModule.init);
} else {
    DatasetsModule.init();
}
