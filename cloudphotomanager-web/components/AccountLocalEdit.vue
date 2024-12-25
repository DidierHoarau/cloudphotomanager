<template>
  <div></div>
</template>

<script>
export default {
  data() {
    return {
      infoPrivate: {},
    };
  },
  async created() {
    this.validateParamters();
  },
  methods: {
    validateParamters() {
      this.$emit("onInfoPrivateValid", this.infoPrivate);
    },
  },
};
</script>

<style scoped></style>
