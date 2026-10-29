import { randomUUID } from 'node:crypto';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { z } from 'zod';
import { hashPassword, newSessionToken, tokenDigest, verifyPassword } from './security.js';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(12).max(128);
const credentials = z.object({ email, password }).strict();
const registration = credentials.extend({ name: z.string().trim().min(1).max(80) }).strict();
const profileSchema = z.object({
  videoBrain: z.string().min(2),
  musicBrain: z.string().min(2),
}).strict();
const MAX_PROFILE_BYTES = 2 * 1024 * 1024;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'invalid_input');
  return result.data;
}

function publicUser(user) {
  return { id: user._id, email: user.email, name: user.name };
}

function validateProfile(profile) {
  if (Buffer.byteLength(profile.videoBrain) + Buffer.byteLength(profile.musicBrain) > MAX_PROFILE_BYTES) {
    throw new ApiError(413, 'profile_too_large');
  }
  for (const value of [profile.videoBrain, profile.musicBrain]) {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new ApiError(400, 'invalid_profile');
    }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new ApiError(400, 'invalid_profile');
    }
  }
}

export function createApp({ store, now = () => new Date(), trustProxyHops = 0, authLimit = 12 }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxyHops);
  app.use(helmet());
  app.use(express.json({ limit: '4mb', strict: true }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/v1/', rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ code: 'rate_limited' }),
  }));
  const authLimiter = rateLimit({
    windowMs: 60_000,
    limit: authLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ code: 'rate_limited' }),
  });
  app.get(['/', '/health'], (req, res) => res.json({ status: 'ok' }));

  async function issueSession(user, res, status = 200) {
    const token = newSessionToken();
    const expiresAt = new Date(now().getTime() + SESSION_MS);
    await store.saveSession({ _id: tokenDigest(token), userId: user._id, expiresAt });
    res.status(status).json({ user: publicUser(user), token, expiresAt: expiresAt.toISOString() });
  }

  app.post('/v1/auth/register', authLimiter, async (req, res) => {
    const data = parse(registration, req.body);
    const user = {
      _id: randomUUID(),
      email: data.email,
      name: data.name,
      password: await hashPassword(data.password),
      createdAt: now(),
    };
    if (!await store.addUser(user)) throw new ApiError(409, 'email_in_use');
    await issueSession(user, res, 201);
  });

  app.post('/v1/auth/login', authLimiter, async (req, res) => {
    const data = parse(credentials, req.body);
    const user = await store.findUser(data.email);
    if (!user) {
      await hashPassword(data.password);
      throw new ApiError(401, 'invalid_credentials');
    }
    if (!await verifyPassword(data.password, user.password)) throw new ApiError(401, 'invalid_credentials');
    await issueSession(user, res);
  });

  app.use('/v1/', async (req, res, next) => {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('Authorization') ?? '');
    if (!match) throw new ApiError(401, 'session_expired');
    const digest = tokenDigest(match[1]);
    const session = await store.findSession(digest, now());
    if (!session) throw new ApiError(401, 'session_expired');
    const user = await store.findUserById(session.userId);
    if (!user) throw new ApiError(401, 'session_expired');
    req.account = { user, digest };
    next();
  });
  app.get('/v1/account', (req, res) => res.json({ user: publicUser(req.account.user) }));
  app.post('/v1/auth/logout', async (req, res) => {
    await store.deleteSession(req.account.digest);
    res.status(204).end();
  });
  app.put('/v1/profile', async (req, res) => {
    const profile = parse(profileSchema, req.body);
    validateProfile(profile);
    const savedAt = now().toISOString();
    await store.saveProfile(req.account.user._id, { ...profile, savedAt });
    res.json({ savedAt });
  });
  app.get('/v1/profile', async (req, res) => {
    const profile = await store.getProfile(req.account.user._id);
    if (!profile) throw new ApiError(404, 'profile_missing');
    res.json({ videoBrain: profile.videoBrain, musicBrain: profile.musicBrain, savedAt: profile.savedAt });
  });
  app.use((req, res) => res.status(404).json({ code: 'not_found' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof ApiError) return res.status(error.status).json({ code: error.code });
    if (error.type === 'entity.too.large') return res.status(413).json({ code: 'profile_too_large' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ code: 'invalid_input' });
    res.status(503).json({ code: 'service_unavailable' });
  });
  return app;
}
