<template>
  <SearchLayout
    :initialAccountId="initialAccountId"
    @onAccountSelected="onAccountSelected"
  >
    <div class="search-map-content">
      <div class="search-map-info">
        <kbd v-if="totalGeoTagged > 0">
          Geo-tagged photos in view: {{ totalGeoTagged }}
        </kbd>
        <kbd v-else-if="!loadingGrid && currentAccountId && isOnline">
          No geo-tagged photos in view
        </kbd>
        <small v-if="!isOnline" class="search-map-offline" role="status">
          Offline: map tiles and places are unavailable
        </small>
        <span class="search-map-live" role="status" aria-live="polite">
          {{ liveStatusText }}
        </span>
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
        <article
          ref="cellDialog"
          class="dialog-article"
          role="dialog"
          aria-modal="true"
          aria-labelledby="search-map-cell-title"
          tabindex="-1"
          @keydown="onDialogKeydown"
        >
          <header>
            <a
              href="#close"
              aria-label="Close"
              class="close"
              @click.prevent="closeCellDialog()"
            ></a>
            <span id="search-map-cell-title">{{ cellDialogTitle }}</span>
          </header>
          <div v-if="cellSearchHref" class="search-map-cell-actions">
            <NuxtLink :to="cellSearchHref" @click="closeCellDialog()">
              <i class="bi bi-search"></i> Open in search
            </NuxtLink>
            <button
              v-if="cellFiles.length > 0"
              class="secondary outline"
              @click="clickedSlideshow()"
            >
              <i class="bi bi-play-fill"></i> Slideshow
            </button>
          </div>
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
        :slideshow="slideshowMode"
        class="gallery-item-focus"
        @onFileClosed="unFocusGalleryItem"
      />
    </div>
  </SearchLayout>
</template>

<script setup>
const { isOnline } = useNetworkStatus();
</script>

<script>
import axios from "axios";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { debounce, findIndex } from "lodash";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError } from "~~/services/EventBus";
import { dialogFocusFirst, dialogTrapFocus } from "~~/utils/DialogFocus";
import {
  cellSearchQuery,
  cellSubBbox,
  formatCellLabel,
  gridDimensionsForZoom,
  parseMapView,
  readMapView,
  storeMapView,
} from "~~/services/MapUtils";

export default {
  data() {
    return {
      serverUrl: "",
      currentAccountId: "",
      initialAccountId: "",
      loadingMap: true,
      loadingGrid: false,
      // Map / Leaflet state
      map: null,
      markersLayer: null,
      resizeObserver: null,
      // Grid state
      lastGrid: null,
      gridRequestId: 0,
      cells: [],
      // Cell dialog state
      cellDialogOpen: false,
      selectedCell: null,
      cellFiles: [],
      cellBbox: null,
      loadingCell: false,
      restoreFocusElement: null,
      // Full-screen viewer
      displayFullScreen: false,
      positionFocus: 0,
      slideshowMode: false,
    };
  },
  computed: {
    totalGeoTagged() {
      return this.cells.reduce((acc, c) => acc + c.count, 0);
    },
    liveStatusText() {
      if (!this.currentAccountId) return "";
      const total = this.totalGeoTagged;
      return total === 1
        ? "1 geo-tagged photo in view"
        : `${total} geo-tagged photos in view`;
    },
    cellDialogTitle() {
      if (!this.selectedCell) return "Map cell";
      const count = this.selectedCell.count;
      if (this.selectedCell.placeLabel) {
        return `${count} photo(s) near ${this.selectedCell.placeLabel}`;
      }
      const grid = this.lastGrid;
      return `${formatCellLabel(
        this.selectedCell,
        grid?.rows,
        grid?.cols,
      )} - ${count} photo(s)`;
    },
    cellSearchHref() {
      if (!this.selectedCell || !this.currentAccountId || !this.cellBbox) {
        return null;
      }
      return {
        path: "/search",
        query: cellSearchQuery(this.currentAccountId, this.cellBbox, {
          country: this.selectedCell.placeCountry || undefined,
          region: this.selectedCell.placeRegion || undefined,
          city: this.selectedCell.placeCity || undefined,
        }),
      };
    },
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
    await AccountsStore().fetch();
  },
  async mounted() {
    // Deep-link override: /search/map?accountId=…&lat=…&lon=…&zoom=… takes
    // precedence over the auto-selected first account (NavigationSearch has
    // already emitted its selection by the time this runs).
    const query = this.$route.query;
    if (typeof query.accountId === "string" && query.accountId) {
      this.initialAccountId = query.accountId;
      this.currentAccountId = query.accountId;
    }
    const deepView = parseMapView(query);
    try {
      // Wait for the map container to be laid out before instantiating
      // Leaflet so it can measure its size correctly. Otherwise tiles only
      // render in the top-left corner until the next resize event.
      await this.$nextTick();
      this.initMap();
      if (deepView) {
        this.map.setView([deepView.lat, deepView.lon], deepView.zoom, {
          animate: false,
        });
      } else if (this.currentAccountId) {
        this.applyStoredView(this.currentAccountId);
      }
      // The account selection may have been received before the map existed,
      // in which case its refresh was skipped: load the grid now.
      if (this.currentAccountId) this.refreshGridDebounced();
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
      if (!this.$refs.mapEl) return;
      this.map = L.map(this.$refs.mapEl, {
        worldCopyJump: true,
      }).setView([20, 0], 2);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(this.map);
      this.markersLayer = L.layerGroup().addTo(this.map);
      this.map.on("moveend", this.onMapViewChanged);
      this.map.on("zoomend", this.onMapViewChanged);

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
    storage() {
      return typeof window !== "undefined" ? window.sessionStorage : null;
    },
    applyStoredView(accountId) {
      if (!this.map) return;
      const stored = readMapView(this.storage(), accountId);
      if (stored) {
        this.map.setView([stored.lat, stored.lon], stored.zoom, {
          animate: false,
        });
      }
    },
    onAccountSelected(event) {
      const accountChanged = this.currentAccountId !== event.id;
      this.currentAccountId = event.id;
      // Restore the previously browsed view for this account unless the URL
      // carries explicit coordinates (deep link precedence).
      const queryView = parseMapView(this.$route.query);
      if (accountChanged && !queryView) {
        this.applyStoredView(event.id);
      }
      this.refreshGridDebounced();
    },
    onMapViewChanged() {
      if (!this.map) return;
      const center = this.map.getCenter();
      const view = {
        lat: center.lat,
        lon: center.lng,
        zoom: this.map.getZoom(),
      };
      if (this.currentAccountId) {
        storeMapView(this.storage(), this.currentAccountId, view);
      }
      this.updateRouteQuery(view);
      this.refreshGridDebounced();
    },
    updateRouteQuery(view) {
      const lat = view.lat.toFixed(5);
      const lon = view.lon.toFixed(5);
      const zoom = String(view.zoom);
      const current = this.$route.query;
      if (
        current.lat === lat &&
        current.lon === lon &&
        current.zoom === zoom &&
        (!this.currentAccountId ||
          current.accountId === this.currentAccountId)
      ) {
        return;
      }
      const query = { ...current, lat, lon, zoom };
      if (this.currentAccountId) {
        query.accountId = this.currentAccountId;
      }
      this.$router
        .replace({ path: this.$route.path, query })
        .catch(() => {});
    },
    // Debounced viewport refresh: requests aggregated cell counts for the
    // current map bounds, then redraws markers.
    // eslint-disable-next-line func-names
    refreshGridDebounced: debounce(function () {
      this.refreshGrid();
    }, 400),
    async refreshGrid() {
      if (!this.map || !this.currentAccountId) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        // Offline: keep the cells already in memory.
        return;
      }
      const bbox = this.getCurrentBbox();
      const dims = gridDimensionsForZoom(this.map.getZoom());
      this.gridRequestId += 1;
      const requestId = this.gridRequestId;
      this.loadingGrid = true;
      try {
        const res = await axios.post(
          `${this.serverUrl}/accounts/${this.currentAccountId}/files/search/geoGrid`,
          { bbox, gridRows: dims.rows, gridCols: dims.cols },
          await AuthService.getAuthHeader(),
        );
        // Drop the response if a more recent request has been issued in the
        // meantime (debounce + slow network protection).
        if (requestId !== this.gridRequestId) return;
        this.lastGrid = {
          bbox: res.data.bbox || bbox,
          rows: res.data.gridRows || dims.rows,
          cols: res.data.gridCols || dims.cols,
        };
        this.cells = res.data.cells || [];
        this.renderMarkers();
      } catch (err) {
        handleError(err);
      } finally {
        if (requestId === this.gridRequestId) {
          this.loadingGrid = false;
        }
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
      const grid = this.lastGrid;
      if (!grid) return null;
      return cellSubBbox(grid.bbox, cell, grid.rows, grid.cols);
    },
    markerAriaLabel(cell) {
      const label = formatCellLabel(cell, this.lastGrid?.rows, this.lastGrid?.cols);
      const photos = cell.count === 1 ? "photo" : "photos";
      return `${cell.count} ${photos} near ${label} - open`;
    },
    renderMarkers() {
      if (!this.markersLayer) return;
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
          keyboard: false,
        });
        marker.bindTooltip(String(cell.count), {
          permanent: true,
          direction: "center",
          className: "search-map-cell-label",
        });
        marker.on("click", () => this.openCellDialog(cell));
        marker.addTo(this.markersLayer);

        // Leaflet renders paths as SVG without semantics: make every cell a
        // focusable button so keyboard and screen-reader users can open it.
        const element = marker.getElement();
        const tooltip = marker.getTooltip();
        if (tooltip?.getElement()) {
          tooltip.getElement().setAttribute("aria-hidden", "true");
        }
        if (element) {
          element.setAttribute("role", "button");
          element.setAttribute("tabindex", "0");
          element.setAttribute("aria-label", this.markerAriaLabel(cell));
          element.addEventListener("keydown", (event) => {
            if (
              event.key === "Enter" ||
              event.key === " " ||
              event.key === "Spacebar"
            ) {
              event.preventDefault();
              this.openCellDialog(cell);
            }
          });
        }
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
      if (typeof document !== "undefined") {
        this.restoreFocusElement =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
      }
      this.selectedCell = cell;
      this.cellBbox = this.cellSubBbox(cell);
      this.cellDialogOpen = true;
      this.cellFiles = [];
      this.loadingCell = true;
      this.$nextTick(() => dialogFocusFirst(this.$refs.cellDialog));
      try {
        const geoBox = this.cellBbox;
        if (!geoBox) return;
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
      this.cellBbox = null;
      this.cellFiles = [];
      // Give focus back to the marker (or control) that opened the dialog.
      if (
        this.restoreFocusElement &&
        document.contains(this.restoreFocusElement)
      ) {
        this.restoreFocusElement.focus();
      }
      this.restoreFocusElement = null;
    },
    onDialogKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeCellDialog();
        return;
      }
      dialogTrapFocus(event, this.$refs.cellDialog);
    },
    focusGalleryItem(file) {
      if (!file) {
        this.unFocusGalleryItem();
        return;
      }
      this.slideshowMode = false;
      this.positionFocus = findIndex(this.cellFiles, { id: file.id });
      this.displayFullScreen = true;
    },
    clickedSlideshow() {
      this.positionFocus = 0;
      this.slideshowMode = true;
      this.displayFullScreen = true;
    },
    unFocusGalleryItem() {
      this.displayFullScreen = false;
      this.slideshowMode = false;
    },
  },
};
</script>

<style scoped>
.search-map-content {
  min-height: 0;
}
.search-map-info {
  min-height: 1.6em;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
}
.search-map-offline {
  opacity: 0.75;
}
/* Announce cell-count changes to screen readers without repeating the
 * visible <kbd> line. */
.search-map-live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.search-map-container {
  position: relative;
  /* Contain Leaflet's internal z-indexes (panes 400-700, controls 800) in
   * their own stacking context. Without it they escape the map and paint
   * above the cell/gallery dialogs (z-index 10-150). */
  isolation: isolate;
  width: 100%;
  height: calc(100vh - 14em);
  min-height: 24em;
}
.search-map {
  width: 100%;
  height: 100%;
  border-radius: var(--radius-md);
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
  background-color: var(--color-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  /* Above Leaflet's controls (800) even if the map's stacking context is
   * lost (e.g. a browser ignoring `isolation`). */
  z-index: 1000;
}
.dialog-article {
  width: min(90vw, 90em);
  max-height: 85vh;
  overflow: auto;
  padding: var(--space-base);
}
.search-map-cell-actions {
  margin-bottom: var(--space-sm);
}
.gallery-item-focus {
  background-color: black;
  position: fixed;
  top: 0;
  right: 0;
  width: 100vw;
  height: 100vh;
  z-index: 1100;
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

/* Visible keyboard focus for cell markers (SVG paths are focusable). */
.leaflet-container .leaflet-interactive:focus {
  outline: 3px solid #fff !important;
  outline-offset: 2px;
  filter: drop-shadow(0 0 2px #000);
}

/* Per-cell count tooltip: solid dark pill with AA-contrast white text. */
.search-map-cell-label {
  background: rgba(0, 0, 0, 0.85) !important;
  border: 0 !important;
  box-shadow: none !important;
  padding: 1px 6px !important;
  border-radius: 999px !important;
  color: #fff !important;
  font-weight: 700 !important;
  font-size: 12px !important;
  line-height: 1.4 !important;
  text-shadow: none !important;
  pointer-events: none !important;
}
.search-map-cell-label::before {
  display: none !important;
}
</style>
