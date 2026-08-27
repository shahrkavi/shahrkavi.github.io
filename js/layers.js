/**
 * Shahrkavi - Layers Tab Module
 * Layer management for map layers, visibility, opacity, and basemap switch
 */

const LayersModule = (() => {
    // Layer definitions with state
    const DEFAULT_LAYERS = [
        {
            id: 'layer-labels',
            name: 'برچسب شهرها',
            icon: 'bi-pin-map',
            type: 'overlay',
            visible: false,
            opacity: 1.0,
            layer: null,
            source: null,
        },
    ];

    let layers = [];

    function init() {
        // Deep copy default layers
        layers = JSON.parse(JSON.stringify(DEFAULT_LAYERS));

        // Add sample layers (Iran boundary + city labels)
        createSampleLayers();

        // Add visible layers to the map
        syncLayersToMap();

        renderLayerList();

        // Basemap selector
        const basemapSelect = document.getElementById('basemapSelect');
        if (basemapSelect) {
            basemapSelect.addEventListener('change', (e) => {
                MapModule.switchBasemap(e.target.value);
                showToast(`نقشه پایه تغییر کرد: ${MapModule.BASEMAPS[e.target.value].name}`, 'info');
            });
        }

        // Listen for basemap changes
        EventBus.on('basemap:changed:after', (basemapKey) => {
            const select = document.getElementById('basemapSelect');
            if (select) select.value = basemapKey;
        });

        console.log('Layers module initialized');
    }

    function createSampleLayers() {
        // City labels - sample points layer
        const cityMarkers = L.layerGroup([
            L.marker([35.6892, 51.3890], { title: 'تهران' }).bindPopup('تهران'),
            L.marker([32.6539, 51.6660], { title: 'اصفهان' }).bindPopup('اصفهان'),
            L.marker([36.2605, 59.6168], { title: 'مشهد' }).bindPopup('مشهد'),
            L.marker([29.5926, 52.5836], { title: 'شیراز' }).bindPopup('شیراز'),
            L.marker([38.0666, 46.2995], { title: 'تبریز' }).bindPopup('تبریز'),
        ]);
        layers[0].layer = cityMarkers;
        layers[0].source = 'custom';
    }

    /**
     * Add all visible layers to the map (if not already added)
     */
    function syncLayersToMap() {
        const map = MapModule.map();
        if (!map) return;
        layers.forEach(layer => {
            if (layer.layer && layer.visible && !map.hasLayer(layer.layer)) {
                map.addLayer(layer.layer);
            }
        });
    }

    function renderLayerList() {
        const container = document.getElementById('layerList');
        if (!container) return;

        if (layers.length === 0) {
            container.innerHTML = `
                <div class="text-center text-muted py-4">
                    <i class="bi bi-layers" style="font-size:2rem"></i>
                    <p class="mt-2 mb-0">لایه‌ای وجود ندارد</p>
                    <small>از نتایج جستجو می‌توانید لایه اضافه کنید</small>
                </div>
            `;
            return;
        }

        container.innerHTML = layers.map((layer, index) => `
            <div class="layer-item" data-layer-id="${layer.id}" data-index="${index}">
                <span class="layer-drag-handle" title="جابجایی">
                    <i class="bi bi-grip-vertical"></i>
                </span>
                <span class="layer-icon">
                    <i class="bi ${layer.icon}"></i>
                </span>
                <span class="layer-name">${layer.name}</span>
                <div class="layer-opacity">
                    <input type="range" class="form-range form-range-sm"
                        min="0" max="100" value="${Math.round(layer.opacity * 100)}"
                        data-layer-id="${layer.id}">
                </div>
                <div class="layer-actions">
                    <button class="btn btn-sm btn-link layer-btn-visibility"
                        data-layer-id="${layer.id}" title="${layer.visible ? 'مخفی کردن' : 'نمایش'}">
                        <i class="bi ${layer.visible ? 'bi-eye' : 'bi-eye-slash'}"></i>
                    </button>
                    <button class="btn btn-sm btn-link text-danger layer-btn-remove"
                        data-layer-id="${layer.id}" title="حذف لایه">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');

        // Attach event listeners
        attachLayerEvents(container);
    }

    function attachLayerEvents(container) {
        // Visibility toggle
        container.querySelectorAll('.layer-btn-visibility').forEach(btn => {
            btn.addEventListener('click', () => {
                const layerId = btn.dataset.layerId;
                toggleLayerVisibility(layerId);
            });
        });

        // Remove layer
        container.querySelectorAll('.layer-btn-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const layerId = btn.dataset.layerId;
                removeLayer(layerId);
            });
        });

        // Opacity change
        container.querySelectorAll('.layer-opacity input').forEach(slider => {
            slider.addEventListener('input', () => {
                const layerId = slider.dataset.layerId;
                const opacity = parseInt(slider.value) / 100;
                setLayerOpacity(layerId, opacity);
            });
        });

        // Drag to reorder (simplified)
        initLayerDrag(container);
    }

    function toggleLayerVisibility(layerId) {
        const layer = layers.find(l => l.id === layerId);
        if (!layer) return;

        layer.visible = !layer.visible;

        if (layer.layer) {
            if (layer.visible) {
                MapModule.map().addLayer(layer.layer);
            } else {
                MapModule.map().removeLayer(layer.layer);
            }
        }

        renderLayerList();
        EventBus.emit('layer:visibility:changed', { id: layerId, visible: layer.visible });
    }

    function setLayerOpacity(layerId, opacity) {
        const layer = layers.find(l => l.id === layerId);
        if (!layer) return;

        layer.opacity = opacity;

        if (layer.layer) {
            if (layer.layer.setOpacity) {
                layer.layer.setOpacity(opacity);
            } else if (layer.layer.setStyle) {
                layer.layer.setStyle({ opacity: opacity, fillOpacity: opacity * 0.3 });
            }
        }
    }

    function removeLayer(layerId) {
        const layer = layers.find(l => l.id === layerId);
        if (!layer) return;

        if (layer.layer && MapModule.map().hasLayer(layer.layer)) {
            MapModule.map().removeLayer(layer.layer);
        }

        layers = layers.filter(l => l.id !== layerId);
        renderLayerList();
        EventBus.emit('layer:removed', layerId);
        showToast(`لایه "${layer.name}" حذف شد`, 'info');
    }

    /**
     * Add a new layer to the manager
     */
    function addLayer(name, leafletLayer, options = {}) {
        const layerObj = {
            id: 'layer-' + Date.now(),
            name: name,
            icon: options.icon || 'bi-map',
            type: 'overlay',
            visible: options.visible !== undefined ? options.visible : true,
            opacity: options.opacity || 0.7,
            layer: leafletLayer,
            source: options.source || 'user',
        };

        layers.push(layerObj);

        if (layerObj.visible && MapModule.map()) {
            MapModule.map().addLayer(leafletLayer);
        }

        renderLayerList();
        EventBus.emit('layer:added', layerObj);
        showToast(`لایه "${name}" اضافه شد`, 'success');

        return layerObj;
    }

    /**
     * Simple drag-to-reorder for layers
     */
    function initLayerDrag(container) {
        const items = container.querySelectorAll('.layer-item');
        items.forEach(item => {
            const handle = item.querySelector('.layer-drag-handle');
            if (!handle) return;

            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                // Simplified: just toggle a visual indicator
                item.classList.add('dragging');

                const onMouseUp = () => {
                    item.classList.remove('dragging');
                    document.removeEventListener('mouseup', onMouseUp);
                };
                document.addEventListener('mouseup', onMouseUp);
            });
        });
    }

    return {
        init,
        addLayer,
        removeLayer,
        toggleLayerVisibility,
        setLayerOpacity,
        getLayers: () => layers,
    };
})();

// Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', LayersModule.init);
} else {
    LayersModule.init();
}
