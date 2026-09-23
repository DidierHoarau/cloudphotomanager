import { AuthService } from "~~/services/AuthService";

// Routes reachable without a session: the login page itself (redirect loop),
// the first-run admin creation page, and the OneDrive OAuth callbacks opened
// in a separate tab by Microsoft's redirect.
const PUBLIC_PATHS = [
  "/users/login",
  "/users/new",
  "/accounts/auth/onedrive",
  "/settings/accounts/auth/onedrive",
];

export default defineNuxtRouteMiddleware(async (to) => {
  if (PUBLIC_PATHS.includes(to.path)) return;
  if (!(await AuthService.isAuthenticated())) {
    return navigateTo("/users/login");
  }
});
