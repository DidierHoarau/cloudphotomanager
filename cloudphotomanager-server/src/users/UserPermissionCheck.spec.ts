import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardLogger, StandardTracer } from "@devopsplaybook.io/otel-utils";
import {
  SqlDbUtilsInit,
  SqlDbUtilsSetOTel,
} from "@devopsplaybook.io/common-utils";
import { OTelSetTracer, OTelTracer } from "../OTelContext";
import { Folder } from "../model/Folder";
import { UserPermission } from "../model/UserPermission";

describe("UserPermissionCheck", () => {
  let span: Span;
  let dataDir: string;
  const sqlDir = path.resolve(__dirname, "../../sql");

  let userPermissionCheck: typeof import("./UserPermissionCheck");
  let userPermissionData: typeof import("./UserPermissionData");
  let folderData: typeof import("../folders/FolderData");

  const accountA = "account-a";
  const accountB = "account-b";
  const folders: Record<string, Folder> = {};

  function folderRef(folder: Folder) {
    return {
      id: folder.id,
      accountId: folder.accountId,
      folderpath: folder.folderpath,
    };
  }

  async function createFolder(
    accountId: string,
    folderpath: string,
  ): Promise<Folder> {
    const folder = new Folder(accountId, folderpath);
    folder.idCloud = `/cloud${folderpath}`;
    folder.dateSync = new Date();
    folder.dateUpdated = new Date();
    await folderData.FolderDataAdd(span, folder);
    return folder;
  }

  async function setUserFolders(
    userId: string,
    folderPermissions: { folderId: string; scope: string }[],
    isAdmin = false,
  ): Promise<void> {
    const permission = new UserPermission();
    permission.userId = userId;
    permission.info.isAdmin = isAdmin;
    permission.info.folders = folderPermissions;
    await userPermissionData.UserPermissionDataUpdateForUser(
      span,
      userId,
      permission,
    );
  }

  beforeAll(async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpm-permcheck-"));
    dataDir = path.join(baseDir, "data");

    const tracer = new StandardTracer({
      SERVICE_ID: "cloudphotomanager-server-test",
      VERSION: "0.0.0",
    });
    OTelSetTracer(tracer);
    SqlDbUtilsSetOTel(tracer, new StandardLogger());
    span = OTelTracer().startSpan("UserPermissionCheck.spec");

    await fs.ensureDir(dataDir);
    await SqlDbUtilsInit(span, { DATA_DIR: dataDir }, sqlDir);

    userPermissionCheck = await import("./UserPermissionCheck");
    userPermissionData = await import("./UserPermissionData");
    folderData = await import("../folders/FolderData");

    folders.rootA = await createFolder(accountA, "/");
    folders.year2023 = await createFolder(accountA, "/2023");
    folders.year2023x = await createFolder(accountA, "/2023/x");
    folders.year2024 = await createFolder(accountA, "/2024");
    folders.rootB = await createFolder(accountB, "/");

    await setUserFolders("user-admin", [], true);
    await setUserFolders("user-exact", [
      { folderId: folders.year2023.id, scope: "ro" },
    ]);
    await setUserFolders("user-recursive", [
      { folderId: folders.year2023.id, scope: "ro_recursive" },
    ]);
    await setUserFolders("user-root-recursive", [
      { folderId: folders.rootA.id, scope: "ro_recursive" },
    ]);
    await setUserFolders("user-other-account", [
      { folderId: folders.rootB.id, scope: "ro_recursive" },
    ]);
    await setUserFolders("user-nogrants", []);
    await setUserFolders("user-missing-folder", [
      { folderId: "does-not-exist", scope: "ro" },
    ]);
  });

  it("builds a context with resolved folder grants", async () => {
    const context = await userPermissionCheck.UserPermissionContextGet(
      span,
      "user-exact",
    );
    expect(context.isAdmin).toBe(false);
    expect(context.grants).toEqual([
      {
        folderId: folders.year2023.id,
        scope: "ro",
        accountId: accountA,
        folderpath: "/2023",
      },
    ]);
  });

  it("builds an admin context without grants", async () => {
    const context = await userPermissionCheck.UserPermissionContextGet(
      span,
      "user-admin",
    );
    expect(context.isAdmin).toBe(true);
    expect(context.grants).toEqual([]);
  });

  it("drops grants whose folder no longer exists", async () => {
    const context = await userPermissionCheck.UserPermissionContextGet(
      span,
      "user-missing-folder",
    );
    expect(context.grants).toEqual([]);
  });

  it("permits an admin any folder", async () => {
    const context = await userPermissionCheck.UserPermissionContextGet(
      span,
      "user-admin",
    );
    expect(
      userPermissionCheck.UserPermissionContextFolderIsPermitted(
        context,
        folderRef(folders.year2024),
      ),
    ).toBe(true);
    expect(
      userPermissionCheck.UserPermissionContextFolderIsPermitted(context, {
        id: "unknown",
        accountId: "unknown",
        folderpath: "/anything",
      }),
    ).toBe(true);
  });

  it("permits the exact granted folder but not its children for scope ro", async () => {
    const context = await userPermissionCheck.UserPermissionContextGet(
      span,
      "user-exact",
    );
    expect(
      userPermissionCheck.UserPermissionContextFolderIsPermitted(
        context,
        folderRef(folders.year2023),
      ),
    ).toBe(true);
    expect(
      userPermissionCheck.UserPermissionContextFolderIsPermitted(
        context,
        folderRef(folders.year2023x),
      ),
    ).toBe(false);
    expect(
      userPermissionCheck.UserPermissionContextFolderIsPermitted(
        context,
        folderRef(folders.year2024),
      ),
    ).toBe(false);
  });

  it("permits the whole granted subtree for scope ro_recursive", async () => {
    const context = await userPermissionCheck.UserPermissionContextGet(
      span,
      "user-recursive",
    );
    expect(
      userPermissionCheck.UserPermissionContextFolderIsPermitted(
        context,
        folderRef(folders.year2023),
      ),
    ).toBe(true);
    expect(
      userPermissionCheck.UserPermissionContextFolderIsPermitted(
        context,
        folderRef(folders.year2023x),
      ),
    ).toBe(true);
    expect(
      userPermissionCheck.UserPermissionContextFolderIsPermitted(
        context,
        folderRef(folders.year2024),
      ),
    ).toBe(false);
    // Same path in another account must not match.
    expect(
      userPermissionCheck.UserPermissionContextFolderIsPermitted(context, {
        id: "other-folder",
        accountId: accountB,
        folderpath: "/2023/x",
      }),
    ).toBe(false);
  });

  it("a recursive grant on the account root covers every folder of the account", async () => {
    // Regression for the root-prefix comparison ("/" never matched a
    // subtree because paths are compared as "//").
    const context = await userPermissionCheck.UserPermissionContextGet(
      span,
      "user-root-recursive",
    );
    expect(
      userPermissionCheck.UserPermissionContextFolderIsPermitted(
        context,
        folderRef(folders.year2024),
      ),
    ).toBe(true);
    expect(
      userPermissionCheck.UserPermissionContextFolderIsPermitted(
        context,
        folderRef(folders.rootA),
      ),
    ).toBe(true);
  });

  it("returns folder ids per account for the permitted scope", async () => {
    const adminContext = await userPermissionCheck.UserPermissionContextGet(
      span,
      "user-admin",
    );
    expect(
      await userPermissionCheck.UserPermissionContextFolderIdsGet(
        span,
        adminContext,
        accountA,
      ),
    ).toBeNull();

    const rootRecursiveContext =
      await userPermissionCheck.UserPermissionContextGet(
        span,
        "user-root-recursive",
      );
    expect(
      await userPermissionCheck.UserPermissionContextFolderIdsGet(
        span,
        rootRecursiveContext,
        accountA,
      ),
    ).toBeNull();

    const exactContext = await userPermissionCheck.UserPermissionContextGet(
      span,
      "user-exact",
    );
    expect(
      await userPermissionCheck.UserPermissionContextFolderIdsGet(
        span,
        exactContext,
        accountA,
      ),
    ).toEqual([folders.year2023.id]);

    const recursiveContext =
      await userPermissionCheck.UserPermissionContextGet(
        span,
        "user-recursive",
      );
    const recursiveIds =
      await userPermissionCheck.UserPermissionContextFolderIdsGet(
        span,
        recursiveContext,
        accountA,
      );
    expect(recursiveIds.sort()).toEqual(
      [folders.year2023.id, folders.year2023x.id].sort(),
    );

    // No grants on the requested account → empty list (nothing visible).
    const otherAccountContext =
      await userPermissionCheck.UserPermissionContextGet(
        span,
        "user-other-account",
      );
    expect(
      await userPermissionCheck.UserPermissionContextFolderIdsGet(
        span,
        otherAccountContext,
        accountA,
      ),
    ).toEqual([]);
  });

  it("checks a folder for a user given only the user id", async () => {
    expect(
      await userPermissionCheck.UserPermissionCheckFolderForUser(
        span,
        "user-recursive",
        folderRef(folders.year2023x),
      ),
    ).toBe(true);
    expect(
      await userPermissionCheck.UserPermissionCheckFolderForUser(
        span,
        "user-recursive",
        folderRef(folders.year2024),
      ),
    ).toBe(false);
    expect(
      await userPermissionCheck.UserPermissionCheckFolderForUser(
        span,
        "user-nogrants",
        folderRef(folders.rootA),
      ),
    ).toBe(false);
  });

  it("filters a folder list to the permitted subset", async () => {
    const allFolders = [
      folders.rootA,
      folders.year2023,
      folders.year2023x,
      folders.year2024,
    ];
    const filtered =
      await userPermissionCheck.UserPermissionCheckFilterFoldersForUser(
        span,
        allFolders,
        "user-recursive",
      );
    expect(filtered.map((folder) => folder.folderpath).sort()).toEqual([
      "/2023",
      "/2023/x",
    ]);

    const adminFiltered =
      await userPermissionCheck.UserPermissionCheckFilterFoldersForUser(
        span,
        allFolders,
        "user-admin",
      );
    expect(adminFiltered).toHaveLength(4);
  });
});
