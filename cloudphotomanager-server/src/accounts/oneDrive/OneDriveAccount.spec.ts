import { Span } from "@opentelemetry/sdk-trace";
import axios from "axios";
import { AccountDefinition } from "../../model/AccountDefinition";
import { AccountDataUpdateTokens } from "../AccountData";
import { OneDriveAccount } from "./OneDriveAccount";

jest.mock("axios", () => {
  const actual = jest.requireActual("axios");
  const axiosMock: any = Object.assign(jest.fn(), {
    isAxiosError: actual.isAxiosError,
    post: jest.fn(),
  });
  return { __esModule: true, default: axiosMock };
});

jest.mock("../AccountData", () => ({
  AccountDataUpdateTokens: jest.fn(),
}));

jest.mock("../../OTelContext", () => ({
  OTelLogger: () => ({
    createModuleLogger: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  }),
  OTelTracer: () => ({
    startSpan: () => mockSpan,
  }),
}));

const mockSpan = { end: jest.fn() } as unknown as Span;
const mockedAxiosPost = axios.post as unknown as jest.Mock;
const mockedPersist = AccountDataUpdateTokens as unknown as jest.Mock;

function accountDefinition(refreshToken = "old-refresh-token"): AccountDefinition {
  const definition = new AccountDefinition();
  definition.id = "account-1";
  definition.name = "OneDrive";
  definition.info = { type: "oneDrive" };
  definition.infoPrivate = { refreshToken };
  return definition;
}

function tokenResponse(overrides: Record<string, any> = {}): any {
  return {
    data: {
      access_token: "new-access-token",
      refresh_token: "rotated-refresh-token",
      expires_in: "3600",
      ...overrides,
    },
  };
}

describe("OneDriveAccount token refresh", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedPersist.mockResolvedValue(undefined);
  });

  it("persists the rotated refresh token returned by Microsoft", async () => {
    const definition = accountDefinition();
    const account = new OneDriveAccount(definition);
    mockedAxiosPost.mockResolvedValue(tokenResponse());

    const token = await account.getToken(mockSpan);

    expect(token).toBe("new-access-token");
    expect(definition.infoPrivate.refreshToken).toBe("rotated-refresh-token");
    expect(mockedPersist).toHaveBeenCalledWith(
      mockSpan,
      "account-1",
      definition.infoPrivate,
    );
  });

  it("sends the stored refresh token to the token endpoint", async () => {
    const account = new OneDriveAccount(accountDefinition("stored-token"));
    mockedAxiosPost.mockResolvedValue(tokenResponse());

    await account.getToken(mockSpan);

    const body = mockedAxiosPost.mock.calls[0][1] as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("stored-token");
  });

  it("reuses the access token while it is valid", async () => {
    const account = new OneDriveAccount(accountDefinition());
    mockedAxiosPost.mockResolvedValue(tokenResponse());

    await account.getToken(mockSpan);
    await account.getToken(mockSpan);

    expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
  });

  it("shares one refresh between concurrent callers", async () => {
    const account = new OneDriveAccount(accountDefinition());
    let resolvePost: (value: any) => void = () => {};
    mockedAxiosPost.mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve;
      }),
    );

    const first = account.getToken(mockSpan);
    const second = account.getToken(mockSpan);
    resolvePost(tokenResponse());

    await expect(Promise.all([first, second])).resolves.toEqual([
      "new-access-token",
      "new-access-token",
    ]);
    expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
  });

  it("keeps working when persisting the token fails", async () => {
    const account = new OneDriveAccount(accountDefinition());
    mockedAxiosPost.mockResolvedValue(tokenResponse());
    mockedPersist.mockRejectedValue(new Error("database is locked"));

    await expect(account.getToken(mockSpan)).resolves.toBe("new-access-token");
  });

  it("reports an actionable error when Microsoft rejects the refresh token", async () => {
    const account = new OneDriveAccount(accountDefinition());
    mockedAxiosPost.mockRejectedValue(
      Object.assign(new Error("Request failed with status code 400"), {
        isAxiosError: true,
        response: {
          status: 400,
          data: {
            error: "invalid_grant",
            error_description: "AADSTS70000: The refresh token is not valid",
          },
        },
      }),
    );

    await expect(account.getToken(mockSpan)).rejects.toThrow(
      /OneDrive authorization failed.*reconnect the account.*invalid_grant/,
    );
  });

  it("fails clearly when the account has no refresh token", async () => {
    const definition = accountDefinition("");
    const account = new OneDriveAccount(definition);

    await expect(account.getToken(mockSpan)).rejects.toThrow(
      /missing refresh token/,
    );
    expect(mockedAxiosPost).not.toHaveBeenCalled();
  });
});
