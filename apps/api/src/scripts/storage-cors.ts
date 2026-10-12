/* eslint-disable no-console -- a command line script: it prints its result to the terminal. */
/**
 * Applies the bucket CORS rules browsers need for direct uploads (PUT, multipart, ETag).
 * Run once after you create the R2 bucket, and again when WEB_ORIGIN changes:
 *   npm run storage:cors -w @growth-desk/api
 * Local MinIO does not support bucket CORS; it uses the server-wide setting in docker-compose.yml.
 */
import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';

async function main(): Promise<void> {
  const storage = env.storage;
  if (!storage) throw new Error('Storage is not configured. Fill the R2_* keys in .env first.');
  if (storage.driver !== 'r2') {
    console.log('STORAGE_DRIVER is minio: CORS comes from MINIO_API_CORS_ALLOW_ORIGIN. Nothing to do.');
    return;
  }
  const client = new S3Client({
    region: storage.region,
    endpoint: storage.endpoint,
    forcePathStyle: storage.forcePathStyle,
    credentials: { accessKeyId: storage.accessKeyId, secretAccessKey: storage.secretAccessKey },
  });
  await client.send(
    new PutBucketCorsCommand({
      Bucket: storage.bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: env.webOrigins,
            AllowedMethods: ['GET', 'HEAD', 'PUT', 'POST'],
            AllowedHeaders: ['*'],
            // The browser must read ETag of each part to complete a multipart upload.
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  const current = await client.send(new GetBucketCorsCommand({ Bucket: storage.bucket }));
  console.log(`CORS set on bucket "${storage.bucket}" for: ${env.webOrigins.join(', ')}`);
  console.log(JSON.stringify(current.CORSRules, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
