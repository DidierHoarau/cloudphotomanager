<template>
  <div class="media-thumb" @click="onClick">
    <div v-if="type === 'unknown'" class="media-thumb-placeholder">
      <i class="bi bi-question-circle"></i>
    </div>
    <template v-else>
      <img
        v-if="thumbnailUrl"
        class="media-thumb-img"
        :class="{ 'media-thumb-img-hidden': status !== 'ready' }"
        :src="thumbnailUrl"
        loading="lazy"
        decoding="async"
        alt="thumbnail"
        @load="onLoad"
        @error="onError"
      />
      <div
        v-if="status !== 'ready'"
        class="media-thumb-placeholder"
        :class="{
          'media-thumb-skeleton': status === 'loading',
          'media-thumb-missing': status === 'missing',
        }"
      >
        <template v-if="status === 'missing'">
          <i class="bi bi-cloud-arrow-down"></i>
          <span>Syncing</span>
        </template>
      </div>
      <i
        v-if="type === 'video' && status === 'ready'"
        class="bi bi-play-circle media-thumb-video-overlay"
      ></i>
    </template>
    <span v-if="duplicateCount > 1" class="gallery-duplicate-badge"
      >x{{ duplicateCount }}</span
    >
  </div>
</template>

<script>
import { FileUtils } from "~~/services/FileUtils";
import { MediaUrls } from "~~/services/MediaUrls";

export default {
  props: {
    file: {
      type: Object,
      required: true,
    },
    duplicateCount: {
      type: Number,
      required: false,
      default: 0,
    },
  },
  emits: ["click"],
  data() {
    return {
      thumbnailUrl: "",
      status: "loading", // loading | ready | missing | unknown
    };
  },
  computed: {
    type() {
      return FileUtils.getType(this.file);
    },
  },
  watch: {
    "file.id": {
      immediate: false,
      handler() {
        this.resolveUrl();
      },
    },
  },
  async created() {
    this.resolveUrl();
  },
  methods: {
    async resolveUrl() {
      if (this.type === "unknown") {
        this.status = "unknown";
        return;
      }
      this.status = "loading";
      this.thumbnailUrl = await MediaUrls.thumbnail(this.file);
    },
    onLoad() {
      this.status = "ready";
    },
    onError() {
      this.status = "missing";
    },
    onClick(event) {
      if (this.type === "unknown") return;
      this.$emit("click", event);
    },
  },
};
</script>

<style scoped>
.media-thumb {
  position: relative;
  width: 100%;
  height: 100%;
  display: block;
  cursor: pointer;
  overflow: hidden;
}
.media-thumb-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: opacity 0.2s ease;
}
.media-thumb-img-hidden {
  opacity: 0;
}
.media-thumb-placeholder {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.3em;
  background: rgba(128, 128, 128, 0.15);
}
.media-thumb-placeholder i {
  font-size: 2.5em;
  opacity: 0.4;
}
.media-thumb-placeholder span {
  font-size: 0.65em;
  opacity: 0.55;
  letter-spacing: 0.02em;
}
.media-thumb-missing {
  cursor: default;
}
.media-thumb-skeleton {
  background: linear-gradient(
    90deg,
    rgba(128, 128, 128, 0.08) 0%,
    rgba(128, 128, 128, 0.2) 50%,
    rgba(128, 128, 128, 0.08) 100%
  );
  background-size: 200% 100%;
  animation: media-thumb-pulse 1.4s ease-in-out infinite;
}
.media-thumb-skeleton i,
.media-thumb-skeleton span {
  display: none;
}
@keyframes media-thumb-pulse {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
.media-thumb-video-overlay {
  font-size: 3em;
  position: absolute;
  right: 0.1em;
  bottom: 0em;
  opacity: 0.5;
  pointer-events: none;
}
.gallery-duplicate-badge {
  position: absolute;
  top: 0.25em;
  right: 0.25em;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  padding: 0.1em 0.4em;
  border-radius: 0.3em;
  font-size: 0.7em;
  pointer-events: none;
}
</style>
