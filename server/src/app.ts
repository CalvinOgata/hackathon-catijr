import cors from '@fastify/cors';
import Fastify from 'fastify';
import { config } from './config';
import authPlugin from './plugins/auth';
import auctionRoutes from './routes/auctions';
import authRoutes from './routes/auth';
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
  await app.register(auctionRoutes, { prefix: '/api/auctions' });

  return app;
}
