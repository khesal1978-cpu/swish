import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const path = process.argv[2];
if (!path) throw new Error('Pass the credentials env file path.');
const values = parseEnv(readFileSync(path, 'utf8'));
let uri = values.MONGODB_URI;
if (!uri || !/^mongodb(\+srv)?:\/\//.test(uri)) throw new Error('A MongoDB URI is required.');
if (values.MONGODB_PASSWORD) {
  uri = uri.replace(/<(?:db_)?password>/gi, encodeURIComponent(values.MONGODB_PASSWORD));
}
if (values.MONGODB_USERNAME) {
  uri = uri.replace(/<(?:db_)?username>/gi, encodeURIComponent(values.MONGODB_USERNAME));
}
if (/[<>\r\n]/.test(uri)) throw new Error('MongoDB URI still contains a placeholder or invalid line break.');
const config = {
  MONGODB_URI: uri,
  MONGODB_DATABASE: values.MONGODB_DATABASE || 'swish',
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: '3000',
  TRUST_PROXY_HOPS: '0',
};
writeFileSync('.env', Object.entries(config).map(([key, value]) => key + '=' + JSON.stringify(value)).join('\n') + '\n');
console.log('Backend credentials configured without exposing their values.');
