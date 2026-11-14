import multipart from '@fastify/multipart';
import { CATEGORIES, LISTING_PAGE_SIZE, type AuctionPage, type ListingRules } from '@auction/shared';
import type { FastifyInstance } from 'fastify';
import { config } from '../config';
import { cancelAuction, CancelError, createAuction, featuredAuctions, getAuction, listAuctions } from '../services/auctions';
import { photoTooLargeMessage, tooManyPhotosMessage, validateListing } from '../services/listings';
import { deletePhotos, savePhotos } from '../services/photos';

export default async function auctionRoutes(app: FastifyInstance) {
  const rules = config.listing;

  await app.register(multipart, {
    limits: {
      files: rules.photos.max,
      fileSize: rules.photos.maxBytes,
      fields: 20,
      fieldSize: 10_000,
    },
  });

  // The limits for creating an auction and the extension rule, so the screens can show them (RF06)
  app.get('/rules', async (): Promise<ListingRules> => rules);

  // The public listing (RF04, RF20): scheduled and live auctions, a page at a time.
  // Bids and bidders are only visible inside a room (see socket.ts).
  app.get<{ Querystring: { q?: string; category?: string; offset?: number; limit?: number } }>(
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
      const { q, category, offset, limit } = request.query;
      return listAuctions({ search: q?.trim() || undefined, category, offset, limit: limit ?? LISTING_PAGE_SIZE });
    },
  );

  // The home page carousel
  app.get('/featured', async () => featuredAuctions(5));

  app.get<{ Params: { id: number } }>(
    '/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'integer', minimum: 1 } },
        },
      },
    },
    async (request, reply) => {
      const auction = getAuction(request.params.id);
      if (!auction) return reply.code(404).send({ message: 'Leilão não encontrado' });
      return auction;
    },
  );

  // Any logged-in user can create an auction (RF03, RF05). Sent as multipart: the text
  // fields plus the files under "photos".
  app.post('/', { onRequest: [app.authenticate] }, async (request, reply) => {
    if (!request.isMultipart()) return reply.code(400).send({ message: 'Envie o formulário com as fotos' });

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
      if (code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ message: photoTooLargeMessage() });
      if (code === 'FST_FILES_LIMIT') return reply.code(413).send({ message: tooManyPhotosMessage() });
      throw err;
    }

    const result = validateListing(fields, files);
    if (!result.ok) return reply.code(400).send({ message: result.message });

    // Photos go to disk only once everything is valid; they're removed again if creating fails
    const photos = savePhotos(result.photos);
    let auction;
    try {
      auction = createAuction(request.session!.user.id, { ...result.value, photos });
    } catch (err) {
      deletePhotos(photos);
      throw err;
    }

    app.io.emit('auction:created', auction);
    return reply.code(201).send(auction);
  });

  // RF08: only the seller, only while scheduled or live without bids. The auction is kept as cancelled.
  app.post<{ Params: { id: number } }>(
    '/:id/cancel',
    {
      onRequest: [app.authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'integer', minimum: 1 } },
        },
      },
    },
    async (request, reply) => {
      try {
        const auction = cancelAuction(request.params.id, request.session!.user.id);
        app.io.emit('auction:updated', auction); // listings and rooms see the new status right away
        return auction;
      } catch (err) {
        if (err instanceof CancelError) return reply.code(err.statusCode).send({ message: err.message });
        throw err;
      }
    },
  );
}
