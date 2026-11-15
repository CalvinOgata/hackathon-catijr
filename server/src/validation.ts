import { formatMoney, PASSWORD_LENGTH } from '@auction/shared';
import type { FastifySchemaValidationError } from 'fastify/types/schema';

// Request schemas: every body field listed is required, and nothing else is allowed.
export const body = (properties: Record<string, object>) => ({ type: 'object', required: Object.keys(properties), additionalProperties: false, properties });

export const text = (maxLength: number, minLength = 0) => ({ type: 'string', minLength, maxLength });

export const email = { type: 'string', format: 'email', maxLength: 254 };
/** A password being chosen: the full policy is checked after (`checkNewPassword`), with a clearer message. */
export const newPassword = text(PASSWORD_LENGTH.max);
/** A password being typed to prove who you are. */
export const password = text(PASSWORD_LENGTH.max, 1);

export const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } };

// Fastify's built-in validation messages are in English and name fields like
// "body/password"; users see these, so they're rewritten in Portuguese.

const FIELD_LABELS: Record<string, string> = {
  name: 'Nome de exibição',
  email: 'E-mail',
  password: 'Senha',
  currentPassword: 'Senha atual',
  newPassword: 'Nova senha',
  title: 'Nome',
  description: 'Descrição',
  category: 'Categoria',
  startingPrice: 'Preço inicial',
  durationMinutes: 'Duração (minutos)',
  q: 'Busca',
  id: 'ID',
};

const MONEY_FIELDS = new Set(['startingPrice']);

function describe(error: FastifySchemaValidationError): string {
  const params = error.params as Record<string, unknown>;
  const field = error.instancePath.split('/').pop() || String(params.missingProperty ?? '');
  const label = `O campo “${FIELD_LABELS[field] ?? field}”`;
  const limit = Number(params.limit);
  const amount = MONEY_FIELDS.has(field) ? formatMoney(limit) : limit;

  switch (error.keyword) {
    case 'required':
      return `${label} é obrigatório`;
    case 'minLength':
      return `${label} deve ter no mínimo ${limit} caracteres`;
    case 'maxLength':
      return `${label} deve ter no máximo ${limit} caracteres`;
    case 'minimum':
      return `${label} deve ser no mínimo ${amount}`;
    case 'maximum':
      return `${label} deve ser no máximo ${amount}`;
    case 'type':
      return params.type === 'integer' ? `${label} deve ser um número inteiro` : `${label} tem um tipo inválido`;
    case 'additionalProperties':
      return `Campo não permitido: ${String(params.additionalProperty)}`;
    default: // format, pattern, enum, …
      return `${label} é inválido`;
  }
}

export const formatValidationErrors = (errors: FastifySchemaValidationError[]) => new Error(describe(errors[0]!));
