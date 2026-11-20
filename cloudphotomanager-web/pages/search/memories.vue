<template>
  <SearchLayout @onAccountSelected="onAccountSelected">
    <div class="memories-layout">
      <div v-if="!memoriesEnabled" class="memories-notice" role="status">
        <p>
          Memories are turned off.
          <NuxtLink to="/settings/profile">Enable them in Settings</NuxtLink>
          to rediscover photos from this day and past years.
        </p>
      </div>
      <template v-else>
        <div class="memories-header">
          <h1 class="memories-title">Memories</h1>
          <button
            type="button"
            class="secondary outline"
            :disabled="playableFiles.length === 0"
            aria-label="Play slideshow of all memories"
            @click="startSlideshow()"
          >
            <i class="bi bi-play-fill"></i> Slideshow
          </button>
          <small v-if="loadedDate" class="memories-date">
            {{ formatMemoryDate(loadedDate) }}
          </small>
        </div>

        <p v-if="!isOnline" class="memories-offline" role="status">
          <i class="bi bi-wifi-off"></i> You are offline — memories need a
          connection; cached thumbnails may still be visible.
        </p>
        <p v-if="error" class="memories-error" role="alert">
          {{ error }}
          <button type="button" class="secondary outline" @click="fetchMemories()">
            Retry
          </button>
        </p>

        <Loading v-if="loading" />
        <template v-else>
          <div v-if="hasLoaded && renderedSections.length === 0" class="memories-empty">
            <i class="bi bi-calendar-heart"></i>
            <p>No memories for this day yet.</p>
            <p class="memories-empty-detail">
              Photos taken on this day, in the past 7 days or in previous
              years this month will appear here.
            </p>
          </div>
          <section
            v-for="section in renderedSections"
            :key="section.key"
            class="memories-section"
          >
            <div class="memories-section-header">
              <h2>{{ section.title }}</h2>
              <button
                type="button"
                class="secondary outline memories-section-slideshow"
                :aria-label="`Play slideshow: ${section.title}`"
                @click="startSectionSlideshow(section.files)"
              >
                <i class="bi bi-play-fill"></i> Slideshow
              </button>
            </div>
            <Gallery
              :files="section.files"
              :enableSelection="false"
              @focusGalleryItem="(file) => focusSection(file, section)"
            />
          </section>
        </template>
      </template>

      <GalleryItemFocus
        v-if="displayFullScreen"
        :galleryFiles="viewerFiles"
        :initialPosition="positionFocus"
        :selectedFiles="[]"
        :slideshow="slideshowMode"
        class="gallery-item-focus"
        @onFileClosed="closeViewer"
      />
    </div>
  </SearchLayout>
</template>

<script setup>
const { isOnline } = useNetworkStatus();
</script>

<script>
import axios from "axios";
import { findIndex } from "lodash";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError } from "~~/services/EventBus";
import { PreferencesMemories } from "~~/services/PreferencesMemories";
import { slideshowSourceFiles } from "~~/utils/Slideshow";

const SECTION_TITLES = {
  onThisDay: "On this day",
  pastWeek: "The past 7 days",
  monthHighlights: "Highlights from this month in past years",
};

export default {
  data() {
    return {
      serverUrl: "",
      currentAccountId: "",
      memoriesEnabled: true,
      loading: false,
      hasLoaded: false,
      error: "",
      sections: [],
      loadedDate: "",
      requestEtag: "",
      displayFullScreen: false,
      positionFocus: 0,
      viewerFiles: [],
      slideshowMode: false,
    };
  },
  computed: {
    renderedSections() {
      return (this.sections || [])
        .filter((section) => section && (section.files || []).length > 0)
        .map((section) => ({
          ...section,
          title: SECTION_TITLES[section.key] || section.key,
        }));
    },
    playableFiles() {
      return slideshowSourceFiles(
        (this.sections || []).flatMap((section) => section.files || []),
        [],
      );
    },
  },
  async created() {
    this.memoriesEnabled = PreferencesMemories.isEnabled();
    this.serverUrl = (await Config.get()).SERVER_URL;
    // The account selection event may fire before the config resolves.
    if (this.currentAccountId && this.memoriesEnabled && !this.hasLoaded) {
      this.fetchMemories();
    }
  },
  methods: {
    async onAccountSelected(account) {
      if (!account || !account.id) {
        return;
      }
      this.currentAccountId = account.id;
      if (!this.memoriesEnabled) {
        return;
      }
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        // Keep already-loaded sections; the offline note explains the state.
        return;
      }
      await this.fetchMemories();
    },
    async fetchMemories() {
      if (!this.currentAccountId || !this.serverUrl) {
        return;
      }
      const requestEtag = `${this.currentAccountId}-${Date.now()}`;
      this.requestEtag = requestEtag;
      this.loading = true;
      this.error = "";
      try {
        const res = await axios.get(
          `${this.serverUrl}/accounts/${this.currentAccountId}/memories`,
          await AuthService.getAuthHeader(),
        );
        if (this.requestEtag !== requestEtag) {
          return;
        }
        this.sections = res.data.sections || [];
        this.loadedDate = res.data.date || "";
        this.hasLoaded = true;
      } catch (err) {
        if (this.requestEtag !== requestEtag) {
          return;
        }
        this.error = "Memories could not be loaded.";
        handleError(err);
      } finally {
        if (this.requestEtag === requestEtag) {
          this.loading = false;
        }
      }
    },
    formatMemoryDate(value) {
      const [year, month, day] = String(value).split("-").map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (Number.isNaN(date.getTime())) {
        return value;
      }
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      });
    },
    focusSection(file, section) {
      if (!file) {
        return;
      }
      this.viewerFiles = section.files;
      this.positionFocus = Math.max(
        0,
        findIndex(section.files, { id: file.id }),
      );
      this.slideshowMode = false;
      this.displayFullScreen = true;
    },
    startSectionSlideshow(files) {
      const source = slideshowSourceFiles(files, []);
      if (source.length === 0) {
        return;
      }
      this.viewerFiles = source;
      this.positionFocus = 0;
      this.slideshowMode = true;
      this.displayFullScreen = true;
    },
    startSlideshow() {
      this.startSectionSlideshow(this.playableFiles);
    },
    closeViewer() {
      this.displayFullScreen = false;
      this.slideshowMode = false;
      this.viewerFiles = [];
      this.positionFocus = 0;
    },
  },
};
</script>

<style scoped>
.memories-layout {
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
  min-height: 0;
}
.memories-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-md);
}
.memories-title {
  margin: 0;
  font-size: var(--font-xl);
}
.memories-date {
  color: var(--color-text-muted);
}
.memories-notice,
.memories-offline,
.memories-error,
.memories-empty {
  padding: var(--space-base);
  border-radius: var(--radius-md);
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
}
.memories-offline {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.memories-error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  color: var(--color-error);
  background: var(--color-error-bg);
  border: 1px solid var(--color-error-border);
}
.memories-empty {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
}
.memories-empty i {
  font-size: 2em;
  color: var(--color-primary);
}
.memories-empty-detail {
  margin: 0;
  font-size: var(--font-base);
  color: var(--color-text-muted);
}
.memories-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.memories-section-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}
.memories-section-header h2 {
  margin: 0;
  font-size: var(--font-lg);
}
</style>
