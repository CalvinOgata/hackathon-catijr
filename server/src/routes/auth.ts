import {
  DISPLAY_NAME_LENGTH,
  normalizeDisplayName,
  PASSWORD_LENGTH,
  passwordProblems,
  type AuthResponse,
  type PublicUser,
} from '@auction/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { cancelAttempt, finishAttempt, lockedMessage, pruneLoginAttempts, remainingMessage, startAttempt } from '../services/loginAttempts';
import { hashForMissingUser, hashPassword, verifyPassword } from '../services/passwords';
import { createSession, deleteSession } from '../services/sessions';
import { createUser, EmailTakenError, findUserByEmail, findUserById, normalizeEmail } from '../services/users';

interface SignupBody {
  name: string;
  email: string;
  password: string;
}

type LoginBody = Omit<SignupBody, 'name'>;

const emailSchema = { type: 'string', format: 'email', maxLength: 254 } as const;

const signupSchema = {
  type: 'object',
  required: ['name', 'email', 'password'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', maxLength: 200 }, // real limits are checked after normalizing
    email: emailSchema,
    password: { type: 'string', maxLength: PASSWORD_LENGTH.max }, // full policy checked below
  },
} as const;

const loginSchema = {
  type: 'object',
  required: ['email', 'password'],
  additionalProperties: false,
  properties: {
    email: emailSchema,
    password: { type: 'string', minLength: 1, maxLength: PASSWORD_LENGTH.max },
  },
} as const;

const startSession = (user: PublicUser): AuthResponse => ({ token: createSession(user.id), user });

/** Returns an error message when the display name is out of bounds. */
export function displayNameProblem(name: string): string | null {
  return name.length < DISPLAY_NAME_LENGTH.min || name.length > DISPLAY_NAME_LENGTH.max
    ? `O nome de exibição deve ter de ${DISPLAY_NAME_LENGTH.min} a ${DISPLAY_NAME_LENGTH.max} caracteres`
    : null;
}

/** Returns an error message when the password breaks the policy. */
export function passwordProblem(password: string): string | null {
  const problems = passwordProblems(password);
  return problems.length ? `A senha precisa ter: ${problems.map((p) => p.toLowerCase()).join(', ')}` : null;
}

export function sendLocked(reply: FastifyReply, retryAfterMs: number) {
  return reply
    .code(429)
    .header('Retry-After', Math.ceil(retryAfterMs / 1000))
    .send({ message: lockedMessage(retryAfterMs) });
}

export default async function authRoutes(app: FastifyInstance) {
  const prune = setInterval(pruneLoginAttempts, 60_000);
  app.addHook('onClose', async () => clearInterval(prune));

  app.post<{ Body: SignupBody }>('/signup', { schema: { body: signupSchema } }, async (request, reply) => {
    const name = normalizeDisplayName(request.body.name);
    const problem = displayNameProblem(name) ?? passwordProblem(request.body.password);
    if (problem) return reply.code(400).send({ message: problem });

    try {
      const user = createUser({ name, email: request.body.email, passwordHash: await hashPassword(request.body.password) });
      return reply.code(201).send(startSession(user));
    } catch (err) {
      if (err instanceof EmailTakenError) {
        return reply.code(409).send({ message: 'Já existe uma conta com este e-mail' });
      }
      throw err;
    }
  });

  app.post<{ Body: LoginBody }>('/login', { schema: { body: loginSchema } }, async (request, reply) => {
    const email = normalizeEmail(request.body.email);

    const start = startAttempt(email);
    if (!start.allowed) return sendLocked(reply, start.retryAfterMs);

    const user = findUserByEmail(email);
    let valid: boolean;
    try {
      valid = await verifyPassword(request.body.password, user?.passwordHash ?? (await hashForMissingUser()));
    } catch (err) {
      cancelAttempt(email); // a server error is not a wrong password
      throw err;
    }

    const outcome = finishAttempt(email, valid && !!user);
    if (!user || !valid) {
      if (outcome.locked) return sendLocked(reply, outcome.retryAfterMs);
      return reply.code(401).send({ message: `E-mail ou senha inválidos. ${remainingMessage(outcome.remaining)}` });
    }

    const { passwordHash: _, ...publicUser } = user;
    return startSession(publicUser);
  });

  app.post('/logout', { onRequest: [app.authenticate] }, async (request, reply) => {
    const session = request.session!;
    deleteSession(session.id);
    app.endSocketSession(session.id);
    return reply.code(204).send();
  });

  app.get('/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = findUserById(request.session!.user.id);
    if (!user) return reply.code(401).send({ message: 'Não autorizado' });
    return user;
  });
}
