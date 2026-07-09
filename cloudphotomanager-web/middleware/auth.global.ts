import { AuthService } from "~~/services/AuthService";

const publicRoutes = [
  "/",
  "/users/login",
  "/users/new",
  "/accounts/auth/onedrive",
  "/settings/accounts/auth/onedrive",
];

export default defineNuxtRouteMiddleware(async (to, _from) => {
  if (publicRoutes.includes(to.path)) {
    return;
  }

  const isAuthenticated = await AuthService.isAuthenticated();
  if (!isAuthenticated) {
    return navigateTo("/users/login");
  }
});
