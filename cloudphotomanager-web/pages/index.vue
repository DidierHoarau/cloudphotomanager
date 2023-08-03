<template>
  <div class="page">
    <p>CloudPhotoManager: Manage your cloud album your own way.</p>
  </div>
</template>

<script>
import { AuthService } from "~~/services/AuthService";

export default {
  data() {
    return {};
  },
  async created() {
    if (await AuthService.isAuthenticated()) {
      useRouter().push({ path: "/gallery" });
    }
  },
};
</script>

<style scoped></style>
