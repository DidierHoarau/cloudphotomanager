export interface UserSession {
  isAuthenticated: boolean;
  userId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  permissions?: any;
}
