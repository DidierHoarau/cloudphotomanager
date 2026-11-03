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
      pollActive: true,
      lastEmittedCode: null,
      invalidEmitted: false,
    };
  },
  async created() {
    this.pollCodeReceived();
    await axios
      .get(`${(await Config.get()).SERVER_URL}/accounts/onedrive/info`, await AuthService.getAuthHeader())
      .then(async (res) => {
        this.ONEDRIVE_CLIENT_ID = res.data.ONEDRIVE_CLIENT_ID;
        this.ONEDRIVE_CALLBACK_SIGNIN = res.data.ONEDRIVE_CALLBACK_SIGNIN;
      })
      .catch(handleError);
  },
  beforeUnmount() {
    this.pollActive = false;
  },
  methods: {
    async pollCodeReceived() {
      while (this.pollActive) {
        this.checkCodeReceived();
        if (!this.pollActive) {
          break;
        }
        await Timeout.wait(1000);
      }
    },
    checkCodeReceived() {
      if (!this.pollActive) {
        return;
      }
      let code = null;
      try {
        const raw = localStorage.getItem("TMP_AUTH_ONEDRIVE_KEY");
        if (raw) {
          const received = JSON.parse(raw);
          if (
            received?.code &&
            Date.now() - new Date(received.date).getTime() < 30 * 60 * 1000
          ) {
            code = received.code;
          } else {
            localStorage.removeItem("TMP_AUTH_ONEDRIVE_KEY");
          }
        }
      } catch (err) {
        console.error(err);
        localStorage.removeItem("TMP_AUTH_ONEDRIVE_KEY");
      }
      if (code) {
        if (code !== this.lastEmittedCode) {
          this.lastEmittedCode = code;
          this.infoPrivate.authCode = code;
          // Microsoft auth codes are single use: consume the stored one so a
          // remount cannot re-emit a code that was already exchanged.
          localStorage.removeItem("TMP_AUTH_ONEDRIVE_KEY");
          this.$emit("onInfoPrivateValid", this.infoPrivate);
          this.pollActive = false;
        }
      } else if (!this.invalidEmitted) {
        this.invalidEmitted = true;
        this.$emit("onInfoPrivateInvalid", {});
      }
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
