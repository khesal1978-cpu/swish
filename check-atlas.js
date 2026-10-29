import { MongoClient } from 'mongodb';

process.loadEnvFile('.env');
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
try {
  await client.connect();
  await client.db(process.env.MONGODB_DATABASE).command({ ping: 1 });
  console.log('MongoDB Atlas connection verified.');
} catch (error) {
  console.error('MongoDB Atlas connection failed: ' + (error.code ?? error.name ?? 'connection_error'));
  process.exitCode = 1;
} finally {
  await client.close();
}
