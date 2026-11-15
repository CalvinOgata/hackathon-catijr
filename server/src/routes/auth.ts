import type { AuthResponse } from '@auction/shared';
import type { FastifyInstance } from 'fastify';
import { checkPassword } from '../services/loginAttempts';
import { hashPassword } from '../services/passwords';
import { createSession } from '../services/sessions';
import { checkNewPassword, createUser, findUserByEmail, getUser, normalizeEmail, parseDisplayName, toPublicUser } from '../services/users';
import type { UserRecord } from '../store';
import { body, email, newPassword, password, text } from '../validation';

const startSession = (user: UserRecord): AuthResponse => ({ token: createSession(user.id), user: toPublicUser(user) });

export default async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { name: string; email: string; password: string } }>(
    '/signup',
    // The name's real limits are checked after normalizing it
    { schema: { body: body({ name: text(200), email, password: newPassword }) } },
    async (request, reply) => {
      const name = parseDisplayName(request.body.name);
      checkNewPassword(request.body.password);
      const user = createUser({ name, email: request.body.email, passwordHash: await hashPassword(request.body.password) });
      return reply.code(201).send(startSession(user));
    },
  );

  app.post<{ Body: { email: string; password: string } }>('/login', { schema: { body: body({ email, password }) } }, async (request) => {
    const address = normalizeEmail(request.body.email);
    const user = findUserByEmail(address);
    await checkPassword(address, request.body.password, user?.passwordHash, { status: 401, message: 'E-mail ou senha inválidos.' });
    return startSession(user!);
  });

  app.post('/logout', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.session!;
    app.endSessions((session) => session.id === id);
    return reply.code(204).send();
  });

  app.get('/me', { onRequest: [app.authenticate] }, async (request) => toPublicUser(getUser(request.session!.user.id)));
}
