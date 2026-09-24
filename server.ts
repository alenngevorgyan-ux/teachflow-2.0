import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApiRouter } from './server/api/routes.js';
import { createMcpRouter } from './server/mcp/index.js';

dotenv.config();

// PORT lets a separate local instance (e.g. the labelled FIXTURE environment) run beside the normal one.
const PORT = Number(process.env.PORT) || 3000;

async function bootstrap() {
  const app = express();
  const server = http.createServer(app);

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Attach API routes
  app.use('/api', createApiRouter());

  // Attach MCP routes (streamable HTTP / SSE)
  app.use(createMcpRouter());

  // Vite middleware in dev or static files in prod
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`TeachFlow Curriculum Connector server listening on http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
