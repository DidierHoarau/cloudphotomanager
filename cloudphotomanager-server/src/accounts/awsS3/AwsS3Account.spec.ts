import * as AWS from "aws-sdk";
import { S3 } from "aws-sdk";
import { Span } from "@opentelemetry/sdk-trace-base";
import { StandardTracer } from "@devopsplaybook.io/otel-utils";
import { OTelSetTracer, OTelTracer } from "../../OTelContext";
import { AccountDefinition } from "../../model/AccountDefinition";
import { Folder } from "../../model/Folder";
import { AwsS3Account } from "./AwsS3Account";
import { AwsS3AccountInventoryListFilesInFolder } from "./AwsS3AccountInventory";

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
});
