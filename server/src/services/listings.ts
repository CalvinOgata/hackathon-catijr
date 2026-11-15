import { formatDuration, formatMegabytes, formatMoney, MINUTE, type Auction } from '@auction/shared';
import { config } from '../config';
import { AppError } from '../errors';
import { createAuction } from './auctions';
import { deletePhotos, detectPhotoType, savePhotos } from './photos';

// Creating an auction from the "Anunciar item" form (RF05), checked against the limits in
// config.ts (RF06). Multipart fields arrive as plain strings, so everything is parsed here.

const invalid = (message: string) => new AppError(400, message);

function validateListing(fields: Record<string, string>, files: Buffer[], now: number) {
  const rules = config.listing;
  const between = (value: number, { min, max }: { min: number; max: number }) => value >= min && value <= max;

  const title = (fields.title ?? '').trim().replace(/\s+/g, ' ');
  if (!between(title.length, rules.titleLength)) {
    throw invalid(`O nome deve ter de ${rules.titleLength.min} a ${rules.titleLength.max} caracteres`);
  }

  const description = (fields.description ?? '').trim();
  if (!between(description.length, rules.descriptionLength)) {
    throw invalid(`A descrição deve ter de ${rules.descriptionLength.min} a ${rules.descriptionLength.max} caracteres`);
  }

  const category = fields.category ?? '';
  if (!rules.categories.includes(category)) throw invalid('Escolha uma categoria da lista');

  const startingPrice = Number(fields.startingPrice);
  if (!fields.startingPrice || !Number.isInteger(startingPrice)) throw invalid('Informe o preço inicial em centavos (número inteiro)');
  if (!between(startingPrice, rules.price)) {
    throw invalid(`O preço inicial deve ser de ${formatMoney(rules.price.min)} a ${formatMoney(rules.price.max)}`);
  }

  const durationMinutes = Number(fields.durationMinutes);
  if (!Number.isInteger(durationMinutes) || !between(durationMinutes, rules.durationMinutes)) {
    throw invalid(`A duração deve ser de ${formatDuration(rules.durationMinutes.min)} a ${formatDuration(rules.durationMinutes.max)}`);
  }

  // The server's clock is the one that counts (RF16). No start time means "as soon as allowed".
  const earliest = now + rules.leadMinutes.min * MINUTE;
  let startsAt = earliest;
  if (fields.startsAt) {
    startsAt = Date.parse(fields.startsAt);
    if (Number.isNaN(startsAt)) throw invalid('Horário de início inválido');
    if (startsAt < earliest) throw invalid(`O leilão deve começar daqui a pelo menos ${formatDuration(rules.leadMinutes.min)}`);
    if (startsAt > now + rules.leadMinutes.max * MINUTE) throw invalid(`O leilão deve começar em no máximo ${formatDuration(rules.leadMinutes.max)}`);
  }

  if (!between(files.length, rules.photos)) throw invalid(`Envie de ${rules.photos.min} a ${rules.photos.max} fotos`);
  const photos = files.map((data, index) => {
    const type = detectPhotoType(data);
    if (!type || !rules.photos.types.includes(type)) throw invalid(`A foto ${index + 1} não é uma imagem JPEG, PNG ou WebP`);
    if (data.length > rules.photos.maxBytes) throw invalid(`A foto ${index + 1} passa de ${formatMegabytes(rules.photos.maxBytes)}`);
    return { data, type };
  });

  return { title, description, category, startingPrice, startsAt, durationMinutes, photos };
}

/** Validates the form, saves the photos (only once everything is valid) and creates the auction. */
export function createListing(sellerId: number, fields: Record<string, string>, files: Buffer[], now = Date.now()): Auction {
  const { photos, ...listing } = validateListing(fields, files, now);
  const urls = savePhotos(photos);
  try {
    return createAuction(sellerId, { ...listing, photos: urls });
  } catch (err) {
    deletePhotos(urls);
    throw err;
  }
}
