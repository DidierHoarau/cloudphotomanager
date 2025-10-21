<template>
  <div id="media-container">
    <img
      class="media-content"
      v-if="file && getType(file) == 'image'"
      :src="getImageSource(file)"
    />
    <video
      class="media-content"
      v-if="file && videoDelayedLoadingDone && getType(file) == 'video'"
      controls
    >
      <source :src="getVideoSource(file)" type="video/mp4" />
    </video>
  </div>
</template>

<script>
import Config from "~~/services/Config.ts";
import { FileUtils } from "~~/services/FileUtils";

export default {
  props: {
    file: {},
  },
  data() {
    return {
      serverUrl: "",
      staticUrl: "",
      videoDelayedLoadingDone: false,
    };
  },
  async created() {
    this.serverUrl = (await Config.get()).SERVER_URL;
    this.staticUrl = (await Config.get()).STATIC_URL;
    const mediaContainer = document.querySelector("#media-container");
  },
  methods: {
    getType(file) {
      return FileUtils.getType(file);
    },
    getImageSource(file) {
      return (
        this.staticUrl +
        "/" +
        file.accountId +
        "/" +
        file.id[0] +
        "/" +
        file.id[1] +
        "/" +
        file.id +
        "/preview.webp"
      );
    },
    getVideoSource(file) {
      return (
        this.staticUrl +
        "/" +
        file.accountId +
        "/" +
        file.id[0] +
        "/" +
        file.id[1] +
        "/" +
        file.id +
        "/preview.mp4"
      );
    },
  },
};
</script>

<style scoped>
#media-container {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  grid-template-rows: 1fr auto 1fr;
  width: 100%;
}
#media-container img {
  grid-column: 2;
  grid-row: 2;
  max-width: 100%;
  width: auto;
  height: auto;
  display: flex;
}
#media-container video {
  grid-column: 2;
  grid-row: 2;
  max-width: 100vw;
  max-height: 100vh;
  width: auto;
  height: auto;
}
</style>
