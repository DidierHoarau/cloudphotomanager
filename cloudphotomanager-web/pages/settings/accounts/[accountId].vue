<template>
  <div class="page">
    <h1>Account</h1>
    <label>Name</label>
    <input id="name" v-model="account.name" type="text" />
    <label>Root Folder</label>
    <input id="rootpath" v-model="account.rootpath" type="text" />
    <label>Type</label>
    <select id="accountType" v-model="account.info.type" required disabled>
      <option value="" disabled>Select Type...</option>
      <option value="awsS3">AWS S3</option>
      <option value="oneDrive">One Drive</option>
      <option value="localDrive">Local Drive</option>
    </select>
    <p
      v-if="account.info.type === 'awsS3' || account.info.type === 'oneDrive'"
      class="private-info-note"
    >
      Provider credentials are never returned by the server. Re-enter them
      before updating.
    </p>
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
      v-on:click="saveUpdate()"
    >
      Update
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
      account: { rootpath: "/", info: {} },
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
  async created() {
    await AuthenticationStore().ensureAuthenticated();
    if (!AuthenticationStore().isAdmin) {
      useRouter().push({ path: "/settings/profile" });
      return;
    }
    await axios
      .get(
        `${(await Config.get()).SERVER_URL}/accounts/${
          this.$route.params.accountId
        }`,
        await AuthService.getAuthHeader(),
      )
      .then((res) => {
        this.account = res.data;
      })
      .catch(handleError);
  },
  methods: {
    async infoPrivateValid(infoPrivate) {
      this.account.infoPrivate = infoPrivate;
      this.infoPrivateValidated = true;
    },
    async infoPrivateInvalid() {
      this.account.infoPrivate = undefined;
      this.infoPrivateValidated = false;
    },
    async saveUpdate() {
      this.loading = true;
      await axios
        .put(
          `${(await Config.get()).SERVER_URL}/accounts/${this.account.id}`,
          this.account,
          await AuthService.getAuthHeader(),
        )
        .then(async (res) => {
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "success",
            text: "Account Updated",
          });
          useRouter().push({ path: "/settings/accounts" });
        })
        .catch(handleError);
      this.loading = false;
    },
  },
};
</script>

<style scoped>
.private-info-note {
  color: var(--color-text-muted);
  font-size: var(--font-sm);
}
</style>
