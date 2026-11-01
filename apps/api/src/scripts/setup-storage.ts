import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { S3Client, CreateBucketCommand, PutBucketCorsCommand, PutPublicAccessBlockCommand, PutBucketLifecycleConfigurationCommand } from '@aws-sdk/client-s3';
import { parseEnv } from '../config/env.js';
config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });
const env = parseEnv(process.env);
// Local developer provisioning only. AWS provisioning belongs to your infrastructure workflow.
if (!env.S3_ENDPOINT || !['localhost', '127.0.0.1'].includes(new URL(env.S3_ENDPOINT).hostname) || !env.S3_BUCKET || env.NODE_ENV === 'production') throw new Error('This command requires a loopback development S3 endpoint and bucket');
const client = new S3Client({ region: env.S3_REGION, endpoint: env.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: env.S3_ACCESS_KEY_ID ?? 'local-development', secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? 'local-development' } });
try { await client.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET })); }
catch (error) { if (!(error instanceof Error && error.name === 'BucketAlreadyOwnedByYou')) throw error; }
await client.send(new PutPublicAccessBlockCommand({ Bucket: env.S3_BUCKET, PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } }));
await client.send(new PutBucketCorsCommand({ Bucket: env.S3_BUCKET, CORSConfiguration: { CORSRules: [{ AllowedOrigins: [env.APP_URL], AllowedMethods: ['PUT'], AllowedHeaders: ['content-type'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 300 }] } }));
await client.send(new PutBucketLifecycleConfigurationCommand({ Bucket: env.S3_BUCKET, LifecycleConfiguration: { Rules: [{ ID: 'abort-incomplete-uploads', Status: 'Enabled', Filter: { Prefix: 'quarantine/' }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 2 } }] } }));
process.stdout.write('Local private bucket and upload CORS configured.\n');
