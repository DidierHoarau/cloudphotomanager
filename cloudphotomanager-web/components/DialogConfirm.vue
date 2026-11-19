<template>
  <dialog open @keydown="onKeydown">
    <article ref="confirmArticle" tabindex="-1">
      <header>
        <a
          href="#close"
          aria-label="Close"
          class="close"
          v-on:click="clickedCancel()"
        ></a>
        {{ title }}
      </header>
      <p class="confirm-message">{{ message }}</p>
      <footer>
        <button class="secondary outline" v-on:click="clickedCancel()">
          Cancel
        </button>
        <button v-on:click="clickedConfirm()">Confirm</button>
      </footer>
    </article>
  </dialog>
</template>

<script>
import { dialogFocusFirst, dialogTrapFocus } from "~~/utils/DialogFocus";

export default {
  props: {
    title: {
      type: String,
      default: "Confirm",
    },
    message: {
      type: String,
      required: true,
    },
  },
  data() {
    return {
      restoreFocusElement: null,
    };
  },
  mounted() {
    if (typeof document !== "undefined") {
      this.restoreFocusElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    this.$nextTick(() => dialogFocusFirst(this.$refs.confirmArticle));
  },
  beforeUnmount() {
    if (
      this.restoreFocusElement &&
      document.contains(this.restoreFocusElement)
    ) {
      this.restoreFocusElement.focus();
    }
  },
  methods: {
    onKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        this.clickedCancel();
        return;
      }
      dialogTrapFocus(event, this.$refs.confirmArticle);
    },
    clickedCancel() {
      this.$emit("onCancel");
    },
    clickedConfirm() {
      this.$emit("onConfirm");
    },
  },
};
</script>

<style scoped>
.confirm-message {
  white-space: pre-line;
  margin: var(--space-base) 0;
}
footer {
  display: flex;
  gap: var(--space-sm);
  justify-content: flex-end;
  margin-top: var(--space-base);
}
</style>
