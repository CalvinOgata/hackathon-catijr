import { CATEGORIES, LISTING_LIMITS, type CreateAuctionInput } from '@auction/shared';
import type { FastifyInstance } from 'fastify';
import { createAuction, getAuction, listAuctions } from '../services/auctions';

const createSchema = {
  type: 'object',
  required: ['title', 'description', 'category', 'startingPrice', 'minIncrement', 'durationMinutes'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 3, maxLength: 100, pattern: '\\S' },
    description: { type: 'string', maxLength: 2000 },
    category: { type: 'string', enum: CATEGORIES },
    imageUrl: { type: 'string', maxLength: 500, pattern: '^(https?://\\S+)?$' },
    startingPrice: { type: 'integer', minimum: LISTING_LIMITS.minPrice, maximum: LISTING_LIMITS.maxPrice },
    minIncrement: { type: 'integer', minimum: LISTING_LIMITS.minPrice, maximum: LISTING_LIMITS.maxPrice },
    durationMinutes: { type: 'integer', minimum: LISTING_LIMITS.minDurationMinutes, maximum: LISTING_LIMITS.maxDurationMinutes },
  },
} as const;

export default async function auctionRoutes(app: FastifyInstance) {
  // Listings are public (RF04). Bids and bidders are only visible inside a room (see socket.ts).
  app.get<{ Querystring: { q?: string } }>(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { q: { type: 'string', maxLength: 100 } },
        },
      },
    },
    async (request) => listAuctions(request.query.q?.trim() || undefined),
  );

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
      if (!auction) return reply.code(404).send({ message: 'Auction not found' });
      return auction;
    },
  );

  // Any logged-in user can list an item (RF03)
  app.post<{ Body: CreateAuctionInput }>(
    '/',
    { onRequest: [app.authenticate], schema: { body: createSchema } },
    async (request, reply) => {
      const input = request.body;
      const auction = createAuction(request.session!.user.id, {
        ...input,
        title: input.title.trim(),
        description: input.description.trim(),
        imageUrl: input.imageUrl?.trim() || undefined,
      });
      app.io.emit('auction:created', auction);
      return reply.code(201).send(auction);
    },
  );
}
