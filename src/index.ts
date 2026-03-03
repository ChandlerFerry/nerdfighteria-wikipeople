#!/usr/bin/env node

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import {
  getRandom,
  autocomplete,
  search,
  getCategoryCounts,
} from './database/queries.js';
import { database } from './database/database.js';
import healthRoute from './api/routes/health.js';
import randomRoute from './api/routes/random.js';
import autocompleteRoute from './api/routes/autocomplete.js';
import searchRoute from './api/routes/search.js';
import statsRoute from './api/routes/stats.js';

declare module 'fastify' {
  interface FastifyInstance {
    repo: {
      getRandom: typeof getRandom;
      autocomplete: typeof autocomplete;
      search: typeof search;
      getCategoryCounts: typeof getCategoryCounts;
    };
  }
}

export async function createServer(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: true });

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Famous People API',
        description:
          'Search, autocomplete, and browse 11.6 million people from Wikidata - real humans, apocryphal figures, and fictional characters.\n\n**Rate limiting:** 100 requests / minute per IP on all endpoints except `/health`.',
        version: '1.0.0',
      },
      tags: [
        { name: 'Search', description: 'Find people by name' },
        { name: 'Browse', description: 'Explore the dataset randomly' },
        { name: 'Meta', description: 'Server status' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  await fastify.register(swaggerUi, { routePrefix: '/documentation' });

  fastify.decorate('repo', { getRandom, autocomplete, search, getCategoryCounts });
  fastify.addHook('onClose', async () => database.close());

  await fastify.register(cors, { origin: true, methods: ['GET'] });

  await fastify.register(healthRoute);
  await fastify.register(statsRoute);

  await fastify.register(async (scope) => {
    await scope.register(rateLimit, { max: 100, timeWindow: '1 minute' });
    await scope.register(randomRoute);
    await scope.register(autocompleteRoute);
    await scope.register(searchRoute);
  });

  return fastify;
}

async function startServer(): Promise<void> {
  const server = await createServer();
  await server.listen({
    port: Number(process.env.PORT ?? 8080),
    host: '0.0.0.0',
  });
}

try {
  await startServer();
} catch (error) {
  console.error('Fatal:', error);
  process.exit(1);
}
