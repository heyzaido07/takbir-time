// Global BigInt → string serializer.
// Prisma returns BigInt for columns like Mosque.osmId (OSM IDs can exceed
// JS safe integer range). Without this, JSON.stringify throws on any
// response that includes such a column. Stringifying preserves precision.
(BigInt.prototype as any).toJSON = function () { return this.toString(); };

import express, { Express } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import mosqueRoutes from './routes/mosques';
import userRoutes from './routes/users';
import submissionRoutes from './routes/submissions';
import scheduleRoutes from './routes/schedules';
import suggestionRoutes from './routes/suggestions';
import adminRoutes from './routes/admin';
import accountDeletionRoutes from './routes/accountDeletion';
import discoveryRoutes from './routes/discovery';
import qazaRoutes from './routes/qaza';
import geocodeRoutes from './routes/geocode';
import darsRoutes from './routes/dars';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';

// Load environment variables
dotenv.config();

// SECURITY GATE: dev-auth bypass MUST be off in production. Without this
// guard, a misconfigured prod env that leaves DEV_AUTH_USER_EMAIL set
// would let any client send `X-Dev-User-Email: <victim>` and be
// authenticated as that user — total impersonation. Refuse to boot
// rather than serve traffic with the bypass active.
if (process.env.NODE_ENV === 'production' && process.env.DEV_AUTH_USER_EMAIL) {
  // eslint-disable-next-line no-console
  console.error(
    'FATAL: DEV_AUTH_USER_EMAIL is set in production. The dev-auth bypass would let any client impersonate any user via the X-Dev-User-Email header. Unset DEV_AUTH_USER_EMAIL in your environment and redeploy.'
  );
  process.exit(1);
}

const app: Express = express();
const PORT = process.env.PORT || 3001;
const WRITE_ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',')
  .map(origin => origin.trim())
  .filter(Boolean)
  || ['http://localhost:8000', 'http://localhost:3000'];

function isOpenReadRequest(req: express.Request): boolean {
  const requestedMethod = req.method === 'OPTIONS'
    ? String(req.headers['access-control-request-method'] || '').toUpperCase()
    : req.method;
  if (requestedMethod !== 'GET') return false;
  return req.path === '/health'
    || req.path === '/api'
    || req.path.startsWith('/api/mosques')
    || req.path.startsWith('/api/geocode');
}

// Middleware
app.use((req, res, next) => {
  const openRead = isOpenReadRequest(req);
  return cors({
    origin: openRead ? '*' : WRITE_ALLOWED_ORIGINS,
    credentials: !openRead,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Dev-User-Email', 'X-Test-User-Id'],
  })(req, res, next);
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(requestLogger);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API Routes
app.use('/api', discoveryRoutes);
// Auth is mounted first because nothing else depends on it (it issues
// the bearer tokens used everywhere else); register/login/google are
// public — they don't go through the authenticate middleware.
app.use('/api/auth', authRoutes);
app.use('/api/mosques', mosqueRoutes);
app.use('/api/users', userRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/suggestions', suggestionRoutes);
app.use('/api/qaza', qazaRoutes);
app.use('/api/dars', darsRoutes);
app.use('/api/geocode', geocodeRoutes);
app.use('/api/admin', adminRoutes);
// Public, no-auth-required account deletion request form. Mounted as a
// top-level route (not under /users) because it is intentionally
// unauthenticated — see routes/accountDeletion.ts for why.
app.use('/api/account-deletion-request', accountDeletionRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Error handler (must be last)
app.use(errorHandler);

// Only listen if this file is the process entry point. When tests
// `import app from '../index'`, we don't want a second listen() to fight
// the dev server for the port (or fight with itself when multiple test
// files import).
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔥 Health check: http://localhost:${PORT}/health`);
  });
}

export default app;
