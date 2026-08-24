/**
 * Shahrkavi - Dataset Tab Module
 * Single-select treeview for dataset selection using Quercus.js
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
        { id: 'OSM', name: 'OpenStreetMap', info: 'دادههای برداری | منطقه انتخابی', category: 'OSM' },
        { id: 'WTH', name: 'ایستگاههای هواشناسی', info: 'داده‌های روزانه | ایستگاه‌های منطقه انتخابی', category: 'هواشناسی' },
    ];

    // Families that expose cloud-cover metadata (per-planetary-computer)
    const CLOUD_CAPABLE = new Set(['L4', 'L5', 'L7', 'L8', 'L9', 'S2']);

    // Datasets that skip the query step and go directly to results
    const SKIPS_QUERY = new Set(['DEM']);

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
        'OSM': [],
        'WTH': [],
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
    };

    let treeview = null;

    function buildTreeData() {
        const categories = {};
        DATASETS.forEach(ds => {
            if (!categories[ds.category]) categories[ds.category] = [];
            categories[ds.category].push(ds);
        });

        return Object.keys(categories).map(catName => ({
            id: 'cat-' + catName,
            name: catName,
            selectable: false,
            children: categories[catName].map(ds => ({
                id: ds.id,
                name: ds.name,
                info: ds.info,
            })),
        }));
    }

    function init() {
        const listContainer = document.getElementById('datasetList');
        if (!listContainer) return;

        const treeData = buildTreeData();

        treeview = new Treeview({
            containerId: 'datasetList',
            data: treeData,
            searchEnabled: true,
            searchPlaceholder: 'جستجو...',
            initiallyExpanded: false,
            multiSelectEnabled: false,
            checkboxSelectionEnabled: true,
            accordionMode: true,
            onSelectionChange: (selectedNodes) => {
                if (selectedNodes.length > 0) {
                    const node = selectedNodes[0];
                    if (node.id && !node.id.startsWith('cat-')) {
                        selectDataset(node.id);
                    }
                }
            },
            onRenderNode: (nodeData, nodeContentWrapperElement) => {
                nodeContentWrapperElement.innerHTML = '';

                const nameSpan = document.createElement('span');
                nameSpan.className = 'treeview-node-text fw-medium';
                nameSpan.textContent = nodeData.name;
                nodeContentWrapperElement.appendChild(nameSpan);

                if (nodeData.info) {
                    const infoSpan = document.createElement('span');
                    infoSpan.className = 'dataset-tree-info d-block small text-muted';
                    infoSpan.textContent = nodeData.info;
                    nodeContentWrapperElement.appendChild(infoSpan);
                }
            },
        });

        // Set initial selection
        const initialId = AppState.searchCriteria.dataset || null;
        if (initialId) {
            selectDataset(initialId);
        }

        console.log('Datasets module initialized');
    }

    function selectDataset(datasetId) {
        AppState.searchCriteria.dataset = datasetId;

        // Update tree selection (only if not already selected to avoid loop)
        if (treeview) {
            const isSelected = treeview.getSelectedNodes().some(n => n.id === datasetId);
            if (!isSelected) {
                treeview.selectNodeById(datasetId, true);
            }
        }

        // Update query parameter visibility
        updateQueryParamsForDataset(datasetId);

        // Update the next button label for datasets that skip the query step
        const nextBtn = document.querySelector('.btn-next[data-next-step="3"]');
        if (nextBtn) {
            if (SKIPS_QUERY.has(datasetId)) {
                nextBtn.innerHTML = 'نتایج <i class="bi bi-chevron-left"></i>';
            } else {
                nextBtn.innerHTML = 'بعدی <i class="bi bi-chevron-left"></i>';
            }
        }

        // Update summary
        const ds = DATASETS.find(d => d.id === datasetId);
        setSummaryDataset(datasetId, ds ? ds.name : datasetId);

        EventBus.emit('dataset:changed', datasetId);
    }

    /**
     * Show/hide query parameters that are relevant for this dataset.
     */
    function updateQueryParamsForDataset(datasetId) {
        const cloudSection = document.getElementById('cloudCoverSection');
        const cloudNote = document.getElementById('cloudCoverNote');
        const dateSection = document.getElementById('dateRangeSection');
        const osmSection = document.getElementById('osmTagSection');
        if (!cloudSection) return;

        const isOsm = datasetId === 'OSM';
        const isWeather = datasetId === 'WTH';
        const isDem = datasetId === 'DEM';
        const supportsCloud = CLOUD_CAPABLE.has(datasetId);

        cloudSection.style.display = (isOsm || isWeather || isDem) ? 'none' : (supportsCloud ? 'block' : 'none');
        if (cloudNote) {
            cloudNote.style.display = isOsm || isWeather || isDem ? 'none' : (supportsCloud ? 'none' : 'block');
        }
        if (dateSection) {
            dateSection.style.display = (isOsm || isDem) ? 'none' : 'block';
        }
        if (osmSection) {
            osmSection.style.display = isOsm ? 'block' : 'none';
        }
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
