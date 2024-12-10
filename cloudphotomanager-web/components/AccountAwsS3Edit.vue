<template>
  <div>
    <label>Bucket Name</label>
    <input id="bucketName" v-model="infoPrivate.bucket" v-on:change="validateParamters()" type="text" />
    <label>Bucket Region</label>
    <input id="region" v-model="infoPrivate.region" v-on:change="validateParamters()" type="text" />
    <label>IAM Access Key</label>
    <input id="accessKey" v-model="infoPrivate.accessKey" v-on:change="validateParamters()" type="text" />
    <label>IAM Secret Access Key</label>
    <input
      id="accessKeySecret"
      v-model="infoPrivate.accessKeySecret"
      v-on:change="validateParamters()"
      type="password"
    />
  </div>
</template>

<script>
export default {
  data() {
    return {
      infoPrivate: {
        bucket: "",
        region: "",
        accessKey: "",
        accessKeySecret: "",
      },
    };
  },
  methods: {
    validateParamters() {
      if (
        this.infoPrivate.bucket &&
        this.infoPrivate.region &&
        this.infoPrivate.accessKey &&
        this.infoPrivate.accessKeySecret
      ) {
        this.$emit("onInfoPrivateValid", this.infoPrivate);
      } else {
        this.$emit("onInfoPrivateInvalid", {});
      }
    },
  },
};
</script>

<style scoped></style>
