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
      this.userInfo = {};
      if (this.isAuthenticated) {
        const sessionInfo = await AuthService.getSessionInfo();
        if (sessionInfo) {
          this.userInfo = sessionInfo;
        }
      }
      this.isAdmin = !!(this.userInfo as any)?.permissions?.isAdmin;
      return this.isAuthenticated;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(AuthenticationStore, import.meta.hot));
}
