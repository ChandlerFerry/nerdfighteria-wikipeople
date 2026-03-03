import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

const randomRoute: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/random',
    {
      schema: {
        tags: ['Browse'],
        summary: 'Random people',
        description:
          'Returns a random sample from each category. Fast - uses a pre-built random index rather than a full table scan.',
        querystring: z.object({
          n: z.coerce.number().int().min(1).max(500).default(50),
        }),
      },
    },
    async (request) => {
      const { n } = request.query;
      return {
        humans: fastify.repo.getRandom('humans', n),
        fictional: fastify.repo.getRandom('fictional', n),
        apocryphal: fastify.repo.getRandom('apocryphal', n),
      };
    }
  );
};

export default randomRoute;
