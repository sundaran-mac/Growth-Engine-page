# ADR 0004: Direct-to-R2 presigned multipart uploads, MinIO locally

Status: accepted for this build (12 Oct 2026).

## Context

- Reels and long videos are large files.
- Sending big files through the API wastes memory and time, and can time out.

## Decision

- Store files in **Cloudflare R2** using its S3-compatible API (`@aws-sdk/client-s3`).
- The browser uploads **straight to storage**:
  - small files: one **presigned PUT** URL (a short-lived URL that allows one upload);
  - large video: **S3 multipart upload** (the file goes in parts; each part gets its own presigned URL; then "complete").
- The API only creates the URLs and records the asset (`uploading` -> `ready` or `failed`).
- In local development, **MinIO** runs in Docker and speaks the same S3 API. No cloud keys needed.

## Consequences

- Big video never passes through the API.
- The storage bucket needs a CORS rule that allows the web origin to PUT and to read the `ETag` header.
- An unfinished multipart upload must be aborted or cleaned up.
- The same code works on MinIO and R2; only env values change.
