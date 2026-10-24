import * as AWS from "aws-sdk";
import { S3 } from "aws-sdk";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardTracer } from "@devopsplaybook.io/otel-utils";
import { OTelSetTracer, OTelTracer } from "../../OTelContext";
import { AccountDefinition } from "../../model/AccountDefinition";
import { File } from "../../model/File";
import { Folder } from "../../model/Folder";
import { AwsS3Account } from "./AwsS3Account";
import { AwsS3AccountInventoryListFilesInFolder } from "./AwsS3AccountInventory";

interface FakeS3 {
  s3: S3;
  objects: Set<string>;
  listCalls: any[];
  copyCalls: any[];
  deleteObjectCalls: any[];
  deleteObjectsCalls: any[];
}

// In-memory S3 stand-in covering the operations used by the account
// implementation. Keys are stored without a leading slash, exactly as S3
// returns them.
function makeFakeS3(initialKeys: string[]): FakeS3 {
  const objects = new Set(initialKeys);
  const listCalls: any[] = [];
  const copyCalls: any[] = [];
  const deleteObjectCalls: any[] = [];
  const deleteObjectsCalls: any[] = [];

  function decodeCopySource(copySource: string): [string, string] {
    const withoutLeading = copySource.replace(/^\/+/, "");
    const separator = withoutLeading.indexOf("/");
    return [
      decodeURIComponent(withoutLeading.slice(0, separator)),
      withoutLeading
        .slice(separator + 1)
        .split("/")
        .map(decodeURIComponent)
        .join("/"),
    ];
  }

  const s3 = {
    listObjectsV2: (params: any) => ({
      promise: async () => {
        listCalls.push(params);
        const prefix = params.Prefix || "";
        const keys = [...objects].filter((key) => key.startsWith(prefix));
        return {
          Contents: keys.sort().map((key) => ({ Key: key })),
          IsTruncated: false,
        };
      },
    }),
    copyObject: (params: any) => ({
      promise: async () => {
        copyCalls.push(params);
        const [bucket, sourceKey] = decodeCopySource(params.CopySource);
        if (bucket !== "test-bucket") {
          throw new Error(`Unexpected bucket in CopySource: ${bucket}`);
        }
        if (!objects.has(sourceKey)) {
          throw new Error(`NoSuchKey: ${sourceKey}`);
        }
        objects.add(params.Key);
        return {};
      },
    }),
    deleteObject: (params: any) => ({
      promise: async () => {
        deleteObjectCalls.push(params);
        objects.delete(params.Key);
        return {};
      },
    }),
    deleteObjects: (params: any) => ({
      promise: async () => {
        deleteObjectsCalls.push(params);
        for (const object of params.Delete.Objects) {
          objects.delete(object.Key);
        }
        return {};
      },
    }),
  };

  return {
    s3: s3 as unknown as S3,
    objects,
    listCalls,
    copyCalls,
    deleteObjectCalls,
    deleteObjectsCalls,
  };
}

describe("AwsS3Account", () => {
  let span: Span;

  beforeAll(() => {
    const tracer = new StandardTracer({
      SERVICE_ID: "cloudphotomanager-server-test",
      VERSION: "0.0.0",
    });
    OTelSetTracer(tracer);
    span = OTelTracer().startSpan("AwsS3Account.spec");
  });

  afterAll(() => {
    span.end();
    jest.restoreAllMocks();
  });

  // aws-sdk v2 attaches the service operations to the S3 instance, so the
  // client seam (`getS3Client`) is stubbed to exercise validate().
  function stubS3Client(account: AwsS3Account, listObjectsV2: () => any): void {
    (account as any).getS3Client = async () => ({ listObjectsV2 });
  }

  function makeAccountDefinition(): AccountDefinition {
    const accountDefinition = new AccountDefinition();
    accountDefinition.id = "account-s3";
    accountDefinition.name = "s3-account";
    accountDefinition.rootpath = "/photos";
    accountDefinition.info = { type: "awsS3" };
    accountDefinition.infoPrivate = {
      bucket: "test-bucket",
      accessKey: "key",
      accessKeySecret: "secret",
      region: "us-east-1",
    };
    return accountDefinition;
  }

  // Regression for the aws-sdk 1.18.0 break: the pinned v2 client must
  // expose the operations the account implementation relies on.
  it("exposes the S3 operations used by the account implementation", () => {
    const s3 = new AWS.S3();
    expect(typeof s3.listObjectsV2).toBe("function");
    expect(typeof s3.deleteObject).toBe("function");
    expect(typeof s3.copyObject).toBe("function");
    expect(typeof s3.getObject).toBe("function");
  });

  it("validate() resolves true when listObjectsV2 succeeds", async () => {
    const account = new AwsS3Account(makeAccountDefinition());
    stubS3Client(account, () => ({ promise: async () => ({}) }));
    expect(await account.validate(span)).toBe(true);
  });

  it("validate() resolves false when listObjectsV2 fails", async () => {
    const account = new AwsS3Account(makeAccountDefinition());
    stubS3Client(account, () => ({
      promise: async () => {
        throw new Error("Access Denied");
      },
    }));
    expect(await account.validate(span)).toBe(false);
  });

  it("lists files in a folder from the S3 listing", async () => {
    const accountDefinition = makeAccountDefinition();
    const account = new AwsS3Account(accountDefinition);
    const folder = new Folder(accountDefinition.id, "/photos/2023");
    folder.idCloud = "/photos/2023";
    const lastModified = new Date("2023-05-01T10:00:00.000Z");
    const fakeS3 = {
      listObjectsV2: () => ({
        promise: async () => ({
          Contents: [
            { Key: "2023/photo-a.jpg", LastModified: lastModified },
            { Key: "2023/photo-b.jpg", LastModified: lastModified },
            { Key: "2023/" },
          ],
          IsTruncated: false,
        }),
      }),
    } as unknown as S3;

    const files = await AwsS3AccountInventoryListFilesInFolder(
      span,
      account,
      fakeS3,
      folder,
    );

    expect(files.map((file) => file.filename).sort()).toEqual([
      "photo-a.jpg",
      "photo-b.jpg",
    ]);
    const first = files.find((file) => file.filename === "photo-a.jpg");
    expect(first.accountId).toBe(accountDefinition.id);
    expect(first.folderId).toBe(folder.id);
    expect(first.idCloud).toBe("2023/photo-a.jpg");
    expect(first.dateUpdated.toISOString()).toBe(lastModified.toISOString());
  });

  it("follows continuation tokens while listing", async () => {
    const accountDefinition = makeAccountDefinition();
    const account = new AwsS3Account(accountDefinition);
    const folder = new Folder(accountDefinition.id, "/photos/2023");
    folder.idCloud = "/photos/2023";
    let calls = 0;
    const fakeS3 = {
      listObjectsV2: () => ({
        promise: async () => {
          calls++;
          if (calls === 1) {
            return {
              Contents: [{ Key: "2023/one.jpg", LastModified: new Date() }],
              IsTruncated: true,
              NextContinuationToken: "token-1",
            };
          }
          return {
            Contents: [{ Key: "2023/two.jpg", LastModified: new Date() }],
            IsTruncated: false,
          };
        },
      }),
    } as unknown as S3;

    const files = await AwsS3AccountInventoryListFilesInFolder(
      span,
      account,
      fakeS3,
      folder,
    );

    expect(calls).toBe(2);
    expect(files.map((file) => file.filename).sort()).toEqual([
      "one.jpg",
      "two.jpg",
    ]);
  });

  function makeFile(
    accountDefinition: AccountDefinition,
    filename: string,
    idCloud: string,
    folderId = "folder-a",
  ): File {
    const file = new File(accountDefinition.id, folderId, filename);
    file.idCloud = idCloud;
    return file;
  }

  function makeFolder(
    accountDefinition: AccountDefinition,
    folderpath: string,
    idCloud: string,
  ): Folder {
    const folder = new Folder(accountDefinition.id, folderpath);
    folder.idCloud = idCloud;
    return folder;
  }

  function accountWithFakeS3(
    accountDefinition: AccountDefinition,
    fake: FakeS3,
  ): AwsS3Account {
    const account = new AwsS3Account(accountDefinition);
    (account as any).getS3Client = async () => fake.s3;
    return account;
  }

  describe("file move and rename", () => {
    it("moves a file into a destination folder using POSIX keys", async () => {
      const accountDefinition = makeAccountDefinition();
      const fake = makeFakeS3(["photos/a/photo.jpg"]);
      const account = accountWithFakeS3(accountDefinition, fake);
      const file = makeFile(
        accountDefinition,
        "photo.jpg",
        "photos/a/photo.jpg",
      );

      await account.moveFile(span, file, "/b");

      expect(fake.objects.has("photos/b/photo.jpg")).toBe(true);
      expect(fake.objects.has("photos/a/photo.jpg")).toBe(false);
      expect(fake.copyCalls[0].Key).toBe("photos/b/photo.jpg");
      expect(fake.copyCalls[0].CopySource).toBe(
        "/test-bucket/photos/a/photo.jpg",
      );
      expect(fake.deleteObjectCalls[0].Key).toBe("photos/a/photo.jpg");
    });

    it("moves a file to the account root", async () => {
      const accountDefinition = makeAccountDefinition();
      const fake = makeFakeS3(["photos/a/photo.jpg"]);
      const account = accountWithFakeS3(accountDefinition, fake);
      const file = makeFile(
        accountDefinition,
        "photo.jpg",
        "photos/a/photo.jpg",
      );

      await account.moveFile(span, file, "/");

      expect(fake.objects.has("photos/photo.jpg")).toBe(true);
      expect(fake.objects.has("photos/a/photo.jpg")).toBe(false);
    });

    it("honours a non-root account rootpath", async () => {
      const accountDefinition = makeAccountDefinition();
      accountDefinition.rootpath = "/sub";
      const fake = makeFakeS3(["sub/a/photo.jpg"]);
      const account = accountWithFakeS3(accountDefinition, fake);
      const file = makeFile(accountDefinition, "photo.jpg", "sub/a/photo.jpg");

      await account.moveFile(span, file, "/b");

      expect(fake.objects.has("sub/b/photo.jpg")).toBe(true);
      expect(fake.objects.has("sub/a/photo.jpg")).toBe(false);
    });

    it("renames a file in place", async () => {
      const accountDefinition = makeAccountDefinition();
      const fake = makeFakeS3(["photos/a/photo.jpg"]);
      const account = accountWithFakeS3(accountDefinition, fake);
      const file = makeFile(
        accountDefinition,
        "photo.jpg",
        "photos/a/photo.jpg",
      );

      await account.renameFile(span, file, "renamed.jpg");

      expect(fake.objects.has("photos/a/renamed.jpg")).toBe(true);
      expect(fake.objects.has("photos/a/photo.jpg")).toBe(false);
      expect(fake.copyCalls[0].Key).toBe("photos/a/renamed.jpg");
    });

    it("encodes special characters in CopySource but keeps the key literal", async () => {
      const accountDefinition = makeAccountDefinition();
      const fake = makeFakeS3(["photos/a/sun set#1.jpg"]);
      const account = accountWithFakeS3(accountDefinition, fake);
      const file = makeFile(
        accountDefinition,
        "sun set#1.jpg",
        "photos/a/sun set#1.jpg",
      );

      await account.moveFile(span, file, "/b");

      expect(fake.copyCalls[0].CopySource).toBe(
        "/test-bucket/photos/a/sun%20set%231.jpg",
      );
      expect(fake.objects.has("photos/b/sun set#1.jpg")).toBe(true);
    });

    it("rejects a traversal destination without touching S3", async () => {
      const accountDefinition = makeAccountDefinition();
      const fake = makeFakeS3(["photos/a/photo.jpg"]);
      const account = accountWithFakeS3(accountDefinition, fake);
      const file = makeFile(
        accountDefinition,
        "photo.jpg",
        "photos/a/photo.jpg",
      );

      await expect(account.moveFile(span, file, "/../escape")).rejects.toThrow(
        /Invalid destination folder/,
      );
      await expect(account.renameFile(span, file, "../escape.jpg")).rejects.toThrow(
        /Invalid file name/,
      );
      expect(fake.copyCalls).toHaveLength(0);
      expect(fake.deleteObjectCalls).toHaveLength(0);
      expect(fake.objects.has("photos/a/photo.jpg")).toBe(true);
    });

    it("skips S3 when source and destination are identical", async () => {
      const accountDefinition = makeAccountDefinition();
      const fake = makeFakeS3(["photos/a/photo.jpg"]);
      const account = accountWithFakeS3(accountDefinition, fake);
      const file = makeFile(
        accountDefinition,
        "photo.jpg",
        "photos/a/photo.jpg",
      );

      await account.moveFile(span, file, "/a");
      await account.renameFile(span, file, "photo.jpg");

      expect(fake.copyCalls).toHaveLength(0);
      expect(fake.deleteObjectCalls).toHaveLength(0);
    });
  });

  describe("folder operations", () => {
    it("deletes the marker and nested keys while preserving siblings", async () => {
      const accountDefinition = makeAccountDefinition();
      const fake = makeFakeS3([
        "photos/2023",
        "photos/2023/a.jpg",
        "photos/2023/sub/b.jpg",
        "photos/2024/c.jpg",
        "photos/20230-other/d.jpg",
      ]);
      const account = accountWithFakeS3(accountDefinition, fake);
      const folder = makeFolder(accountDefinition, "/2023", "photos/2023");

      await account.deleteFolder(span, folder);

      expect(fake.objects.has("photos/2023")).toBe(false);
      expect(fake.objects.has("photos/2023/a.jpg")).toBe(false);
      expect(fake.objects.has("photos/2023/sub/b.jpg")).toBe(false);
      expect(fake.objects.has("photos/2024/c.jpg")).toBe(true);
      expect(fake.objects.has("photos/20230-other/d.jpg")).toBe(true);
      expect(fake.deleteObjectsCalls).toHaveLength(1);
      expect(
        fake.deleteObjectsCalls[0].Delete.Objects.map((o: any) => o.Key).sort(),
      ).toEqual(
        ["photos/2023", "photos/2023/a.jpg", "photos/2023/sub/b.jpg"].sort(),
      );
      expect(fake.deleteObjectsCalls[0].Delete.Quiet).toBe(true);
    });

    it("tolerates deleting an empty folder", async () => {
      const accountDefinition = makeAccountDefinition();
      const fake = makeFakeS3([]);
      const account = accountWithFakeS3(accountDefinition, fake);
      const folder = makeFolder(accountDefinition, "/empty", "photos/empty");

      await account.deleteFolder(span, folder);

      expect(fake.deleteObjectsCalls).toHaveLength(0);
    });

    it("refuses to delete or rename the account root", async () => {
      const accountDefinition = makeAccountDefinition();
      const fake = makeFakeS3(["photos/a.jpg"]);
      const account = accountWithFakeS3(accountDefinition, fake);
      const appRoot = makeFolder(accountDefinition, "/", "photos");
      const keyRootOnly = makeFolder(accountDefinition, "/2023", "photos");

      await expect(account.deleteFolder(span, appRoot)).rejects.toThrow(
        /account root/,
      );
      await expect(
        account.renameFolder(span, keyRootOnly, "renamed"),
      ).rejects.toThrow(/account root/);
      expect(fake.deleteObjectsCalls).toHaveLength(0);
      expect(fake.copyCalls).toHaveLength(0);
    });

    it("renames a folder, preserving the nested suffixes", async () => {
      const accountDefinition = makeAccountDefinition();
      const fake = makeFakeS3([
        "photos/2023",
        "photos/2023/a.jpg",
        "photos/2023/sub/b.jpg",
        "photos/2024/c.jpg",
      ]);
      const account = accountWithFakeS3(accountDefinition, fake);
      const folder = makeFolder(accountDefinition, "/2023", "photos/2023");

      await account.renameFolder(span, folder, "2023-renamed");

      expect(fake.objects.has("photos/2023-renamed")).toBe(true);
      expect(fake.objects.has("photos/2023-renamed/a.jpg")).toBe(true);
      expect(fake.objects.has("photos/2023-renamed/sub/b.jpg")).toBe(true);
      expect(fake.objects.has("photos/2023")).toBe(false);
      expect(fake.objects.has("photos/2023/a.jpg")).toBe(false);
      expect(fake.objects.has("photos/2023/sub/b.jpg")).toBe(false);
      expect(fake.objects.has("photos/2024/c.jpg")).toBe(true);
      expect(fake.copyCalls).toHaveLength(3);
      expect(fake.deleteObjectsCalls).toHaveLength(1);
    });

    it("refuses to merge into an existing destination prefix", async () => {
      const accountDefinition = makeAccountDefinition();
      const fake = makeFakeS3([
        "photos/2023/a.jpg",
        "photos/2023-renamed/b.jpg",
      ]);
      const account = accountWithFakeS3(accountDefinition, fake);
      const folder = makeFolder(accountDefinition, "/2023", "photos/2023");

      await expect(
        account.renameFolder(span, folder, "2023-renamed"),
      ).rejects.toThrow(/already exists/);
      expect(fake.copyCalls).toHaveLength(0);
      expect(fake.deleteObjectsCalls).toHaveLength(0);
      expect(fake.objects.has("photos/2023/a.jpg")).toBe(true);
    });

    it("rejects invalid folder names", async () => {
      const accountDefinition = makeAccountDefinition();
      const fake = makeFakeS3(["photos/2023/a.jpg"]);
      const account = accountWithFakeS3(accountDefinition, fake);
      const folder = makeFolder(accountDefinition, "/2023", "photos/2023");

      await expect(
        account.renameFolder(span, folder, "a/b"),
      ).rejects.toThrow(/Invalid folder name/);
      expect(fake.copyCalls).toHaveLength(0);
    });
  });
});
