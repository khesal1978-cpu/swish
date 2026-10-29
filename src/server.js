import app from './index.js';
import { closeDatabase, connectedApp } from './connection.js';

try {
  await connectedApp();
  const server = app.listen(Number(process.env.PORT ?? '3000'), process.env.HOST ?? '0.0.0.0', () => {
    console.log('Swish account service is listening.');
  });
  async function shutdown() {
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 10_000).unref();
  }
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} catch {
  console.error('Swish account service could not start. Check database access and backend configuration.');
  await closeDatabase();
  process.exit(1);
}
