import { normalizeDisplayName, PASSWORD_LENGTH } from '@auction/shared';
import type { FastifyInstance } from 'fastify';
import { cancelAttempt, finishAttempt, remainingMessage, startAttempt } from '../services/loginAttempts';
import { hashPassword, verifyPassword } from '../services/passwords';
import { deleteOtherSessions } from '../services/sessions';
import { findUserById, getPasswordHash, updatePasswordHash, updateUserName } from '../services/users';
import { displayNameProblem, passwordProblem, sendLocked } from './auth';

// "Minha conta": the logged-in user's own data. The email identifies the account (RF01),
// so it can't be changed here.

const updateSchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: { name: { type: 'string', maxLength: 200 } },
} as const;

const passwordSchema = {
  type: 'object',
  required: ['currentPassword', 'newPassword'],
  additionalProperties: false,
  properties: {
    currentPassword: { type: 'string', minLength: 1, maxLength: PASSWORD_LENGTH.max },
    newPassword: { type: 'string', maxLength: PASSWORD_LENGTH.max },
  },
} as const;

export default async function accountRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  app.patch<{ Body: { name: string } }>('/', { schema: { body: updateSchema } }, async (request, reply) => {
    const name = normalizeDisplayName(request.body.name);
    const problem = displayNameProblem(name);
    if (problem) return reply.code(400).send({ message: problem });
    return updateUserName(request.session!.user.id, name);
  });

  app.put<{ Body: { currentPassword: string; newPassword: string } }>(
    '/password',
    { schema: { body: passwordSchema } },
    async (request, reply) => {
      const { currentPassword, newPassword } = request.body;
      const session = request.session!;
      const user = findUserById(session.user.id)!;

      const problem =
        passwordProblem(newPassword) ?? (newPassword === currentPassword ? 'A nova senha deve ser diferente da atual' : null);
      if (problem) return reply.code(400).send({ message: problem });

      // Guessing the current password from a hijacked session counts toward the same limit as logins
      const start = startAttempt(user.email);
      if (!start.allowed) return sendLocked(reply, start.retryAfterMs);

      let valid: boolean;
      try {
        valid = await verifyPassword(currentPassword, getPasswordHash(user.id)!);
      } catch (err) {
        cancelAttempt(user.email);
        throw err;
      }

      const outcome = finishAttempt(user.email, valid);
      if (!valid) {
        if (outcome.locked) return sendLocked(reply, outcome.retryAfterMs);
        return reply.code(403).send({ message: `Senha atual incorreta. ${remainingMessage(outcome.remaining)}` });
      }

      updatePasswordHash(user.id, await hashPassword(newPassword));

      // Anyone else logged in with the old password is logged out; this session stays
      for (const sessionId of deleteOtherSessions(user.id, session.id)) app.endSocketSession(sessionId);

      return reply.code(204).send();
    },
  );
}
