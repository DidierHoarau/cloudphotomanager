<template>
  <div class="page">
    <h1>New Account</h1>
    <label>Name</label>
    <input id="name" v-model="account.name" type="text" />
    <label>Root Folder</label>
    <input id="rootpath" v-model="account.rootpath" type="text" />
    <label>Type</label>
    <select id="accountType" v-model="account.info.type" required>
      <option value="" disabled>Select Type...</option>
      <option value="awsS3">AWS S3</option>
      <option value="oneDrive">One Drive</option>
      <option value="localDrive">Local Drive</option>
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
    <AccountLocalEdit
      v-if="account.info.type == 'localDrive'"
      @onInfoPrivateValid="infoPrivateValid"
      @onInfoPrivateInvalid="infoPrivateInvalid"
    />
    <button
      :disabled="!accountValidParameters"
      v-if="!loading"
      v-on:click="saveNew()"
    >
      Add
    </button>
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
      infoPrivateValidated: false,
      account: { rootpath: "/", info: { type: "" } },
    };
  },
  computed: {
    accountValidParameters() {
      return (
        !!this.account.name?.trim() &&
        !!this.account.info?.type &&
        this.infoPrivateValidated
      );
    },
  },
  watch: {
    "account.info.type"() {
      this.account.infoPrivate = undefined;
      this.infoPrivateValidated = false;
    },
  },
  async created() {},
  methods: {
    async infoPrivateValid(infoPrivate) {
      this.account.infoPrivate = infoPrivate;
      this.infoPrivateValidated = true;
    },
    async infoPrivateInvalid() {
      this.account.infoPrivate = undefined;
      this.infoPrivateValidated = false;
    },
    async saveNew() {
      this.loading = true;
      await axios
        .post(
          `${(await Config.get()).SERVER_URL}/accounts`,
          this.account,
          await AuthService.getAuthHeader(),
        )
        .then(async (res) => {
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "success",
            text: "Account Added",
          });
          useRouter().push({ path: "/settings/accounts" });
        })
        .catch(handleError);
      this.loading = false;
    },
  },
};
</script>
