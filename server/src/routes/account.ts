import { DELETE_ACCOUNT_CONFIRMATION, normalizeDisplayName, PASSWORD_LENGTH, type AccountDeletionBlockers } from '@auction/shared';
import type { FastifyInstance } from 'fastify';
import { accountDeletionBlockers } from '../services/auctions';
import { cancelAttempt, finishAttempt, remainingMessage, startAttempt } from '../services/loginAttempts';
import { hashPassword, verifyPassword } from '../services/passwords';
import { deleteUserSessions } from '../services/sessions';
import { anonymizeUser, findUserById, getPasswordHash, updatePasswordHash, updateUserName } from '../services/users';
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

const deleteSchema = {
  type: 'object',
  required: ['password', 'confirmation'],
  additionalProperties: false,
  properties: {
    password: { type: 'string', minLength: 1, maxLength: PASSWORD_LENGTH.max },
    confirmation: { type: 'string', maxLength: 50 },
  },
} as const;

function blockersMessage({ auctions, bids }: AccountDeletionBlockers): string {
  const parts: string[] = [];
  if (auctions.length) parts.push(auctions.length === 1 ? '1 leilão seu ativo' : `${auctions.length} leilões seus ativos`);
  if (bids.length) parts.push(bids.length === 1 ? 'lances em 1 leilão em andamento' : `lances em ${bids.length} leilões em andamento`);
  return `Você ainda tem ${parts.join(' e ')}. Cancele ou aguarde o fim deles para excluir a conta.`;
}

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
      for (const sessionId of deleteUserSessions(user.id, session.id)) app.endSocketSession(sessionId);

      return reply.code(204).send();
    },
  );

  // What still prevents deleting the account, so the page can explain it up front
  app.get('/deletion-check', async (request): Promise<AccountDeletionBlockers> => accountDeletionBlockers(request.session!.user.id));

  // Team decision: a user can delete their account when nothing is still open (no active
  // auctions of theirs, no bids in live auctions), after retyping the password and typing
  // "DELETAR". The account is anonymized, not erased: see anonymizeUser().
  app.post<{ Body: { password: string; confirmation: string } }>(
    '/delete',
    { schema: { body: deleteSchema } },
    async (request, reply) => {
      const session = request.session!;
      const user = findUserById(session.user.id)!;

      if (request.body.confirmation !== DELETE_ACCOUNT_CONFIRMATION) {
        return reply.code(400).send({ message: `Digite ${DELETE_ACCOUNT_CONFIRMATION} para confirmar` });
      }

      // A wrong password counts toward the same limit as logins
      const start = startAttempt(user.email);
      if (!start.allowed) return sendLocked(reply, start.retryAfterMs);

      let valid: boolean;
      try {
        valid = await verifyPassword(request.body.password, getPasswordHash(user.id)!);
      } catch (err) {
        cancelAttempt(user.email);
        throw err;
      }

      const outcome = finishAttempt(user.email, valid);
      if (!valid) {
        if (outcome.locked) return sendLocked(reply, outcome.retryAfterMs);
        return reply.code(403).send({ message: `Senha incorreta. ${remainingMessage(outcome.remaining)}` });
      }

      // Checked after the (slow) password check and right before deleting, in the same
      // synchronous step: a bid or auction created meanwhile is always taken into account
      const blockers = accountDeletionBlockers(user.id);
      if (blockers.auctions.length || blockers.bids.length) {
        return reply.code(409).send({ message: blockersMessage(blockers), blockers });
      }

      for (const sessionId of deleteUserSessions(user.id)) app.endSocketSession(sessionId);
      anonymizeUser(user.id);
      request.log.info({ userId: user.id }, 'Account deleted');
      return reply.code(204).send();
    },
  );
}
