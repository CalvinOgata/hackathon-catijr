import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { config } from './config';
import { registerLifecycle } from './lifecycle';
import authPlugin from './plugins/auth';
import accountRoutes from './routes/account';
import auctionRoutes from './routes/auctions';
import authRoutes from './routes/auth';
import photoRoutes from './routes/photos';
import { registerSocket } from './socket';
import { formatValidationErrors } from './validation';

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.isProduction ? 'info' : 'debug' },
    schemaErrorFormatter: formatValidationErrors,
  });

  // Unexpected errors: log the details, show the user a generic message
  app.setErrorHandler((error: { statusCode?: number; message: string }, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) request.log.error(error);
    return reply.code(status).send({ message: status >= 500 ? 'Erro interno do servidor. Tente novamente.' : error.message });
  });

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(authPlugin);
  registerSocket(app);

  app.get('/api/health', async () => ({ ok: true }));
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(accountRoutes, { prefix: '/api/account' });
  await app.register(auctionRoutes, { prefix: '/api/auctions' });
  await app.register(photoRoutes, { prefix: '/api/photos' });

  registerLifecycle(app);

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
