<template>
  <div class="alert-stack">
    <transition-group name="alert-fade">
      <div
        v-for="slot in activeSlots"
        :key="slot.type"
        :class="'alert-message alert-' + slot.type"
      >
        {{ slot.text }}
      </div>
    </transition-group>
  </div>
</template>

<script>
import { EventBus, EventTypes } from "../services/EventBus";

export default {
  name: "AlertMessages",
  data() {
    return {
      // One slot per type: { text, type, timerId }
      slots: {},
    };
  },
  computed: {
    activeSlots() {
      return Object.values(this.slots);
    },
  },
  async created() {
    EventBus.on(EventTypes.ALERT_MESSAGE, (message) => {
      const type = message.type || "default";
      // Clear existing timer for this type
      if (this.slots[type]?.timerId) {
        clearTimeout(this.slots[type].timerId);
      }
      // Replace slot content
      const timerId = setTimeout(() => {
        const updated = { ...this.slots };
        delete updated[type];
        this.slots = updated;
      }, 5000);
      this.slots = {
        ...this.slots,
        [type]: { type, text: message.text, timerId },
      };
    });
  },
};
</script>

<style scoped>
.alert-stack {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.alert-message {
  padding: 0.4rem 0.75rem;
  border-radius: 4px;
  font-size: 0.8rem;
  color: #eee;
  background-color: rgba(84, 110, 122, 0.75);
  backdrop-filter: blur(4px);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}

.alert-info {
  background-color: rgba(67, 160, 71, 0.75);
}

.alert-error {
  background-color: rgba(229, 57, 53, 0.75);
}

/* Transition */
.alert-fade-enter-active,
.alert-fade-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}
.alert-fade-enter-from,
.alert-fade-leave-to {
  opacity: 0;
  transform: translateX(1rem);
}
</style>
