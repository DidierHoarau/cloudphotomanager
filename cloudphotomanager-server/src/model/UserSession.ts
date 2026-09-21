export interface UserSession {
  isAuthenticated: boolean;
  userId?: string;
  permissions?: any;
}
