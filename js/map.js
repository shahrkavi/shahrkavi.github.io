/**
 * Shahrkavi - Map Module
 * Leaflet.js map with drawing tools and basemap selection
 */

const MapModule = (() => {
    let map;
    let drawnItems;          // FeatureGroup for drawn shapes
    let currentTool = null;
    let drawControl = null;
    let selectionRect = null; // Highlight rectangle for the selected region

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

        // Add zoom control to a custom position
        L.control.zoom({ position: 'topright' }).addTo(map);

        // Add default basemap
        activeBasemapLayer = BASEMAPS[currentBasemap].layer;
        map.addLayer(activeBasemapLayer);

        // Initialize drawn items layer
        drawnItems = new L.FeatureGroup();
        map.addLayer(drawnItems);

        // Initialize Leaflet Draw control (hidden, we use our own toolbar)
        initDrawControl();

        // Mouse move for coordinates
        map.on('mousemove', onMouseMove);

        // Zoom change
        map.on('zoomend', onZoomEnd);

        // Handle drawing events
        map.on(L.Draw.Event.CREATED, onDrawCreated);
        map.on(L.Draw.Event.EDITED, onDrawEdited);
        map.on(L.Draw.Event.DELETED, onDrawDeleted);

        // Init toolbar
        initToolbar();

        // Listen for basemap changes from layers module
        EventBus.on('basemap:changed', switchBasemap);

        console.log('Map module initialized');
    }

    function initDrawControl() {
        drawControl = new L.Control.Draw({
            position: 'topright',
            draw: {
                polyline: false,
                circle: false,
                circlemarker: false,
                marker: {
                    icon: L.icon({
                        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
                        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
                        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
                        iconSize: [25, 41],
                        iconAnchor: [12, 41],
                    }),
                },
                rectangle: {
                    shapeOptions: {
                        color: '#ff7800',
                        weight: 2,
                        fillColor: '#ff7800',
                        fillOpacity: 0.2,
                    },
                },
                polygon: {
                    shapeOptions: {
                        color: '#ff7800',
                        weight: 2,
                        fillColor: '#ff7800',
                        fillOpacity: 0.2,
                    },
                    allowIntersection: false,
                    showArea: true,
                },
            },
            edit: {
                featureGroup: drawnItems,
                edit: true,
                remove: true,
            },
        });

        // Add the control but we'll hide its toolbar since we use our own
        map.addControl(drawControl);

        // Hide the default Leaflet.draw toolbar
        setTimeout(() => {
            const drawToolbar = document.querySelector('.leaflet-draw.leaflet-control');
            if (drawToolbar) {
                drawToolbar.style.display = 'none';
            }
        }, 100);
    }

    function initToolbar() {
        const toolbar = document.getElementById('mapToolbar');
        if (!toolbar) return;

        toolbar.querySelectorAll('[data-tool]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const tool = btn.dataset.tool;
                activateTool(tool);
            });
        });
    }

    function activateTool(tool) {
        // Clear current tool
        if (currentTool === tool) {
            deactivateTools();
            return;
        }

        // Deactivate current
        deactivateTools();

        // Clear existing drawings if "clear" tool
        if (tool === 'clear') {
            drawnItems.clearLayers();
            AppState.mapDrawings = null;
            EventBus.emit('map:drawings:cleared');
            return;
        }

        // Activate new tool
        const drawType = {
            point: 'marker',
            rectangle: 'rectangle',
            polygon: 'polygon',
        }[tool];

        if (drawType) {
            currentTool = tool;

            // Programmatically activate the draw handler
            const Draw = L.Draw;
            const Feature = drawType === 'marker' ? Draw.Marker :
                             drawType === 'rectangle' ? Draw.Rectangle :
                             Draw.Polygon;

            // Use the internal draw handler
            const options = drawControl.options.draw[drawType];
            const handler = new Feature(map, options);
            handler.enable();

            // Store handler for later disable
            map._activeDrawHandler = handler;

            // Update button state
            document.querySelector(`[data-tool="${tool}"]`)?.classList.add('active');

            EventBus.emit('map:tool:activated', tool);
        }
    }

    function deactivateTools() {
        if (map._activeDrawHandler) {
            map._activeDrawHandler.disable();
            map._activeDrawHandler = null;
        }
        currentTool = null;
        document.querySelectorAll('.map-tool-btn').forEach(b => b.classList.remove('active'));
    }

    function onDrawCreated(e) {
        const layer = e.layer;
        drawnItems.addLayer(layer);

        // Extract coordinates
        let coords = null;
        if (e.layerType === 'marker') {
            const latlng = layer.getLatLng();
            coords = {
                type: 'point',
                lat: latlng.lat,
                lng: latlng.lng,
            };
        } else if (e.layerType === 'rectangle') {
            const bounds = layer.getBounds();
            coords = {
                type: 'rectangle',
                north: bounds.getNorth(),
                south: bounds.getSouth(),
                east: bounds.getEast(),
                west: bounds.getWest(),
            };
        } else if (e.layerType === 'polygon') {
            const latlngs = layer.getLatLngs()[0];
            const lats = latlngs.map(ll => ll.lat);
            const lngs = latlngs.map(ll => ll.lng);
            coords = {
                type: 'polygon',
                north: Math.max(...lats),
                south: Math.min(...lats),
                east: Math.max(...lngs),
                west: Math.min(...lngs),
                vertices: latlngs.map(ll => ({ lat: ll.lat, lng: ll.lng })),
            };
        }

        AppState.mapDrawings = coords;
        EventBus.emit('map:drawing:created', coords);

        // Auto-fill the form
        if (coords && coords.type !== 'point') {
            document.getElementById('North') && (document.getElementById('North').value = coords.north.toFixed(4));
            document.getElementById('South') && (document.getElementById('South').value = coords.south.toFixed(4));
            document.getElementById('East') && (document.getElementById('East').value = coords.east.toFixed(4));
            document.getElementById('West') && (document.getElementById('West').value = coords.west.toFixed(4));
        }

        // Deactivate tool after drawing
        deactivateTools();
    }

    function onDrawEdited(e) {
        // Re-extract coordinates from edited shapes
        if (drawnItems.getLayers().length > 0) {
            const layer = drawnItems.getLayers()[0];
            // Recalculate bounds
            const bounds = drawnItems.getBounds();
            const coords = {
                type: 'shape',
                north: bounds.getNorth(),
                south: bounds.getSouth(),
                east: bounds.getEast(),
                west: bounds.getWest(),
            };
            AppState.mapDrawings = coords;
            EventBus.emit('map:drawing:created', coords);
        }
    }

    function onDrawDeleted() {
        AppState.mapDrawings = null;
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
     * Draw/replace the highlight rectangle for the currently selected region
     * (kept outside drawnItems so draw/edit/remove tools don't touch it)
     */
    function showSelectionBounds(north, south, east, west) {
        if (!map) return null;
        if (selectionRect) {
            map.removeLayer(selectionRect);
        }
        selectionRect = L.rectangle(
            [[south, west], [north, east]],
            {
                color: '#ff7800',
                weight: 2,
                dashArray: '6, 4',
                fillColor: '#ff7800',
                fillOpacity: 0.08,
                interactive: false,
            }
        );
        selectionRect.addTo(map);
        return selectionRect;
    }

    /**
     * Remove the selection rectangle (if shown)
     */
    function clearSelectionBounds() {
        if (selectionRect && map) {
            map.removeLayer(selectionRect);
        }
        selectionRect = null;
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
            c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

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
        showStation,
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
