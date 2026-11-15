import { buildApp } from './app';
import { config } from './config';
import { loadStore } from './persistence';
import { localizeSamplePhotos, seed } from './seed';

// Saved data from the VM's disk; sample data only on the very first start
const loaded = loadStore();
if (!loaded) await seed();
const fixedPhotos = loaded ? localizeSamplePhotos() : 0;
const app = await buildApp();
if (fixedPhotos) app.log.info(`Replaced outside photo links of ${fixedPhotos} sample items with local copies`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
