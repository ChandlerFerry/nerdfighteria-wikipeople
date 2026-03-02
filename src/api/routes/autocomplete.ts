import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

const autocompleteRoute: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/autocomplete',
    {
      schema: {
        tags: ['Search'],
        summary: 'Autocomplete suggestions',
        description:
          'FTS5 prefix search for real-time typeahead. Returns results ordered by sitelink count.',
        querystring: z.object({
          q: z.string().min(2).max(50),
          limit: z.coerce.number().int().min(1).max(20).default(10),
        }),
      },
    },
    async (request) => {
      const { q, limit } = request.query;
      return fastify.repo.autocomplete(q, limit);
    }
  );
};

export default autocompleteRoute;
