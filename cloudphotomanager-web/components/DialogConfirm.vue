<template>
  <dialog open>
    <article>
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
  methods: {
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
  margin: 1em 0;
}
footer {
  display: flex;
  gap: 0.5em;
  justify-content: flex-end;
  margin-top: 1em;
}
</style>
