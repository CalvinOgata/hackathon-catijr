import { config } from '../config';
import type { NewAuction } from './auctions';
import { detectPhotoType, type PhotoType } from './photos';

// Validates a "create auction" form (RF05) against the limits in config.ts (RF06).
// Multipart fields arrive as plain strings, so everything is parsed and checked here.

type Result = { ok: true; value: Omit<NewAuction, 'photos'>; photos: { data: Buffer; type: PhotoType }[] } | { ok: false; message: string };

const MINUTE = 60 * 1000;
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const megabytes = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

function formatMinutes(minutes: number): string {
  if (minutes % (24 * 60) === 0) return minutes === 24 * 60 ? '1 dia' : `${minutes / (24 * 60)} dias`;
  if (minutes % 60 === 0) return minutes === 60 ? '1 hora' : `${minutes / 60} horas`;
  return minutes === 1 ? '1 minuto' : `${minutes} minutos`;
}

/** Whole number of cents within the price limits, or an error message. */
function parsePrice(value: string | undefined, label: string): number | string {
  const { min, max } = config.listing.price;
  const cents = Number(value);
  if (!value || !Number.isInteger(cents)) return `Informe o ${label} em centavos (número inteiro)`;
  if (cents < min || cents > max) return `O ${label} deve ser de ${money.format(min / 100)} a ${money.format(max / 100)}`;
  return cents;
}

export function validateListing(fields: Record<string, string>, files: Buffer[], now = Date.now()): Result {
  const rules = config.listing;
  const fail = (message: string): Result => ({ ok: false, message });

  const title = (fields.title ?? '').trim().replace(/\s+/g, ' ');
  if (title.length < rules.titleLength.min || title.length > rules.titleLength.max) {
    return fail(`O nome deve ter de ${rules.titleLength.min} a ${rules.titleLength.max} caracteres`);
  }

  const description = (fields.description ?? '').trim();
  if (description.length < rules.descriptionLength.min || description.length > rules.descriptionLength.max) {
    return fail(`A descrição deve ter de ${rules.descriptionLength.min} a ${rules.descriptionLength.max} caracteres`);
  }

  const category = fields.category ?? '';
  if (!rules.categories.includes(category)) return fail('Escolha uma categoria da lista');

  const startingPrice = parsePrice(fields.startingPrice, 'preço inicial');
  if (typeof startingPrice === 'string') return fail(startingPrice);
  const minIncrement = parsePrice(fields.minIncrement, 'incremento mínimo');
  if (typeof minIncrement === 'string') return fail(minIncrement);

  const durationMinutes = Number(fields.durationMinutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes < rules.durationMinutes.min || durationMinutes > rules.durationMinutes.max) {
    return fail(`A duração deve ser de ${formatMinutes(rules.durationMinutes.min)} a ${formatMinutes(rules.durationMinutes.max)}`);
  }

  // The server's clock is the one that counts (RF16). No start time means "as soon as allowed".
  const earliest = now + rules.leadMinutes.min * MINUTE;
  const latest = now + rules.leadMinutes.max * MINUTE;
  let startsAt = earliest;
  if (fields.startsAt) {
    startsAt = Date.parse(fields.startsAt);
    if (Number.isNaN(startsAt)) return fail('Horário de início inválido');
    if (startsAt < earliest) return fail(`O leilão deve começar daqui a pelo menos ${formatMinutes(rules.leadMinutes.min)}`);
    if (startsAt > latest) return fail(`O leilão deve começar em no máximo ${formatMinutes(rules.leadMinutes.max)}`);
  }

  if (files.length < rules.photos.min || files.length > rules.photos.max) {
    return fail(`Envie de ${rules.photos.min} a ${rules.photos.max} fotos`);
  }
  const photos: { data: Buffer; type: PhotoType }[] = [];
  for (const [index, data] of files.entries()) {
    const type = detectPhotoType(data);
    if (!type || !rules.photos.types.includes(type)) return fail(`A foto ${index + 1} não é uma imagem JPEG, PNG ou WebP`);
    if (data.length > rules.photos.maxBytes) return fail(`A foto ${index + 1} passa de ${megabytes(rules.photos.maxBytes)}`);
    photos.push({ data, type });
  }

  return {
    ok: true,
    value: { title, description, category, startingPrice, minIncrement, startsAt, durationMinutes },
    photos,
  };
}

export const photoTooLargeMessage = () => `Cada foto pode ter no máximo ${megabytes(config.listing.photos.maxBytes)}`;
export const tooManyPhotosMessage = () => `Envie no máximo ${config.listing.photos.max} fotos`;
