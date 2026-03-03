import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

const statsRoute: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/stats',
    {
      schema: {
        tags: ['Meta'],
        summary: 'Dataset statistics',
        description: 'Returns the number of entities in each category.',
      },
    },
    async () => fastify.repo.categoryCounts,
  );
};

export default statsRoute;
