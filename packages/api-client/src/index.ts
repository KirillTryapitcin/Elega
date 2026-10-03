import createFetchClient, { type ClientOptions } from 'openapi-fetch';
import type { components, paths } from './schema.js';

export type { components, paths };
export type Schemas = components['schemas'];

/**
 * Typed client for /api/v1, generated from docs/api/openapi.yaml (`pnpm api:generate`).
 * `baseUrl` is the API root, for example `https://elega.ru/api/v1`.
 */
export function createApiClient(options: ClientOptions & { baseUrl: string }) {
  return createFetchClient<paths>({ credentials: 'include', ...options });
}

export type ApiClient = ReturnType<typeof createApiClient>;
