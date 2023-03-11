<template>
  <div class="page">
    <h1>New Account</h1>
    <label>Name</label>
    <input id="name" v-model="account.name" v-on:change="validateParamters()" type="text" />
    <label>Type</label>
    <select id="accountType" v-model="account.info.type" required>
      <option value="select" selected>Select Type...</option>
      <option value="awsS3" selected>AWS S3</option>
    </select>
    <AccountAwsS3Edit
      v-if="account.info.type == 'awsS3'"
      @onInfoPrivateValid="infoPrivateValid"
      @onInfoPrivateInvalid="infoPrivateInvalid"
    />
    <button :disabled="!account.name || !accountValidParameters" v-if="!loading" v-on:click="validateAccount()">
      Validate
    </button>
    <button :disabled="!accountValid" v-if="!loading" v-on:click="saveNew()">Add</button>
    <Loading v-if="loading" />
  </div>
</template>

<script>
import axios from "axios";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

export default {
  data() {
    return {
      loading: false,
      accountValid: false,
      accountValidParameters: true,
      account: { info: {} },
    };
  },
  async created() {},
  methods: {
    async infoPrivateValid(infoPrivate) {
      this.accountValidParameters = true;
      this.account.infoPrivate = infoPrivate;
    },
    async infoPrivateInvalid() {
      this.accountValidParameters = false;
    },
    validateParamters() {
      if (!this.account.name) {
        this.accountValidParameters = false;
      }
    },
    async saveNew() {
      this.loading = true;
      await axios
        .post(`${(await Config.get()).SERVER_URL}/accounts`, this.account, await AuthService.getAuthHeader())
        .then(async (res) => {
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "success",
            text: "Account Added",
          });
          useRouter().push({ path: "/accounts" });
        })
        .catch(handleError);
      this.loading = false;
    },
    async validateAccount() {
      this.loading = true;
      this.accountValid = false;
      await axios
        .post(`${(await Config.get()).SERVER_URL}/accounts/validation`, this.account, await AuthService.getAuthHeader())
        .then(async (res) => {
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "success",
            text: "Account Validation Successful",
          });
          this.accountValid = true;
        })
        .catch(handleError);
      this.loading = false;
    },
  },
};
</script>
