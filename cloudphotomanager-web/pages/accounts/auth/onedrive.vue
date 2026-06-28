<template></template>

<script>
export default {
  async created() {
    useRouter().replace({
      path: "/settings/accounts/auth/onedrive",
      query: this.$route.query,
    });
  },
};
</script>
