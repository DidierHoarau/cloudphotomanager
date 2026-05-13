<template>
  <div class="search-map-layout page">
    <NavigationSearch
      class="search-map-layout-navigation"
      @onAccountSelected="onAccountSelected"
    />
    <div class="search-map-info">
      <kbd v-if="totalGeoTagged > 0">
        Geo-tagged photos in view: {{ totalGeoTagged }}
      </kbd>
      <kbd v-else-if="!loadingGrid && currentAccountId">
        No geo-tagged photos in view
      </kbd>
    </div>
    <div class="search-map-container">
      <div ref="mapEl" class="search-map"></div>
      <div v-if="loadingMap" class="search-map-loading">
        <Loading />
      </div>
    </div>

    <!-- Cell dialog (reuses Gallery) -->
    <div
      v-if="cellDialogOpen"
      class="dialog-overlay"
      @click.self="closeCellDialog()"
    >
      <article class="dialog-article">
        <header>
          <a
            href="#close"
            aria-label="Close"
            class="close"
            @click.prevent="closeCellDialog()"
          ></a>
          <span v-if="selectedCell">
            Cell {{ selectedCell.row }}/{{ selectedCell.col }} -
            {{ selectedCell.count }} photo(s)
          </span>
        </header>
        <Loading v-if="loadingCell" />
        <Gallery
          v-else
          :files="cellFiles"
          :enableSelection="false"
          @focusGalleryItem="focusGalleryItem"
        />
      </article>
    </div>

    <GalleryItemFocus
      v-if="displayFullScreen"
      :galleryFiles="cellFiles"
      :initialPosition="positionFocus"
      :selectedFiles="[]"
      class="gallery-item-focus"
      @onFileClosed="unFocusGalleryItem"
    />
  </div>
</template>

<script>
import axios from "axios";
import { debounce, findIndex } from "lodash";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError } from "~~/services/EventBus";

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

// Lazily load Leaflet from CDN once per browser session.
let leafletPromise = null;
function loadLeaflet() {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    const existing = document.querySelector(`script[src="${LEAFLET_JS}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.L));
      existing.addEventListener("error", reject);
      return;
    }
    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return leafletPromise;
}

const GRID_ROWS = 10;
const GRID_COLS = 10;

export default {
  data() {
    return {
      serverUrl: "",
      currentAccountId: "",
      loadingMap: true,
      loadingGrid: false,
      // Map / Leaflet state
      map: null,
      L: null,
      markersLayer: null,
      resizeObserver: null,
      // Grid state
      lastBbox: null,
      cells: [],
      // Cell dialog state
      cellDialogOpen: false,
      selectedCell: null,
      cellFiles: [],
      loadingCell: false,
      // Full-screen viewer
      displayFullScreen: false,
      positionFocus: 0,
    };
  },
  computed: {
    totalGeoTagged() {
      return this.cells.reduce((acc, c) => acc + c.count, 0);
    },
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
    await AccountsStore().fetch();
  },
  async mounted() {
    try {
      this.L = await loadLeaflet();
      // Wait for the map container to be laid out before instantiating
      // Leaflet so it can measure its size correctly. Otherwise tiles only
      // render in the top-left corner until the next resize event.
      await this.$nextTick();
      this.initMap();
    } catch (err) {
      handleError(err);
    } finally {
      this.loadingMap = false;
    }
  },
  beforeUnmount() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  },
  methods: {
    initMap() {
      if (!this.L || !this.$refs.mapEl) return;
      const L = this.L;
      this.map = L.map(this.$refs.mapEl, {
        worldCopyJump: true,
      }).setView([20, 0], 2);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(this.map);
      this.markersLayer = L.layerGroup().addTo(this.map);
      this.map.on("moveend", this.refreshGridDebounced);
      this.map.on("zoomend", this.refreshGridDebounced);

      // Belt-and-suspenders against the classic "map only renders the
      // top-left tile on initial load" Leaflet bug: force a size
      // recomputation on the next two animation frames (covers slow
      // layouts and font/CSS settling) and on every container resize.
      const invalidate = () => {
        if (this.map) this.map.invalidateSize();
      };
      requestAnimationFrame(() => {
        invalidate();
        requestAnimationFrame(invalidate);
      });
      setTimeout(invalidate, 250);
      if (typeof ResizeObserver !== "undefined" && this.$refs.mapEl) {
        this.resizeObserver = new ResizeObserver(invalidate);
        this.resizeObserver.observe(this.$refs.mapEl);
      }
    },
    onAccountSelected(event) {
      this.currentAccountId = event.id;
      this.refreshGridDebounced();
    },
    // Debounced viewport refresh: requests aggregated cell counts for the
    // current map bounds, then redraws markers.
    // eslint-disable-next-line func-names
    refreshGridDebounced: debounce(function () {
      this.refreshGrid();
    }, 400),
    async refreshGrid() {
      if (!this.map || !this.currentAccountId) return;
      const bbox = this.getCurrentBbox();
      this.lastBbox = bbox;
      this.loadingGrid = true;
      try {
        const res = await axios.post(
          `${this.serverUrl}/accounts/${this.currentAccountId}/files/search/geoGrid`,
          { bbox, gridRows: GRID_ROWS, gridCols: GRID_COLS },
          await AuthService.getAuthHeader(),
        );
        // Drop the response if a more recent bbox has been requested in the
        // meantime (debounce + slow network protection).
        if (this.lastBbox !== bbox) return;
        this.cells = res.data.cells || [];
        this.renderMarkers();
      } catch (err) {
        handleError(err);
      } finally {
        this.loadingGrid = false;
      }
    },
    getCurrentBbox() {
      const b = this.map.getBounds();
      return {
        minLat: b.getSouth(),
        maxLat: b.getNorth(),
        minLon: b.getWest(),
        maxLon: b.getEast(),
      };
    },
    cellSubBbox(cell) {
      const b = this.lastBbox;
      const cellHeight = (b.maxLat - b.minLat) / GRID_ROWS;
      const cellWidth = (b.maxLon - b.minLon) / GRID_COLS;
      return {
        minLat: b.minLat + cell.row * cellHeight,
        maxLat: b.minLat + (cell.row + 1) * cellHeight,
        minLon: b.minLon + cell.col * cellWidth,
        maxLon: b.minLon + (cell.col + 1) * cellWidth,
      };
    },
    renderMarkers() {
      if (!this.markersLayer || !this.L) return;
      const L = this.L;
      this.markersLayer.clearLayers();
      const maxCount = this.cells.reduce((acc, c) => Math.max(acc, c.count), 0);
      for (const cell of this.cells) {
        if (!cell.count) continue;
        const radius = 10 + Math.log2(cell.count + 1) * 4;
        const marker = L.circleMarker([cell.centerLat, cell.centerLon], {
          radius,
          color: "#fff",
          weight: 1.5,
          fillColor: this.colorForCount(cell.count, maxCount),
          fillOpacity: 0.85,
        });
        marker.bindTooltip(String(cell.count), {
          permanent: true,
          direction: "center",
          className: "search-map-cell-label",
        });
        marker.on("click", () => this.openCellDialog(cell));
        marker.addTo(this.markersLayer);
      }
    },
    colorForCount(count, maxCount) {
      // Simple ramp from blue (low) to red (high), scaled by log so a few
      // dense areas don't wash out the rest of the map.
      if (maxCount <= 1) return "#3388ff";
      const t = Math.log2(count + 1) / Math.log2(maxCount + 1);
      const hue = 220 - 220 * t; // 220 (blue) -> 0 (red)
      return `hsl(${hue}, 75%, 50%)`;
    },
    async openCellDialog(cell) {
      this.selectedCell = cell;
      this.cellDialogOpen = true;
      this.cellFiles = [];
      this.loadingCell = true;
      try {
        const geoBox = this.cellSubBbox(cell);
        const res = await axios.post(
          `${this.serverUrl}/accounts/${this.currentAccountId}/files/search`,
          { filters: { geoBox } },
          await AuthService.getAuthHeader(),
        );
        this.cellFiles = res.data.files || [];
      } catch (err) {
        handleError(err);
      } finally {
        this.loadingCell = false;
      }
    },
    closeCellDialog() {
      this.cellDialogOpen = false;
      this.selectedCell = null;
      this.cellFiles = [];
    },
    focusGalleryItem(file) {
      if (!file) {
        this.displayFullScreen = false;
        return;
      }
      this.positionFocus = findIndex(this.cellFiles, { id: file.id });
      this.displayFullScreen = true;
    },
    unFocusGalleryItem() {
      this.displayFullScreen = false;
    },
  },
};
</script>

<style scoped>
.search-map-layout {
  display: grid;
  grid-template-rows: auto auto 1fr;
  grid-template-columns: 1fr;
  gap: 0.5em;
}
.search-map-info {
  min-height: 1.6em;
}
.search-map-container {
  position: relative;
  width: 100%;
  height: calc(100vh - 14em);
  min-height: 24em;
}
.search-map {
  width: 100%;
  height: 100%;
  border-radius: 4px;
}
.search-map-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.6);
  pointer-events: none;
  z-index: 5;
}
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.dialog-article {
  width: min(90vw, 90em);
  max-height: 85vh;
  overflow: auto;
  padding: 1em;
}
.gallery-item-focus {
  background-color: black;
  position: fixed;
  top: 0;
  right: 0;
  width: 100vw;
  height: 100vh;
  z-index: 20;
}
</style>

<style>
/*
 * Global (unscoped) styles for Leaflet — Leaflet injects its own DOM
 * (.leaflet-*) at runtime, outside Vue's scoped-CSS hashing. Pico CSS
 * (loaded globally via main.css) applies aggressive resets that fight
 * Leaflet's internal layout. The block below brute-forces the Leaflet
 * subtree back to its expected baseline.
 *
 * Confirmed Pico offenders:
 *   *, ::before, ::after { box-sizing: border-box }   -> tile math breaks
 *   img { max-width: 100%; height: auto; border-style: none }
 *   img, svg, video { vertical-align: middle }
 */

/* Restore content-box for the entire Leaflet subtree (Leaflet's tile and
 * pane positioning was designed for content-box sizing). */
.leaflet-container,
.leaflet-container *,
.leaflet-container *::before,
.leaflet-container *::after {
  box-sizing: content-box !important;
}

/* Tile + control images: undo Pico's max-width / height: auto / vertical-align. */
.leaflet-container img {
  max-width: none !important;
  max-height: none !important;
  width: auto !important;
  height: auto !important;
  vertical-align: top !important;
  display: block !important;
  padding: 0 !important;
  margin: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

/* Generic anchor reset inside the map (attribution, popups, etc.). */
.leaflet-container a {
  background: transparent !important;
  color: inherit !important;
  text-decoration: none !important;
  box-shadow: none !important;
  border: 0 !important;
}

/* Restore Leaflet's zoom-control look (Pico squashes the bordered button
 * style otherwise). */
.leaflet-bar a,
.leaflet-bar a:hover,
.leaflet-bar a:focus {
  background-color: #fff !important;
  color: #000 !important;
  width: 26px !important;
  height: 26px !important;
  line-height: 26px !important;
  font-size: 1.4em !important;
  display: block !important;
  text-align: center !important;
  border-bottom: 1px solid #ccc !important;
  border-radius: 0 !important;
}
.leaflet-bar a:first-child {
  border-top-left-radius: 4px !important;
  border-top-right-radius: 4px !important;
}
.leaflet-bar a:last-child {
  border-bottom-left-radius: 4px !important;
  border-bottom-right-radius: 4px !important;
  border-bottom: 0 !important;
}

/* Attribution control. */
.leaflet-control-attribution {
  background: rgba(255, 255, 255, 0.8) !important;
  font-size: 11px !important;
  color: #333 !important;
  padding: 0 5px !important;
}
.leaflet-control-attribution a {
  color: #0078a8 !important;
}

/* Buttons inside Leaflet controls (e.g. plugins). */
.leaflet-container button {
  all: revert;
}

/* Per-cell count tooltip. */
.search-map-cell-label {
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
  padding: 0 !important;
  color: #fff !important;
  font-weight: 700 !important;
  text-shadow:
    0 0 3px #000,
    0 0 3px #000 !important;
  pointer-events: none !important;
}
.search-map-cell-label::before {
  display: none !important;
}
</style>
