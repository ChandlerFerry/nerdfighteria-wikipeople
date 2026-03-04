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
          min_sitelinks: z.coerce.number().int().min(0).optional(),
          max_sitelinks: z.coerce.number().int().min(0).optional(),
          min_pageviews: z.coerce.number().int().min(0).optional(),
          max_pageviews: z.coerce.number().int().min(0).optional(),
        }),
      },
    },
    async (request) => {
      const { n, min_sitelinks, max_sitelinks, min_pageviews, max_pageviews } = request.query;
      const filters = { min_sitelinks, max_sitelinks, min_pageviews, max_pageviews };
      return {
        humans: fastify.repo.getRandom('humans', n, filters),
        fictional: fastify.repo.getRandom('fictional', n, filters),
        apocryphal: fastify.repo.getRandom('apocryphal', n, filters),
      };
    },
  );
};

export default randomRoute;
