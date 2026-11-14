import { buildApp } from './app';
import { config } from './config';
import { loadStore } from './persistence';
import { seed } from './seed';

// Saved data from the VM's disk; sample data only on the very first start
if (!loadStore()) await seed();
const app = await buildApp();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
