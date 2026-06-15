<template>
  <div class="search-layout page">
    <TabNavigation :tabs="searchTabs" />
    <NavigationSearch
      class="search-layout-navigation"
      @onAccountSelected="onAccountSelected"
    />
    <slot />
  </div>
</template>

<script>
export default {
  data() {
    return {
      searchTabs: [
        {
          id: "search",
          label: "Search",
          to: "/search",
        },
        {
          id: "duplicates",
          label: "Duplicates",
          to: "/search/duplicates",
        },
      ],
    };
  },
  methods: {
    onAccountSelected(event) {
      this.$emit("onAccountSelected", event);
    },
  },
};
</script>

<style scoped>
.search-layout {
  display: grid;
  grid-template-rows: auto auto 1fr;
  grid-template-columns: 1fr;
  gap: var(--space-sm);
}
</style>
