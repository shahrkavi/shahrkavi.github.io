/**
 * Shahrkavi - Map Module
 * Leaflet.js map with drawing tools and basemap selection
 */

const MapModule = (() => {
    let map;
    let drawnItems;          // FeatureGroup for drawn shapes
    let currentTool = null;
    let drawControl = null;

    // Basemap definitions
    const BASEMAPS = {
        satellite: {
            name: 'ماهواره‌ای',
            layer: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: '© Esri, Maxar, Earthstar Geographics',
                maxZoom: 19,
            }),
        },
        osm: {
            name: 'OpenStreetMap',
            layer: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19,
            }),
        },
        topo: {
            name: 'توپوگرافی',
            layer: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenTopoMap contributors',
                maxZoom: 17,
            }),
        },
        streets: {
            name: 'خیابان‌ها',
            layer: L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors, Humanitarian OSM Team',
                maxZoom: 19,
            }),
        },
    };

    let currentBasemap = 'streets';
    let activeBasemapLayer;

    // Additional layers storage
    let userLayers = [];

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
     * Fit map to given bounds
     */
    function fitBounds(north, south, east, west) {
        map.fitBounds([[south, west], [north, east]], { padding: [30, 30] });
    }

    /**
     * Add a result footprint polygon to the map
     */
    function showFootprint(footprint, color = '#3388ff') {
        const latlngs = footprint.map(p => [p.lat, p.lng]);
        const polygon = L.polygon(latlngs, {
            color: color,
            weight: 1,
            fillColor: color,
            fillOpacity: 0.15,
            dashArray: '5, 5',
        });
        polygon.addTo(map);
        userLayers.push(polygon);
        return polygon;
    }

    /**
     * Add a weather-station point marker to the map
     */
    function showStation(lat, lng, color = '#dc3545', label = '') {
        const marker = L.circleMarker([lat, lng], {
            radius: 7,
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
        fitBounds,
        showFootprint,
        showStation,
        clearUserLayers,
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
