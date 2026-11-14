import type { FastifySchemaValidationError } from 'fastify/types/schema';

// Fastify's built-in validation messages are in English and name fields like
// "body/password"; users see these, so they're rewritten in Portuguese.

const FIELD_LABELS: Record<string, string> = {
  name: 'Nome de exibição',
  email: 'E-mail',
  password: 'Senha',
  title: 'Nome',
  description: 'Descrição',
  category: 'Categoria',
  imageUrl: 'URL da imagem',
  startingPrice: 'Preço inicial',
  minIncrement: 'Incremento mínimo',
  durationMinutes: 'Duração (minutos)',
  q: 'Busca',
  id: 'ID',
};

const MONEY_FIELDS = new Set(['startingPrice', 'minIncrement']);

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function describe(error: FastifySchemaValidationError): string {
  const params = error.params as Record<string, unknown>;
  const field = error.instancePath.split('/').pop() || String(params.missingProperty ?? '');
  const label = `O campo “${FIELD_LABELS[field] ?? field}”`;
  const limit = Number(params.limit);
  const amount = MONEY_FIELDS.has(field) ? money.format(limit / 100) : limit;

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
