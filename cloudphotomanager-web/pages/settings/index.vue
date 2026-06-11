<template></template>

<script>
export default {
  async created() {
    useRouter().push({ path: "/settings/accounts" });
  },
};
</script>
