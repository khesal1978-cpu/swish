import express from 'express';
import { connectedApp } from './connection.js';

const app = express();
app.disable('x-powered-by');
app.use(async (req, res, next) => {
  try {
    const handler = await connectedApp();
    return handler(req, res, next);
  } catch (error) {
    console.error('Swish initialization failed', { name: error.name, code: error.code, codeName: error.codeName });
    res.set('Cache-Control', 'no-store');
    res.status(503).json({ code: 'service_unavailable' });
  }
});

export default app;
