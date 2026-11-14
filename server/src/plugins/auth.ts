import { SESSION_INVALID } from '@auction/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { useSessionByToken, type Session } from '../services/sessions';

declare module 'fastify' {
  interface FastifyInstance {
    /** onRequest hook for protected routes (RF02): requires a valid session and renews it. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    session: Session | null;
  }
}

export function bearerToken(request: FastifyRequest): string | null {
  const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
  return scheme === 'Bearer' && token ? token : null;
}

export default fp(async (app) => {
  app.decorateRequest('session', null);

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = bearerToken(request);
    request.session = token ? useSessionByToken(token) : null;
    if (!request.session) {
      await reply.code(401).send({ message: 'Your session has expired. Please log in again.', code: SESSION_INVALID });
    }
  });
});
