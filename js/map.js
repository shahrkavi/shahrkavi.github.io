/**
 * Shahrkavi - Map Module
 * Leaflet.js map with drawing tools and basemap selection
 */

const MapModule = (() => {
    let map;
    let drawnItems;          // FeatureGroup for the active region rectangle
    let drawControl = null;
    let coveragePreviewLayer = null;
    let coveragePreviewId = null;

    function bingQuadKey(coords) {
        let quadKey = '';
        for (let i = coords.z; i > 0; i -= 1) {
            let digit = 0;
            const mask = 1 << (i - 1);
            if ((coords.x & mask) !== 0) digit += 1;
            if ((coords.y & mask) !== 0) digit += 2;
            quadKey += digit;
        }
        return quadKey;
    }

    function bingLayer(style, attribution) {
        const extension = style === 'r' ? 'png' : 'jpeg';
        const layer = L.tileLayer('', {
            minZoom: 1,
            maxZoom: 19,
            subdomains: ['0', '1', '2', '3'],
            attribution,
            errorTileUrl: '',
        });

        layer.getTileUrl = function(coords) {
            const max = Math.pow(2, coords.z);
            const x = ((coords.x % max) + max) % max;
            const y = coords.y;
            if (y < 0 || y >= max) return '';
            const quadkey = bingQuadKey({ x, y, z: coords.z });
            const subdomain = this.options.subdomains[(x + y) % this.options.subdomains.length];
            const key = encodeURIComponent(window.BING_MAPS_KEY || '');
            return `https://ecn.t${subdomain}.tiles.virtualearth.net/tiles/${style}${quadkey}.${extension}?g=1&key=${key}`;
        };

        if (!window.BING_MAPS_KEY) {
            console.warn('Bing basemaps need window.BING_MAPS_KEY in js/config.js');
        }
        return layer;
    }

    const BING_ATTRIBUTION = '&copy; Microsoft Bing Maps';

    // Basemap definitions
    const BASEMAPS = {
        satellite: {
            name: 'ماهواره‌ای',
            layer: bingLayer('a', BING_ATTRIBUTION),
        },
        osm: {
            name: 'OpenStreetMap',
            layer: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            }),
        },
        terrain: {
            name: 'زمین',
            layer: L.tileLayer('https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.{ext}', {
                minZoom: 0,
                maxZoom: 18,
                ext: 'png',
                detectRetina: true,
                attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://stamen.com/">Stamen Design</a> | &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            }),
        },
    };

    let currentBasemap = 'osm';
    let activeBasemapLayer;

    // Additional layers storage
    let userLayers = [];
    let trafficLayerGroup = null;

    // Scene preview overlays (scene id -> L.imageOverlay)
    let imageOverlays = {};

    function init() {
        // Create map centered on Iran
        map = L.map('map', {
            center: [32.4279, 53.6880],
            zoom: 5,
            zoomControl: false,
            attributionControl: true,
        });

        // Add default basemap
        activeBasemapLayer = BASEMAPS[currentBasemap].layer;
        map.addLayer(activeBasemapLayer);

        // Initialize drawn items layer
        drawnItems = new L.FeatureGroup();
        map.addLayer(drawnItems);

        // Initialize Leaflet Draw control (hidden, we use our own toolbar)
        initDrawControl();

        // Add zoom control (after draw button so it appears below it)
        L.control.zoom({ position: 'topright' }).addTo(map);

        // Mouse move for coordinates
        map.on('mousemove', onMouseMove);

        // Zoom change
        map.on('zoomend', onZoomEnd);

        // Handle drawing events
        map.on(L.Draw.Event.CREATED, onDrawCreated);
        map.on(L.Draw.Event.DELETED, onDrawDeleted);

        // Listen for basemap changes from layers module
        EventBus.on('basemap:changed', switchBasemap);

        console.log('Map module initialized');
    }

    function initDrawControl() {
        drawControl = new L.Control.Draw({
            position: 'topright',
            draw: {
                rectangle: {
                    shapeOptions: {
                        color: '#ff7800',
                        weight: 2,
                        fillColor: '#ff7800',
                        fillOpacity: 0.2,
                    },
                },
            },
            edit: {
                featureGroup: drawnItems,
                edit: false,
                remove: false,
            },
        });

        // Add the control but hide its default toolbar
        map.addControl(drawControl);

        setTimeout(() => {
            const drawToolbar = document.querySelector('.leaflet-draw.leaflet-control');
            if (drawToolbar) drawToolbar.style.display = 'none';
        }, 100);

        // Add custom draw button inside native Leaflet topright controls
        const DrawRegionButton = L.Control.extend({
            options: { position: 'topright' },
            onAdd: function () {
                const btn = L.DomUtil.create('button', 'leaflet-bar leaflet-control leaflet-control-draw-region');
                btn.type = 'button';
                btn.dataset.tool = 'rectangle';
                btn.title = 'رسم مستطیل';
                btn.setAttribute('aria-label', 'رسم مستطیل');
                btn.setAttribute('aria-pressed', 'false');
                btn.innerHTML = '<i class="bi bi-bounding-box"></i>';
                L.DomEvent.disableClickPropagation(btn);
                btn.addEventListener('click', function () {
                    activateTool('rectangle');
                });
                return btn;
            },
        });
        new DrawRegionButton().addTo(map);
    }

    function activateTool(tool) {
        if (tool !== 'rectangle') return;

        if (map._activeDrawHandler) {
            cancelDrawing();
            return;
        }

        if (drawnItems.getLayers().length > 0) {
            clearDrawing();
            return;
        }

        const handler = new L.Draw.Rectangle(map, drawControl.options.draw.rectangle);
        handler.enable();
        map._activeDrawHandler = handler;
        updateToolbarState();
        EventBus.emit('map:tool:activated', tool);
    }

    function cancelDrawing() {
        if (map._activeDrawHandler) {
            map._activeDrawHandler.disable();
            map._activeDrawHandler = null;
        }
        updateToolbarState();
    }

    function clearRegionLayer(emitClearEvent = false, forceClearEvent = false) {
        const hadRegion = drawnItems && drawnItems.getLayers().length > 0;
        drawnItems.clearLayers();
        AppState.mapDrawings = null;
        updateToolbarState();
        if ((emitClearEvent && hadRegion) || forceClearEvent) {
            EventBus.emit('map:drawings:cleared');
        }
    }

    function clearDrawing() {
        clearRegionLayer(true);
    }

    function setRegionBounds(bounds, source = 'map-bounds') {
        if (!map || !drawnItems || !bounds) return null;

        cancelDrawing();
        clearRegionLayer(true);

        const layer = L.rectangle(
            [[bounds.south, bounds.west], [bounds.north, bounds.east]],
            {
                color: '#ff7800',
                weight: 2,
                fillColor: '#ff7800',
                fillOpacity: 0.2,
            }
        ).addTo(drawnItems);

        const coords = {
            type: 'rectangle',
            source,
            north: bounds.north,
            south: bounds.south,
            east: bounds.east,
            west: bounds.west,
        };
        AppState.mapDrawings = coords;
        updateToolbarState();
        EventBus.emit('map:drawing:created', coords);
        return layer;
    }

    function deactivateTools() {
        cancelDrawing();
    }

    function updateToolbarState() {
        const button = document.querySelector('.leaflet-control-draw-region')
            || document.querySelector('[data-tool="rectangle"]');
        const icon = button?.querySelector('i');
        const isDrawing = Boolean(map?._activeDrawHandler);
        const hasDrawing = drawnItems && drawnItems.getLayers().length > 0;

        if (!button || !icon) return;

        button.classList.toggle('active', isDrawing);
        button.setAttribute('aria-pressed', String(isDrawing));

        if (isDrawing) {
            icon.className = 'bi bi-x-circle';
            button.title = 'لغو ترسیم';
            button.setAttribute('aria-label', 'لغو ترسیم مستطیل');
        } else if (hasDrawing) {
            icon.className = 'bi bi-trash3';
            button.title = 'پاک کردن مستطیل';
            button.setAttribute('aria-label', 'پاک کردن مستطیل ترسیم‌شده');
        } else {
            icon.className = 'bi bi-bounding-box';
            button.title = 'رسم مستطیل';
            button.setAttribute('aria-label', 'رسم مستطیل روی نقشه');
        }
    }

    function onDrawCreated(e) {
        const layer = e.layer;
        drawnItems.clearLayers();
        drawnItems.addLayer(layer);

        let coords = null;
        if (e.layerType === 'rectangle') {
            const bounds = layer.getBounds();
            coords = {
                type: 'rectangle',
                north: bounds.getNorth(),
                south: bounds.getSouth(),
                east: bounds.getEast(),
                west: bounds.getWest(),
            };
        }

        if (!coords) return;

        AppState.mapDrawings = coords;
        EventBus.emit('map:drawing:created', coords);

        if (coords.type !== 'point') {
            document.getElementById('North') && (document.getElementById('North').value = coords.north.toFixed(4));
            document.getElementById('South') && (document.getElementById('South').value = coords.south.toFixed(4));
            document.getElementById('East') && (document.getElementById('East').value = coords.east.toFixed(4));
            document.getElementById('West') && (document.getElementById('West').value = coords.west.toFixed(4));
        }

        deactivateTools();
    }

    function onDrawEdited() {
        if (drawnItems.getLayers().length === 0) return;

        const bounds = drawnItems.getBounds();
        const coords = {
            type: 'rectangle',
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest(),
        };
        AppState.mapDrawings = coords;
        EventBus.emit('map:drawing:created', coords);
    }

    function onDrawDeleted() {
        clearRegionLayer(false);
        EventBus.emit('map:drawings:cleared');
    }

    function onMouseMove(e) {
        const latEl = document.getElementById('coordLat');
        const lngEl = document.getElementById('coordLng');
        if (latEl) latEl.textContent = e.latlng.lat.toFixed(4);
        if (lngEl) lngEl.textContent = e.latlng.lng.toFixed(4);
    }

    function onZoomEnd() {
        const zoomEl = document.getElementById('zoomLevel');
        if (zoomEl) zoomEl.textContent = map.getZoom();
    }

    function switchBasemap(basemapKey) {
        if (!BASEMAPS[basemapKey] || basemapKey === currentBasemap) return;

        map.removeLayer(activeBasemapLayer);
        currentBasemap = basemapKey;
        activeBasemapLayer = BASEMAPS[basemapKey].layer;
        map.addLayer(activeBasemapLayer);

        // Bring drawn items to front
        drawnItems.bringToFront();
        userLayers.forEach(l => l.bringToFront());

        EventBus.emit('basemap:changed:after', basemapKey);
    }

    /**
     * Get current map bounds
     */
    function getMapBounds() {
        const bounds = map.getBounds();
        return {
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest(),
        };
    }

    /**
     * Replace the active region with a rectangle.
     */
    function showSelectionBounds(north, south, east, west) {
        return setRegionBounds({ north, south, east, west });
    }

    /**
     * Remove the active region without emitting a clear event.
     */
    function clearSelectionBounds() {
        clearRegionLayer(false);
    }

    /**
     * Fit map to given bounds
     */
    function fitBounds(north, south, east, west) {
        map.fitBounds([[south, west], [north, east]], { padding: [30, 30] });
    }

    /**
     * Add a result footprint polygon to the map
     */
    function showFootprint(footprint, color = '#3388ff', opts = {}) {
        const latlngs = footprint.map(p => [p.lat, p.lng]);
        const polygon = L.polygon(latlngs, {
            color: color,
            weight: opts.weight ?? 1,
            fillColor: color,
            fillOpacity: opts.fillOpacity ?? 0.15,
            dashArray: opts.dashArray === undefined ? '5, 5' : opts.dashArray,
        });
        polygon.addTo(map);
        userLayers.push(polygon);
        return polygon;
    }

    /** Toggle one historical-image coverage geometry on the map. */
    function toggleCoveragePreview(id, geometry, opts = {}) {
        if (!map || !geometry) return false;

        if (coveragePreviewLayer && coveragePreviewId === id) {
            map.removeLayer(coveragePreviewLayer);
            coveragePreviewLayer = null;
            coveragePreviewId = null;
            return false;
        }
        if (coveragePreviewLayer) map.removeLayer(coveragePreviewLayer);

        coveragePreviewLayer = L.geoJSON({ type: 'Feature', properties: {}, geometry }, {
            style: {
                color: opts.color || '#0d6efd',
                weight: opts.weight ?? 3,
                opacity: 0.95,
                fillColor: opts.fillColor || '#0d6efd',
                fillOpacity: opts.fillOpacity ?? 0.2,
            },
        }).addTo(map);
        coveragePreviewId = id;
        if (coveragePreviewLayer.getBounds().isValid()) {
            map.fitBounds(coveragePreviewLayer.getBounds(), { padding: [20, 20] });
        }
        return true;
    }

    /**
     * Toggle a georeferenced preview image over a scene footprint.
     * bounds = [[south, west], [north, east]]. Returns true if now shown.
     */
    function toggleImageOverlay(id, imageUrl, bounds) {
        if (!map || !imageUrl) return false;

        if (imageOverlays[id]) {
            map.removeLayer(imageOverlays[id]);
            delete imageOverlays[id];
            return false;
        }

        const overlay = L.imageOverlay(imageUrl, bounds, {
            opacity: 0.85,
            interactive: true,
        });
        overlay.addTo(map);
        imageOverlays[id] = overlay;
        map.fitBounds(bounds, { padding: [20, 20] });
        return true;
    }

    /**
     * Toggle a TileJSON-powered preview: server-rendered Mercator tiles that
     * follow the scene's true geometry (no stretching for non-rectangular
     * footprints like MODIS swaths).
     * Returns true if shown, false if removed, null on failure.
     */
    async function toggleTileJsonOverlay(id, tilejsonUrl, bounds) {
        if (!map || !tilejsonUrl) return null;

        if (imageOverlays[id]) {
            map.removeLayer(imageOverlays[id]);
            delete imageOverlays[id];
            return false;
        }

        try {
            const res = await fetch(tilejsonUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const tj = await res.json();
            const template = (tj.tiles && tj.tiles[0]) || null;
            if (!template) throw new Error('TileJSON has no tile URLs');

            const layer = L.tileLayer(template, { opacity: 0.9 });
            layer.addTo(map);
            imageOverlays[id] = layer;
            map.fitBounds(bounds, { padding: [20, 20] });
            return true;
        } catch (e) {
            console.error('TileJSON preview failed:', e);
            return null;
        }
    }

    /**
     * Remove all scene preview overlays
     */
    function clearImageOverlays() {
        Object.values(imageOverlays).forEach(layer => map.removeLayer(layer));
        imageOverlays = {};
    }

    // === OSM layer feature preview (single active overlay) ===

    let osmPreviewLayer = null;
    let osmPreviewId = null;

function escapeHtmlText(str) {
        return String(str ?? '').replace(/[&<>"']/g,
            c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": "'" }[c]));
    }
    // Alias for compatibility
    const escapeHtml = escapeHtmlText;

    function osmPopupHtml(props) {
        const rows = ['name', 'name:en'].filter(k => props[k]).map(k =>
            `<div><b>${escapeHtmlText(props[k])}</b></div>`);
        const extras = Object.entries(props)
            .filter(([k, v]) => k !== 'name' && k !== 'name:en' && typeof v !== 'object')
            .slice(0, 6)
            .map(([k, v]) => `<div><span class="text-muted">${escapeHtmlText(k)}:</span> ${escapeHtmlText(v)}</div>`);
        return `<div style="max-width:220px;font-size:.78rem" dir="ltr">${rows.concat(extras).join('')}</div>`;
    }

    /**
     * Show a GeoJSON FeatureCollection as the single OSM layer preview.
     * Replaces any previously shown preview. Returns true when shown.
     */
    function showGeoJsonOverlay(id, geojson) {
        if (!map || !geojson) return false;
        hideGeoJsonOverlay();

        osmPreviewLayer = L.geoJSON(geojson, {
            preferCanvas: true,
            style: () => ({
                color: '#fd7e14', weight: 2.5, opacity: .9, fillOpacity: .25,
            }),
            pointToLayer: (_f, latlng) => L.circleMarker(latlng, {
                radius: 5, color: '#fd7e14', weight: 1.5,
                fillColor: '#ffa94d', fillOpacity: .8,
            }),
            onEachFeature: (feature, layer) => {
                if (feature && feature.properties) {
                    layer.bindPopup(osmPopupHtml(feature.properties));
                }
            },
        }).addTo(map);
        osmPreviewId = id;

        const bounds = osmPreviewLayer.getBounds();
        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [20, 20], maxZoom: 16 });
        }
        return true;
    }

    /**
     * Remove the active OSM layer preview (if any)
     */
    function hideGeoJsonOverlay() {
        const wasId = osmPreviewId;
        if (osmPreviewLayer && map) {
            map.removeLayer(osmPreviewLayer);
        }
        osmPreviewLayer = null;
        osmPreviewId = null;
        return wasId;
    }

    /** Id of the layer currently previewed, or null */
    function getActiveGeoJsonId() {
        return osmPreviewId;
    }

    /**
     * Add a weather-station point marker to the map
     */
    function showStation(lat, lng, color = '#dc3545', label = '', options = {}) {
        const marker = L.circleMarker([lat, lng], {
            radius: options.radius ?? 7,
            color: '#fff',
            weight: 2,
            fillColor: color,
            fillOpacity: 0.9,
        });
        if (label) {
            marker.bindTooltip(label, { direction: 'top', offset: [0, -8] });
        }
        marker.addTo(map);
        userLayers.push(marker);
        return marker;
    }

    /**
     * Clear all user-added layers (keep basemap and drawn items)
     */
    function clearUserLayers() {
        userLayers.forEach(layer => map.removeLayer(layer));
        userLayers = [];
        if (coveragePreviewLayer) map.removeLayer(coveragePreviewLayer);
        coveragePreviewLayer = null;
        coveragePreviewId = null;
        if (trafficLayerGroup) map.removeLayer(trafficLayerGroup);
        trafficLayerGroup = null;
    }

    function showTrafficCounters(counters, selectedRouteCodes = []) {
        console.log('[showTrafficCounters] called with', counters?.length || 0, 'counters');
        if (!map) {
            console.warn('Map not initialized, cannot show traffic counters');
            return;
        }
        // Ensure map container has valid size
        if (map.getSize().x === 0 || map.getSize().y === 0) {
            map.invalidateSize();
        }
        if (trafficLayerGroup) map.removeLayer(trafficLayerGroup);
        trafficLayerGroup = L.layerGroup().addTo(map);
        const selected = new Set(selectedRouteCodes.map(Number));
        const bounds = [];
        (counters || []).forEach(counter => {
            const lat = Number(counter.latitude);
            const lng = Number(counter.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            bounds.push([lat, lng]);
            const marker = L.circleMarker([lat, lng], {
                radius: selected.has(Number(counter.route_code)) ? 9 : 7,
                color: selected.has(Number(counter.route_code)) ? '#0d6efd' : '#dc3545',
                weight: 2,
                fillOpacity: 0.85,
            });
            marker.bindPopup(`<strong>${escapeHtml(counter.name || counter.route_name || '')}</strong><br>` +
                `کد مسیر: ${escapeHtml(String(counter.route_code))}<br>` +
                `رکورد روزانه: ${toPersianNum(counter.daily_record_count || 0)}`);
            marker.addTo(trafficLayerGroup);
        });
        if (bounds.length && !trafficLayerGroup._trafficFitted) {
            try {
                map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
                trafficLayerGroup._trafficFitted = true;
            } catch (e) {
                console.warn('fitBounds failed for traffic markers:', e);
            }
        }
    }

    /**
     * Add a custom WMS/tile layer
     */
    function addTileLayer(url, options = {}) {
        const layer = L.tileLayer(url, {
            opacity: options.opacity || 0.7,
            ...options,
        });
        layer.addTo(map);
        userLayers.push(layer);
        return layer;
    }

    /**
     * Get drawn area bounds for search
     */
    function getBounds() {
        if (AppState.mapDrawings) {
            return {
                north: AppState.mapDrawings.north,
                south: AppState.mapDrawings.south,
                east: AppState.mapDrawings.east,
                west: AppState.mapDrawings.west,
            };
        }
        return getMapBounds();
    }

    /**
     * Invalidate map size (call after container resize)
     */
    function invalidateSize() {
        if (map) map.invalidateSize();
    }

    return {
        init,
        map: () => map,
        drawnItems: () => drawnItems,
        getMapBounds,
        showSelectionBounds,
        clearSelectionBounds,
        fitBounds,
        showFootprint,
        toggleCoveragePreview,
        showStation,
        showTrafficCounters,
        clearUserLayers,
        toggleImageOverlay,
        toggleTileJsonOverlay,
        clearImageOverlays,
        showGeoJsonOverlay,
        hideGeoJsonOverlay,
        getActiveGeoJsonId,
        addTileLayer,
        getBounds,
        invalidateSize,
        switchBasemap,
        deactivateTools,
        BASEMAPS,
    };
})();

// Auto-initialize map
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', MapModule.init);
} else {
    MapModule.init();
}
