<template>
  <div>
    <div class="menu-subcategory">
      <span v-if="authenticationStore.isAuthenticated">
        <NuxtLink to="/search" :class="isSearch ? 'active' : 'inactive'"
          >Search Photos</NuxtLink
        >
      </span>
      <span v-if="authenticationStore.isAuthenticated">
        <NuxtLink
          to="/search/duplicates"
          :class="isSearchDuplicates ? 'active' : 'inactive'"
          >Search Duplicates</NuxtLink
        >
      </span>
    </div>
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
  watch: {
    $route(to, from) {
      this.checkActiveFolder(to.fullPath);
    },
  },
  data() {
    return {
      isSearch: false,
      isSearchDuplicates: false,
      selectedAccount: "",
    };
  },
  async created() {
    this.checkActiveFolder(this.$route.fullPath);
    if (AccountsStore().accounts.length > 0) {
      setTimeout(() => {
        this.selectAccount(AccountsStore().accounts[0].id);
      }, 100);
    }
  },
  methods: {
    selectAccount(accountId) {
      this.selectedAccount = accountId;
      this.$emit("onAccountSelected", { id: accountId });
    },
    checkActiveFolder(currentPath) {
      if (currentPath.indexOf("search/duplicates") >= 0) {
        this.isSearchDuplicates = true;
      } else {
        this.isSearch = true;
      }
    },
  },
};
</script>

<style scoped>
.menu-subcategory {
  display: grid;
  grid-template-columns: 1fr 1fr;
  text-align: center;
  margin-bottom: 1em;
}
.menu-accounts {
  margin-bottom: 1em;
}
.menu-accounts span {
  margin-right: 1em;
}
.menu-subcategory a {
  text-decoration: none;
}
.inactive {
  opacity: 0.4;
}
</style>
