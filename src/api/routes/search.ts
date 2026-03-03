import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

const searchRoute: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/search',
    {
      schema: {
        tags: ['Search'],
        summary: 'Full-text search',
        description:
          'Full-text search ranked by sitelink count (most notable first). Supports pagination and optional category filter. Returns 400 if the query produces no valid FTS tokens after sanitisation.',
        querystring: z.object({
          q: z.string().min(2).max(100),
          category: z.enum(['humans', 'fictional', 'apocryphal']).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
    },
    async (request, reply) => {
      const { q, category, limit, offset } = request.query;
      const result = fastify.repo.search({ q, category, limit, offset });
      if (!result) {
        return reply
          .status(400)
          .send({ error: 'Query produced no valid tokens after sanitization' });
      }
      return result;
    },
  );
};

export default searchRoute;
