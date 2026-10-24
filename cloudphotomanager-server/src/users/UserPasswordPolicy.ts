// Minimal password policy for new and changed passwords. Login is deliberately
// not validated so existing installs with short passwords keep working until
// the user changes theirs.
export const USER_PASSWORD_MIN_LENGTH = 8;
export const USER_PASSWORD_MAX_LENGTH = 128;

export function UserPasswordValidate(password: string): string | null {
  if (typeof password !== "string" || password.length === 0) {
    return "Missing: Password";
  }
  if (password.length < USER_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${USER_PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > USER_PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${USER_PASSWORD_MAX_LENGTH} characters`;
  }
  return null;
}
