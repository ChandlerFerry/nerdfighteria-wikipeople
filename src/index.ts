#!/usr/bin/env node

import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { openDatabase } from "./database/connection.js";
import { EntityRepository } from "./database/repository.js";
import healthRoute from "./api/routes/health.js";
import randomRoute from "./api/routes/random.js";
import autocompleteRoute from "./api/routes/autocomplete.js";
import searchRoute from "./api/routes/search.js";

declare module "fastify" {
  interface FastifyInstance {
    repo: EntityRepository;
  }
}

export async function createServer(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: true });

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  const database = openDatabase();
  fastify.decorate("repo", new EntityRepository(database));
  fastify.addHook("onClose", async () => database.close());

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
