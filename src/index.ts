#!/usr/bin/env node

import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { getRandom, autocomplete, search, close } from "./database/repository.js";
import healthRoute from "./api/routes/health.js";
import randomRoute from "./api/routes/random.js";
import autocompleteRoute from "./api/routes/autocomplete.js";
import searchRoute from "./api/routes/search.js";

declare module "fastify" {
  interface FastifyInstance {
    repo: {
      getRandom: typeof getRandom;
      autocomplete: typeof autocomplete;
      search: typeof search;
    };
  }
}

export async function createServer(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: true });

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  fastify.decorate("repo", { getRandom, autocomplete, search });
  fastify.addHook("onClose", async () => close());

  await fastify.register(cors, { origin: true, methods: ["GET"] });

  await fastify.register(healthRoute);

  await fastify.register(async (scope) => {
    await scope.register(rateLimit, { max: 100, timeWindow: "1 minute" });
    await scope.register(randomRoute);
    await scope.register(autocompleteRoute);
    await scope.register(searchRoute);
  });

  return fastify;
}

async function startServer(): Promise<void> {
  const server = await createServer();
  await server.listen({ port: Number(process.env.PORT ?? 8080), host: "0.0.0.0" });
}

try {
  await startServer();
} catch (error) {
  console.error("Fatal:", error);
  process.exit(1);
}
