// Local S3-compatible store standing in for Cloudflare R2 in tests (s3rver). Not R2: same S3 API.
import S3rver from 's3rver';
import fs from 'node:fs';
const [port = '4569', dir = '/tmp/s3mock'] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
await new S3rver({ port: Number(port), address: '127.0.0.1', silent: true, directory: dir, configureBuckets: [{ name: 'overdrive-test' }] }).run();
console.log(`[s3mock] http://127.0.0.1:${port} bucket overdrive-test`);
