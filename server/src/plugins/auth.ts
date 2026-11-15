import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { sessionExpired, useSession, type Session } from '../services/sessions';

declare module 'fastify' {
  interface FastifyInstance {
    /** onRequest hook for protected routes (RF02): requires a valid session and renews it. */
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    session: Session | null;
  }
}

export default fp(async (app) => {
  app.decorateRequest('session', null);

  app.decorate('authenticate', async (request: FastifyRequest) => {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    request.session = scheme === 'Bearer' && token ? useSession({ token }) : null;
    if (!request.session) throw sessionExpired();
  });
});
