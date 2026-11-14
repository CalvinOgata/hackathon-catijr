import cors from '@fastify/cors';
import Fastify from 'fastify';
import { config } from './config';
import authPlugin from './plugins/auth';
import auctionRoutes from './routes/auctions';
import authRoutes from './routes/auth';
import { registerSocket } from './socket';

export async function buildApp() {
  const app = Fastify({ logger: { level: config.isProduction ? 'info' : 'debug' } });

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(authPlugin);
  registerSocket(app);

  app.get('/api/health', async () => ({ ok: true }));
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(auctionRoutes, { prefix: '/api/auctions' });

  return app;
}
