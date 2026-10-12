#!/bin/sh
# Creates the local bucket and its CORS rules. Safe to run many times.
set -eu
: "${MINIO_ROOT_USER:?}" "${MINIO_ROOT_PASSWORD:?}" "${STORAGE_BUCKET:?}"

until mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  echo "waiting for minio..."
  sleep 1
done

mc mb --ignore-existing "local/$STORAGE_BUCKET"
mc anonymous set none "local/$STORAGE_BUCKET"
# MinIO sets CORS server-wide (MINIO_API_CORS_ALLOW_ORIGIN in docker-compose.yml).
# S3 servers that support bucket CORS (for example R2) get the rules from cors.xml.
if mc cors set "local/$STORAGE_BUCKET" /init/cors.xml >/dev/null 2>&1; then
  echo "bucket CORS set from cors.xml"
else
  echo "bucket CORS not supported here; using the server-wide CORS setting"
fi
echo "bucket $STORAGE_BUCKET ready"
