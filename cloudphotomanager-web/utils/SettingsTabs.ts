import { AuthenticationStore } from "~~/stores/AuthenticationStore";

export interface SettingsTab {
  id: string;
  label: string;
  to: string;
  show?: () => boolean;
}

export function getSettingsTabs(): SettingsTab[] {
  const authenticationStore = AuthenticationStore();
  const adminOnly = () => authenticationStore.isAdmin;
  return [
    {
      id: "accounts",
      label: "Accounts",
      to: "/settings/accounts",
      show: adminOnly,
    },
    {
      id: "sync",
      label: "Sync Queue",
      to: "/settings/sync",
      show: adminOnly,
    },
    {
      id: "users",
      label: "Users",
      to: "/settings/users",
      show: adminOnly,
    },
    {
      id: "trash",
      label: "Trash",
      to: "/settings/trash",
      show: adminOnly,
    },
    {
      id: "profile",
      label: "Profile",
      to: "/settings/profile",
    },
  ];
}
