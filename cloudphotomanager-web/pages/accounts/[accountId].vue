<template>
  <div class="page">
    <h1>Account</h1>
    <label>Name</label>
    <input id="name" v-model="account.name" v-on:change="validateParameters()" type="text" />
    <label>Root Folder</label>
    <input id="rootpath" v-model="account.rootpath" v-on:change="validateParameters()" type="text" />
    <label>Type</label>
    <select id="accountType" v-model="account.info.type" required>
      <option value="select" selected>Select Type...</option>
      <option value="awsS3" selected>AWS S3</option>
      <option value="oneDrive" selected>One Drive</option>
    </select>
    <AccountAwsS3Edit
      v-if="account.info.type == 'awsS3'"
      @onInfoPrivateValid="infoPrivateValid"
      @onInfoPrivateInvalid="infoPrivateInvalid"
    />
    <AccountOneDriveEdit
      v-if="account.info.type == 'oneDrive'"
      @onInfoPrivateValid="infoPrivateValid"
      @onInfoPrivateInvalid="infoPrivateInvalid"
    />
    <button :disabled="!accountValidParameters" v-if="!loading" v-on:click="saveUpdate()">Update</button>
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
      accountValidParameters: false,
      account: { rootpath: "/", info: {} },
    };
  },
  async created() {
    await axios
      .get(
        `${(await Config.get()).SERVER_URL}/accounts/${this.$route.params.accountId}`,
        await AuthService.getAuthHeader()
      )
      .then((res) => {
        this.account = res.data;
      })
      .catch(handleError);
  },
  methods: {
    async infoPrivateValid(infoPrivate) {
      this.accountValidParameters = true;
      this.account.infoPrivate = infoPrivate;
    },
    async infoPrivateInvalid() {
      this.accountValidParameters = false;
    },
    validateParameters() {
      if (!this.account.name) {
        this.accountValidParameters = false;
      }
    },
    async saveUpdate() {
      this.loading = true;
      await axios
        .put(
          `${(await Config.get()).SERVER_URL}/accounts/${this.account.id}`,
          this.account,
          await AuthService.getAuthHeader()
        )
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
  },
};
</script>
