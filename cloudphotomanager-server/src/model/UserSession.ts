export interface UserSession {
  isAuthenticated: boolean;
  userId?: string;
  userName?: string;
  permissions?: any;
  tokenVersion?: number;
  tokenExp?: number;
}
