import axios from "axios";
import Config from "./Config";

// The session token lives in a signed httpOnly cookie set by the server
// (POST /api/users/session): JavaScript cannot read it, so an XSS cannot
// exfiltrate the session. Same-origin requests and the WebSocket handshake
// send the cookie automatically.
const LEGACY_AUTH_TOKEN_KEY = "auth_token";

export class AuthService {
  //
  public static async isAuthenticated(): Promise<boolean> {
    AuthService.cleanupLegacyToken();
    try {
      await axios.get(
        `${(await Config.get()).SERVER_URL}/users/access/validate`,
      );
      return true;
    } catch {
      return false;
    }
  }

  public static async getSessionInfo(): Promise<any> {
    try {
      const res = await axios.get(
        `${(await Config.get()).SERVER_URL}/users/session`,
      );
      return res.data;
    } catch {
      return null;
    }
  }

  // Session cookies are sent automatically on same-origin requests; kept as
  // a no-op so existing `...await AuthService.getAuthHeader()` call sites
  // keep working unchanged.
  public static async getAuthHeader(): Promise<any> {
    return {};
  }

  // Clears the server-side session cookie (an httpOnly cookie cannot be
  // removed by JavaScript).
  public static async logout(): Promise<void> {
    try {
      await axios.post(`${(await Config.get()).SERVER_URL}/users/logout`);
    } catch {
      // best effort: the caller still redirects to the login page
    }
  }

  // One-time cleanup of the token stored by versions before the cookie
  // migration; nothing reads it anymore.
  private static cleanupLegacyToken(): void {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY);
      }
    } catch {
      // ignore
    }
  }
}
