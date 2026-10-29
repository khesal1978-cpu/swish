import { MongoClient } from 'mongodb';
import { createApp } from './app.js';
import { mongoStore } from './mongo-store.js';

let connection;
let client;

export function connectedApp() {
  if (!connection) {
    connection = connect().catch(async error => {
      await client?.close();
      client = null;
      connection = null;
      throw error;
    });
  }
  return connection;
}

async function connect() {
  if (!process.env.MONGODB_URI) throw new Error('Database configuration missing');
  client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000, maxPoolSize: 10 });
  await client.connect();
  const store = mongoStore(client.db(process.env.MONGODB_DATABASE ?? 'swish'));
  await store.initialize();
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? (process.env.VERCEL ? '1' : '0'));
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5) {
    throw new Error('Invalid proxy configuration');
  }
  return createApp({ store, trustProxyHops });
}

export async function closeDatabase() {
  await client?.close();
  client = null;
  connection = null;
}
