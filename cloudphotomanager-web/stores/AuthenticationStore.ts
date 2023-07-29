import { AuthService } from "~~/services/AuthService";

export const AuthenticationStore = defineStore("AuthenticationStore", {
  state: () => ({
    isAuthenticated: false,
    userInfo: {},
  }),

  getters: {},

  actions: {
    async ensureAuthenticated(): Promise<boolean> {
      this.isAuthenticated = await AuthService.isAuthenticated();
      this.userInfo = (await AuthService.getTokenInfo()) as any;
      return this.isAuthenticated;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(AuthenticationStore, import.meta.hot));
}
