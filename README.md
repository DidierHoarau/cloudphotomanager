# cloudphotomanager

CloudPhotoManager is a self-hosted free and open source photo managegement tool. Photos and videos are not stored directly in the application, they are stored on 3rd party storage providers that the application needs to be connected to.

![](docs/images/cloudphotomanager_preview.png?raw=true)

# Features

- Supported Storage Providers: OneDrive, AWS S3, Local Drive
- Organize Photos by Folders
- Multiple users to be able to shared some folder to some users
- Detection of duplicates
- Favorites: mark keepers from the viewer, filter the gallery and the search by favorites
- Faceted search: filter by media type (photos/videos/RAW), folder subtree, has-location, favorites and outtakes
- Label browsing: click the classification labels detected on your photos to search them
- Search results support selection and the same bulk actions as the gallery (trash/download/move), with the folder path shown on each result
- Geo map: browse geo-tagged photos on a world map, reachable from a Map tab and "Show on map" entry points in the File Info dialog and the fullscreen viewer
- Trash: deletes move files to a restorable Trash (30 days retention, automatic purge), with restore and permanent delete
- Timeline: browse the whole library by month across folders
- Sync notification center: the header sync icon opens a panel summarizing failed actions (with plain-language causes and suggested fixes), recently completed operations and queue activity, linking to the full failure list in Settings → Sync
- Out-of-band webhook on persistent failure: when a file reaches the sync retry cap (5 consecutive failures), an optional `POST` notification is sent to `SYNC_FAILURE_WEBHOOK_URL` with the file, the operation and the likely cause
- Plain-language sync failures: recurring technical errors are translated into user-actionable causes on the failure cards, and gallery items stuck at the retry cap show an explicit "Preview unavailable" state instead of an eternal "Syncing" placeholder
- Download the original file from the fullscreen viewer or the File Info dialog
- Bulk download a selection of gallery items as a zip archive
- Read-only share links (optional expiry, revocable) for a folder subtree, usable without an account

# Sessions

- Login issues a JWT stored in a signed httpOnly cookie that is valid for `JWT_VALIDITY_DURATION` seconds (default: `8035200`, i.e. about 93 days; overridable via environment variable or configuration file).
- The cookie is persistent (`Max-Age` aligned with the JWT validity), so it survives closing and re-opening the browser without a new login.
- Sessions are renewed automatically while the application is used: the server re-issues the token once it is older than half of its validity, and a tab left open also renews the cookie daily.
- Sessions survive an application restart as long as the `/data` volume (which holds the database containing the JWT signing key) is persistent.
- Logout, password changes, permission changes and user deletion revoke the user's sessions server-side (the JWT carries a token version checked against the database on every request): every previously issued token, including copies, stops working at the next request.
- Users and permissions are reloaded on every request, so a deleted user or a demoted admin loses access immediately.

# Media access

- Thumbnails and previews are not served from a public static tree. The API mints short-lived HMAC-signed URLs (`file.thumbnailUrl`, `file.previewUrl`, `file.videoPreviewUrl`) bound to the account, file, asset and subject.
- Every media request re-checks the live session and folder permission (or the live share link), so revoking a grant, a share, or a session stops serving already-delivered URLs.
- URLs are valid for `MEDIA_URL_TTL_SECONDS` (default `3600`) and bucket-aligned so repeated listings reuse the same URL; browsers cache each asset for at most `MEDIA_CACHE_SECONDS` (default `300`). Both can be overridden by environment variable.

# Identifier opacity

- File and folder IDs are deterministic (md5 of the account path), but they are never exposed as an access control: media URLs are HMAC-signed and every API route validates the session, the account boundary and the folder permission before returning data.

# Dependency security notes

`npm audit` state that is intentionally accepted, and why:

- **`aws-sdk` v2 (server, 2 moderate advisories — accepted until the v3 migration)**
  - [GHSA-j965-2qgj-vjmq](https://github.com/advisories/GHSA-j965-2qgj-vjmq): v2 does not validate the S3 region parameter. S3 region strings in CloudPhotoManager come only from admin-defined account definitions, not from end-user input.
  - [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq): a vulnerable `uuid` version is bundled inside `aws-sdk` v2; application code uses `uuid` directly at a fixed version.
  - Never run `npm audit fix --force` to clear them: it would downgrade `aws-sdk` to 1.x and break the S3 integration.
  - **Migration plan (v2 → `@aws-sdk/client-s3`, follow-up task):** S3 is the only consumer (4 files under `cloudphotomanager-server/src/accounts/awsS3/`). Replace `aws-sdk` with `@aws-sdk/client-s3`; build a per-account `new S3Client({ region, credentials: { accessKeyId, secretAccessKey } })` in `getS3Client()` (removing the global `AWS.config.update` mutation); convert the 5 operations (`listObjectsV2`, `getObject` + `createReadStream`, `deleteObject`, `copyObject`, `deleteObjects`) to `client.send(new ListObjectsV2Command/DeleteObjectCommand/CopyObjectCommand/DeleteObjectsCommand/GetObjectCommand)` (drop `.promise()`; response fields `Contents`/`IsTruncated`/`NextContinuationToken` keep their names — re-check the pagination loops in `AwsS3AccountInventory.ts`); for `GetObject` read the body from the command response (`Body` is a Node stream in v3) to keep `createReadStream` behaviour; update the fake S3 clients in `AwsS3Account.spec.ts` to the `send(command)` shape. v3's region validation also resolves GHSA-j965-2qgj-vjmq.
- **Web dev-only advisories (not shipped to production)**: `npm audit --omit=dev` for the web client reports 0 vulnerabilities. The remaining full-audit findings live in development tooling only and have no non-breaking fix: `vitest` 3/4 (`@vitest/mocker` moderate, `tinypool` criticals — fixed in vitest 5) and the Nuxt dev-server chain (`node-forge` via `listhen`/`nitropack` — no fixed version in Nuxt 4 yet). Neither affects the built application image; they are revisited when those stacks release fixes.

# Installation

The only supported way to setup the application is with Docker containers.

[https://hub.docker.com/r/didierhoarau/cloudphotomanager]

## Kubernetes Setup

The following basic configuration can be used to setup the application on Kubernetes:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloudphotomanager
  labels:
    app: cloudphotomanager
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cloudphotomanager
  template:
    metadata:
      labels:
        app: cloudphotomanager
    spec:
      priorityClassName: high-priority
      containers:
        - image: didierhoarau/cloudphotomanager:latest
          name: cloudphotomanager
          env:
            # Storage provider credentials
            - name: ONEDRIVE_CLIENT_ID
              value: ... # Only needed for OneDrive
            - name: ONEDRIVE_CLIENT_SECRET
              value: ... # Only needed for OneDrive
            - name: ONEDRIVE_CALLBACK_SIGNIN
              value: ... # Only needed for OneDrive
            - name: AWS_ACCESS_KEY_ID
              value: ... # Only needed for S3
            - name: AWS_SECRET_ACCESS_KEY
              value: ... # Only needed for S3
            - name: AWS_DEFAULT_REGION
              value: ... # Only needed for S3
            # Sync and scheduling (optional; defaults shown)
            - name: AUTO_SYNC
              value: "Y" # Set to "N" to disable automatic background sync
            - name: SYNC_FAILURE_WEBHOOK_URL
              value: "" # Optional webhook URL notified when a file reaches the sync retry cap
            # Session (optional; default shown)
            - name: JWT_VALIDITY_DURATION
              value: "8035200" # Session validity in seconds (~93 days); renewed automatically while in use
            - name: MEDIA_URL_TTL_SECONDS
              value: "3600" # Lifetime of signed media URLs
            - name: MEDIA_CACHE_SECONDS
              value: "300" # Browser cache lifetime for media assets
            - name: SOURCE_FETCH_FREQUENCY
              value: "1800000" # Base sync interval in milliseconds (30 min)
            - name: SOURCE_FETCH_FREQUENCY_DYNAMIC_MAX_FACTOR
              value: "6" # Max multiplier applied to dynamic sync backoff
            - name: CRON_METRIC_REFRESH
              value: "*/15 * * * *" # Cron schedule for metric refresh
            - name: CRON_SCAN_DEEP
              value: "0 0 * * *" # Cron schedule for deep thumbnail/preview scan
            # Database and media processing (optional; defaults shown)
            - name: DATABASE_ASYNC_WRITE
              value: "false" # Enable async SQLite writes (faster, less durable)
            - name: VIDEO_PREVIEW_WIDTH
              value: "900" # Width in pixels for generated video previews
            # Image classification (optional; defaults shown)
            - name: IMAGE_CLASSIFICATION_ENABLED
              value: "true"
            - name: IMAGE_CLASSIFICATION_MODEL
              value: "Xenova/mobilenet_v2_1.0_224" # HuggingFace ONNX model
            # OpenTelemetry configuration (optional)
            - name: OPENTELEMETRY_COLLECTOR_HTTP_TRACES
              value: "" # Set to your OpenTelemetry traces endpoint
            - name: OPENTELEMETRY_COLLECTOR_HTTP_METRICS
              value: "" # Set to your OpenTelemetry metrics endpoint
            - name: OPENTELEMETRY_COLLECTOR_HTTP_LOGS
              value: "" # Set to your OpenTelemetry logs endpoint
            - name: OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS
              value: "60"
            - name: OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS
              value: "60"
            - name: OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER
              value: "" # Optional authorization header for OpenTelemetry collector
          volumeMounts:
            - mountPath: /data
              name: pod-volume
      volumes:
        - name: pod-volume
          persistentVolumeClaim:
            claimName: cloudphotomanager
---
apiVersion: v1
kind: Service
metadata:
  name: cloudphotomanager
spec:
  ports:
    - name: tcp
      port: 80
      targetPort: 80
  selector:
    app: cloudphotomanager
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: cloudphotomanager
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 100Gi
```
