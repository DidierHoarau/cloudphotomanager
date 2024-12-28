<template>
  <div>
    <span class="sync-count" v-if="syncStore.countTotal > 0">
      <kbd>Sync:&nbsp;{{ syncStore.countTotal }}</kbd>
    </span>
  </div>
</template>

<script setup>
import { AuthService } from "~~/services/AuthService";
const authenticationStore = AuthenticationStore();
const syncStore = SyncStore();
</script>

<script>
export default {
  data() {
    return {
      baseFolder: "",
    };
  },
  async created() {},
};
</script>

<style scoped>
.sync-count kbd {
  font-size: 50%;
  text-align: center;
  padding: 0.3em 0.6em;
  opacity: 0.3;
}
</style>
