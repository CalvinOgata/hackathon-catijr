import { DELETE_ACCOUNT_CONFIRMATION, type AccountDeletionBlockers } from '@auction/shared';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors';
import { accountDeletionBlockers } from '../services/auctions';
import { checkPassword } from '../services/loginAttempts';
import { hashPassword } from '../services/passwords';
import { anonymizeUser, checkNewPassword, getUser, parseDisplayName, toPublicUser, updateUser } from '../services/users';
import { body, newPassword, password, text } from '../validation';

// "Minha conta": the logged-in user's own data. The email identifies the account (RF01),
// so it can't be changed here.

function blockersMessage({ auctions, bids }: AccountDeletionBlockers): string {
  const parts: string[] = [];
  if (auctions.length) parts.push(auctions.length === 1 ? '1 leilão seu ativo' : `${auctions.length} leilões seus ativos`);
  if (bids.length) parts.push(bids.length === 1 ? 'lances em 1 leilão em andamento' : `lances em ${bids.length} leilões em andamento`);
  return `Você ainda tem ${parts.join(' e ')}. Cancele ou aguarde o fim deles para excluir a conta.`;
}

export default async function accountRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  app.patch<{ Body: { name: string } }>('/', { schema: { body: body({ name: text(200) }) } }, async (request) =>
    toPublicUser(updateUser(request.session!.user.id, { name: parseDisplayName(request.body.name) })),
  );

  app.put<{ Body: { currentPassword: string; newPassword: string } }>(
    '/password',
    { schema: { body: body({ currentPassword: password, newPassword }) } },
    async (request, reply) => {
      const { currentPassword, newPassword } = request.body;
      const session = request.session!;
      const user = getUser(session.user.id);

      checkNewPassword(newPassword);
      if (newPassword === currentPassword) throw new AppError(400, 'A nova senha deve ser diferente da atual');
      await checkPassword(user.email, currentPassword, user.passwordHash, { status: 403, message: 'Senha atual incorreta.' });

      updateUser(user.id, { passwordHash: await hashPassword(newPassword) });
      // Anyone else logged in with the old password is logged out; this session stays
      app.endSessions((other) => other.userId === user.id && other.id !== session.id);
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
    { schema: { body: body({ password, confirmation: text(50) }) } },
    async (request, reply) => {
      const user = getUser(request.session!.user.id);
      if (request.body.confirmation !== DELETE_ACCOUNT_CONFIRMATION) {
        throw new AppError(400, `Digite ${DELETE_ACCOUNT_CONFIRMATION} para confirmar`);
      }
      await checkPassword(user.email, request.body.password, user.passwordHash, { status: 403, message: 'Senha incorreta.' });

      // Checked after the (slow) password check and right before deleting, in the same
      // synchronous step: a bid or auction created meanwhile is always taken into account
      const blockers = accountDeletionBlockers(user.id);
      if (blockers.auctions.length || blockers.bids.length) throw new AppError(409, blockersMessage(blockers), { blockers });

      app.endSessions((session) => session.userId === user.id);
      anonymizeUser(user.id);
      request.log.info({ userId: user.id }, 'Account deleted');
      return reply.code(204).send();
    },
  );
}
