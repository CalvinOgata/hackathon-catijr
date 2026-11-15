import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError } from 'fastify';
import { config } from './config';
import { AppError } from './errors';
import { registerJobs } from './jobs';
import authPlugin from './plugins/auth';
import accountRoutes from './routes/account';
import auctionRoutes from './routes/auctions';
import authRoutes from './routes/auth';
import { PHOTO_URL_PREFIX, PHOTOS_DIR } from './services/photos';
import { registerSocket } from './socket';
import { formatValidationErrors } from './validation';

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.isProduction ? 'info' : 'debug' },
    schemaErrorFormatter: formatValidationErrors,
  });

  // Refusals (AppError, invalid requests) are answered with their message; unexpected errors are
  // logged and the user gets a generic message
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error(error);
      return reply.code(status).send({ message: 'Erro interno do servidor. Tente novamente.' });
    }
    if (error instanceof AppError) return reply.code(status).headers(error.headers).send({ message: error.message, ...error.extra });
    return reply.code(status).send({ message: error.message });
  });

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(authPlugin);
  registerSocket(app);

  app.get('/api/health', async () => ({ ok: true }));
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(accountRoutes, { prefix: '/api/account' });
  await app.register(auctionRoutes, { prefix: '/api/auctions' });

  // Uploaded photos, from the VM's disk. Their names are random and never reused, so they're cached for good.
  await app.register(fastifyStatic, {
    root: PHOTOS_DIR,
    prefix: PHOTO_URL_PREFIX,
    decorateReply: false,
    maxAge: '365d',
    immutable: true,
    setHeaders: (res) => res.header('x-content-type-options', 'nosniff'),
  });

  registerJobs(app);

  // On the VM, this process also serves the built web app, so everything is one service on one
  // port (RNF01). In development the client runs on Vite's dev server instead.
  if (existsSync(join(config.clientDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: config.clientDir,
      preCompressed: true, // the build ships .br/.gz copies of each file
      setHeaders: (res, path) => {
        // File names under _app/immutable change with their content; the page itself must not be cached
        res.header('cache-control', path.includes('/_app/immutable/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    // Any other page is a route of the single-page app (e.g. /auctions/3)
    app.setNotFoundHandler((request, reply) => {
      const isPage = request.method === 'GET' && !request.url.startsWith('/api/') && !request.url.startsWith('/socket.io');
      if (isPage) return reply.header('cache-control', 'no-cache').sendFile('index.html');
      return reply.code(404).send({ message: 'Não encontrado' });
    });
    app.log.info(`Serving the web app from ${config.clientDir}`);
  }

  return app;
}
