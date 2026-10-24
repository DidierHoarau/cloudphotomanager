import { AuthService } from "~~/services/AuthService";

// Routes reachable without a session: the login page itself (redirect loop),
// the first-run admin creation page, the OneDrive OAuth callbacks opened
// in a separate tab by Microsoft's redirect, and public share pages.
const PUBLIC_PATHS = [
  "/users/login",
  "/users/new",
  "/accounts/auth/onedrive",
  "/settings/accounts/auth/onedrive",
  "/share",
];

export default defineNuxtRouteMiddleware(async (to) => {
  if (PUBLIC_PATHS.includes(to.path)) return;
  const authenticationStore = AuthenticationStore();
  if (!(authenticationStore.userInfo as any)?.userId) {
    // First navigation: resolve the session so the client caches are scoped
    // to the current user before any store hydrates from IndexedDB.
    if (!(await authenticationStore.ensureAuthenticated())) {
      return navigateTo("/users/login");
    }
    return;
  }
  if (!(await AuthService.isAuthenticated())) {
    return navigateTo("/users/login");
  }
});
