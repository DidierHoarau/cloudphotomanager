<template>
  <div>
    <label
      >Sign in to OneDrive:
      <a
        :href="
          'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=' +
          ONEDRIVE_CLIENT_ID +
          '&scope=files.readwrite%20offline_access&response_type=code&redirect_uri=' +
          ONEDRIVE_CALLBACK_SIGNIN
        "
        target="_blank"
        >Sign In To OneDrive&nbsp;&nbsp;<i class="bi bi-box-arrow-up-right"></i
      ></a>
    </label>
  </div>
</template>

<script>
import axios from "axios";
import Config from "~~/services/Config.ts";
import { Timeout } from "~~/services/Timeout.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

export default {
  data() {
    return {
      infoPrivate: {
        authCode: "",
        region: "",
        accessKey: "",
        accessKeySecret: "",
      },
      ONEDRIVE_CLIENT_ID: "",
      ONEDRIVE_CALLBACK_SIGNIN: "",
    };
  },
  async created() {
    this.checkCodeReceived();
    await axios
      .get(`${(await Config.get()).SERVER_URL}/accounts/onedrive/info`, await AuthService.getAuthHeader())
      .then(async (res) => {
        this.ONEDRIVE_CLIENT_ID = res.data.ONEDRIVE_CLIENT_ID;
        this.ONEDRIVE_CALLBACK_SIGNIN = res.data.ONEDRIVE_CALLBACK_SIGNIN;
      })
      .catch(handleError);
  },
  methods: {
    async checkCodeReceived() {
      try {
        const codeRecived = JSON.parse(localStorage.getItem("TMP_AUTH_ONEDRIVE_KEY", "{}"));
        if (codeRecived && new Date().getTime() - new Date(codeRecived.date).getTime() < 60 * 30 * 1000) {
          this.infoPrivate.authCode = codeRecived.code;
          this.$emit("onInfoPrivateValid", this.infoPrivate);
        } else {
          this.$emit("onInfoPrivateInvalid", {});
        }
      } catch (err) {
        console.error(err);
        this.$emit("onInfoPrivateInvalid", {});
      }
      await Timeout.wait(1000);
      this.checkCodeReceived();
    },
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
