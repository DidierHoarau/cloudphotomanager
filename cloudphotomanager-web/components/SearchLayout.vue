<template>
  <div class="search-layout page">
    <TabNavigation :tabs="searchTabs" />
    <NavigationSearch
      class="search-layout-navigation"
      :initialAccountId="initialAccountId"
      @onAccountSelected="onAccountSelected"
    />
    <slot />
  </div>
</template>

<script>
import { PreferencesMemories } from "~~/services/PreferencesMemories";

export default {
  props: {
    initialAccountId: {
      type: String,
      default: "",
    },
  },
  data() {
    return {
      searchTabs: [
        {
          id: "search",
          label: "Search",
          to: "/search",
        },
        {
          id: "memories",
          label: "Memories",
          to: "/search/memories",
          show: () => PreferencesMemories.isEnabled(),
        },
        {
          id: "map",
          label: "Map",
          to: "/search/map",
        },
        {
          id: "duplicates",
          label: "Duplicates",
          to: "/search/duplicates",
        },
        {
          id: "timeline",
          label: "Timeline",
          to: "/search/timeline",
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
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-sm);
}
</style>
