import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

const healthRoute: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));
};

export default healthRoute;
