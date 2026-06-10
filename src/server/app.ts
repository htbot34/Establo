import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { registerApiRoutes } from './routes/api.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerSimulatorRoutes } from './routes/simulator.js';
import { registerStripeRoutes } from './routes/stripe.js';
import { registerWebhookRoutes } from './routes/webhooks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_WEB = path.resolve(__dirname, '../../dist/web');

export async function buildApp(): Promise<FastifyInstance> {
  const cfg = config();
  const app = Fastify({
    logger: cfg.isProduction
      ? true
      : { level: 'warn' },
    trustProxy: true,
  });

  await app.register(fastifyCookie, { secret: cfg.sessionSecret });
  await app.register(fastifyFormbody);
  await app.register(fastifyMultipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 24 },
  });

  app.get('/healthz', async () => ({
    ok: true,
    mode: cfg.runMode,
    time: new Date().toISOString(),
  }));

  registerWebhookRoutes(app);
  registerMediaRoutes(app);
  registerAuthRoutes(app);
  registerStripeRoutes(app);
  await app.register(async (scope) => registerApiRoutes(scope));
  if (cfg.isMock) {
    await app.register(async (scope) => registerSimulatorRoutes(scope));
  }

  // Serve the built dashboard at /app (production / after `pnpm build`).
  if (fs.existsSync(path.join(DIST_WEB, 'index.html'))) {
    await app.register(fastifyStatic, { root: DIST_WEB, prefix: '/app/' });
    app.get('/app', (_req, reply) => reply.sendFile('index.html'));
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && req.url.startsWith('/app/') && !req.url.includes('.')) {
        return reply.sendFile('index.html'); // SPA fallback
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  app.get('/', (_req, reply) => reply.redirect('/app'));

  return app;
}
