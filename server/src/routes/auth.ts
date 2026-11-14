import type { AuthResponse, PublicUser } from '@auction/shared';
import type { FastifyInstance } from 'fastify';
import { hashPassword, verifyPassword } from '../services/passwords';
import { createSession, deleteSession } from '../services/sessions';
import { createUser, EmailTakenError, findUserByEmail, findUserById } from '../services/users';

interface SignupBody {
  name: string;
  email: string;
  password: string;
}

type LoginBody = Omit<SignupBody, 'name'>;

const NAME_LENGTH = { min: 2, max: 60 };

const emailSchema = { type: 'string', format: 'email', maxLength: 254 } as const;

const signupSchema = {
  type: 'object',
  required: ['name', 'email', 'password'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', maxLength: 200 }, // real limits are checked after trimming
    email: emailSchema,
    password: { type: 'string', minLength: 8, maxLength: 128 },
  },
} as const;

const loginSchema = {
  type: 'object',
  required: ['email', 'password'],
  additionalProperties: false,
  properties: {
    email: emailSchema,
    password: { type: 'string', minLength: 1, maxLength: 128 },
  },
} as const;

const startSession = (user: PublicUser): AuthResponse => ({ token: createSession(user.id), user });

export default async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: SignupBody }>('/signup', { schema: { body: signupSchema } }, async (request, reply) => {
    const name = request.body.name.trim().replace(/\s+/g, ' ');
    if (name.length < NAME_LENGTH.min || name.length > NAME_LENGTH.max) {
      return reply.code(400).send({ message: `Display name must have ${NAME_LENGTH.min} to ${NAME_LENGTH.max} characters` });
    }

    try {
      const user = createUser({ name, email: request.body.email, passwordHash: await hashPassword(request.body.password) });
      return reply.code(201).send(startSession(user));
    } catch (err) {
      if (err instanceof EmailTakenError) {
        return reply.code(409).send({ message: 'An account with this email already exists' });
      }
      throw err;
    }
  });

  app.post<{ Body: LoginBody }>('/login', { schema: { body: loginSchema } }, async (request, reply) => {
    const user = findUserByEmail(request.body.email);

    if (!user || !(await verifyPassword(request.body.password, user.passwordHash))) {
      return reply.code(401).send({ message: 'Invalid email or password' });
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
    if (!user) return reply.code(401).send({ message: 'Unauthorized' });
    return user;
  });
}
