import { createReadStream, statSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { photoMimeType, photoPath } from '../services/photos';

// Serves uploaded photos from the VM's disk. Only names the server generated are accepted,
// so a request can never reach any other file.
export default async function photoRoutes(app: FastifyInstance) {
  app.get<{ Params: { name: string } }>('/:name', async (request, reply) => {
    const path = photoPath(request.params.name);
    const size = path ? statSync(path, { throwIfNoEntry: false })?.size : undefined;
    if (!path || size === undefined) return reply.code(404).send({ message: 'Foto não encontrada' });

    return reply
      .type(photoMimeType(request.params.name))
      .header('Content-Length', size) // lets the browser show progress and reuse the connection
      .header('Cache-Control', 'public, max-age=31536000, immutable') // names are random and never reused
      .header('X-Content-Type-Options', 'nosniff')
      .send(createReadStream(path));
  });
}
