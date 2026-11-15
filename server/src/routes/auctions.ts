import multipart from '@fastify/multipart';
import { CATEGORIES, formatMegabytes, LISTING_PAGE_SIZE, type AuctionPage, type ListingRules } from '@auction/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config';
import { AppError } from '../errors';
import { cancelAuction, featuredAuctions, getAuction, listAuctions } from '../services/auctions';
import { createListing } from '../services/listings';
import { idParams } from '../validation';

const rules = config.listing;

/** The "create auction" form: its text fields, and the files sent under "photos". */
async function readForm(request: FastifyRequest) {
  if (!request.isMultipart()) throw new AppError(400, 'Envie o formulário com as fotos');
  const fields: Record<string, string> = {};
  const files: Buffer[] = [];
  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const data = await part.toBuffer(); // always drain the stream, even for ignored files
        if (part.fieldname === 'photos') files.push(data);
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE') throw new AppError(413, `Cada foto pode ter no máximo ${formatMegabytes(rules.photos.maxBytes)}`);
    if (code === 'FST_FILES_LIMIT') throw new AppError(413, `Envie no máximo ${rules.photos.max} fotos`);
    throw err;
  }
  return { fields, files };
}

export default async function auctionRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { files: rules.photos.max, fileSize: rules.photos.maxBytes, fields: 20, fieldSize: 10_000 },
  });

  // The limits for creating an auction and the extension rule, so the screens can show them (RF06)
  app.get('/rules', async (): Promise<ListingRules> => rules);

  // The public listing (RF04, RF20): scheduled and live auctions, a page at a time.
  // Bids and bidders are only visible inside a room (see socket.ts).
  app.get<{ Querystring: { q?: string; category?: string; offset: number; limit: number } }>(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', maxLength: 100 },
            category: { type: 'string', enum: [...CATEGORIES] },
            offset: { type: 'integer', minimum: 0, default: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: LISTING_PAGE_SIZE },
          },
        },
      },
    },
    async (request): Promise<AuctionPage> => {
      const { q, ...rest } = request.query;
      return listAuctions({ search: q?.trim() || undefined, ...rest });
    },
  );

  // The home page carousel
  app.get('/featured', async () => featuredAuctions(5));

  app.get<{ Params: { id: number } }>('/:id', { schema: { params: idParams } }, async (request) => {
    const auction = getAuction(request.params.id);
    if (!auction) throw new AppError(404, 'Leilão não encontrado');
    return auction;
  });

  // Any logged-in user can create an auction (RF03, RF05)
  app.post('/', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { fields, files } = await readForm(request);
    const auction = createListing(request.session!.user.id, fields, files);
    app.io.emit('auction:created', auction);
    return reply.code(201).send(auction);
  });

  // RF08: only the seller, only while scheduled or live without bids. The auction is kept as cancelled.
  app.post<{ Params: { id: number } }>('/:id/cancel', { onRequest: [app.authenticate], schema: { params: idParams } }, async (request) => {
    const auction = cancelAuction(request.params.id, request.session!.user.id);
    app.io.emit('auction:updated', auction); // listings and rooms see the new status right away
    return auction;
  });
}
