import {
  createLoginCodeService,
  type LoginCodeService,
  type LoginCodeServiceOptions,
} from "@devopsplaybook.io/common-web/services/LoginCodeService";
import { AuthService } from "../services/AuthService";

export const LOGIN_CODES_BASE_URL = "/api/users/login-codes";

// Deliberately no `onSession`: an approved redemption sets the signed httpOnly
// session cookie on the server, so the web never stores or reads a token.
export function loginCodesServiceCreate(
  overrides: Omit<LoginCodeServiceOptions, "onSession"> = {},
): LoginCodeService {
  return createLoginCodeService({
    baseUrl: LOGIN_CODES_BASE_URL,
    // The cookie is the credential; the poll/approve requests are same-origin.
    getAuthHeader: () => AuthService.getAuthHeader(),
    ...overrides,
  });
}

// Probe used to hide the cards entirely when the feature is off or the table
// is missing (the routes answer 404 / unavailable, so nothing must render).
export async function loginCodesIsAvailable(
  service: LoginCodeService,
): Promise<boolean> {
  try {
    const capabilities = await service.capabilities();
    return capabilities.enabled === true && capabilities.available === true;
  } catch {
    return false;
  }
}
