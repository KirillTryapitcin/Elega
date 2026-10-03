import { createApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const app = await createApp();
await app.listen({ host: env.HOST, port: env.PORT });
