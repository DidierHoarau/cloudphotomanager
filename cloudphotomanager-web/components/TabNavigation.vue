<template>
  <div class="tab-navigation">
    <NuxtLink
      v-for="tab in visibleTabs"
      :key="tab.id"
      :to="tab.to"
      :class="['tab', { active: isActive(tab) }]"
    >
      {{ tab.label }}
    </NuxtLink>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";

const props = defineProps({
  tabs: {
    type: Array,
    required: true,
  },
});

const route = useRoute();

const visibleTabs = computed(() => {
  if (!props.tabs) return [];
  return props.tabs.filter((tab) => {
    if (typeof tab.show === "function") return tab.show();
    return tab.show !== false;
  });
});

function isActive(tab) {
  if (route.path === tab.to) return true;
  // Prefix match for parent routes (e.g. /settings/accounts matches
  // /settings/accounts/new) — but only if no OTHER tab has a longer path
  // that also matches (avoids /search highlighting when on /search/map).
  if (route.path.startsWith(tab.to + "/")) {
    return !props.tabs.some((other) => {
      if (other.id === tab.id) return false;
      if (other.to.length <= tab.to.length) return false;
      return route.path === other.to || route.path.startsWith(other.to + "/");
    });
  }
  return false;
}
</script>

<style scoped>
.tab-navigation {
  overflow-y: hidden;
}
</style>
