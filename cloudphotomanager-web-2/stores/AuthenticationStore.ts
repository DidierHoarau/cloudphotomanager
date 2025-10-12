import { AuthService } from "~~/services/AuthService";

export const AuthenticationStore = defineStore("AuthenticationStore", {
  state: () => ({
    isAuthenticated: false,
    isAdmin: false,
    userInfo: {},
  }),

  getters: {},

  actions: {
    async ensureAuthenticated(): Promise<boolean> {
      this.isAuthenticated = await AuthService.isAuthenticated();
      this.userInfo = (await AuthService.getTokenInfo()) as any;
      if (this.isAuthenticated && (this.userInfo as any).permissions && (this.userInfo as any).permissions.isAdmin) {
        this.isAdmin = true;
      } else {
        this.isAdmin = false;
      }
      return this.isAuthenticated;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(AuthenticationStore, import.meta.hot));
}
