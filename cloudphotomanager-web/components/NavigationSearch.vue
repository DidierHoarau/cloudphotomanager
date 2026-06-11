<template>
  <div>
    <div v-if="accountsStore.accounts.length > 1" class="menu-accounts">
      <fieldset>
        <span v-for="account in accountsStore.accounts" v-bind:key="account.id">
          <input
            type="radio"
            :id="account.id"
            name="second-language"
            v-on:click="selectAccount(account.id)"
            :checked="selectedAccount === account.id"
          />
          <label :htmlFor="account.id">{{ account.name }}</label>
        </span>
      </fieldset>
    </div>
  </div>
</template>

<script setup>
const authenticationStore = AuthenticationStore();
const accountsStore = AccountsStore();
</script>

<script>
export default {
  data() {
    return {
      selectedAccount: "",
    };
  },
  async created() {
    await AccountsStore().fetch();
    if (AccountsStore().accounts.length > 0) {
      this.selectAccount(AccountsStore().accounts[0].id);
    }
  },
  methods: {
    selectAccount(accountId) {
      this.selectedAccount = accountId;
      this.$emit("onAccountSelected", { id: accountId });
    },
  },
};
</script>

<style scoped>
.menu-accounts {
  margin-bottom: var(--space-base);
}
.menu-accounts span {
  margin-right: var(--space-base);
}
.menu-subcategory a {
  text-decoration: none;
}
.inactive {
  opacity: 0.4;
}
</style>
