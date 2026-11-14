import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const API_TARGET = 'http://localhost:3333';

export default defineConfig({
  plugins: [
    sveltekit({
      // Client-only SPA: the Fastify server is the only backend
      adapter: adapter({ fallback: 'index.html' }),
    }),
  ],
  server: {
    proxy: {
      '/api': API_TARGET,
      '/socket.io': { target: API_TARGET, ws: true },
    },
  },
});
