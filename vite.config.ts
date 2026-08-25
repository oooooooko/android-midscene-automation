import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import type { PreviewServer, ViteDevServer } from 'vite';
import { createApiMiddleware } from './server/http-api';

// The complete HTTP API (30+ /api/* endpoints plus the Android playground
// proxy) lives in server/http-api.ts as a Connect-style middleware and is
// shared verbatim with the DSH plugin (plugin/index.ts).
function apiPlugin() {
  const handler = createApiMiddleware();
  const attach = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use(handler);
  };

  return {
    name: 'local-script-agent-api',
    configureServer(server: ViteDevServer) {
      attach(server);
    },
    configurePreviewServer(server: PreviewServer) {
      attach(server);
    },
  };
}

export default defineConfig(() => ({
  plugins: [vue(), apiPlugin()],
}));
