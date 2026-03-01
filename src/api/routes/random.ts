import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

const randomRoute: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    "/random",
    {
      schema: {
        querystring: z.object({
          n: z.coerce.number().int().min(1).max(500).default(50),
        }),
      },
    },
    async (request) => {
      const { n } = request.query;
      return {
        humans:     fastify.repo.getRandom("humans",    n),
        fictional:  fastify.repo.getRandom("fictional",  n),
        historical: fastify.repo.getRandom("historical", n),
      };
    }
  );
};

export default randomRoute;
