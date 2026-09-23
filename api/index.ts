import dotenv from 'dotenv';
import express from 'express';
import { createApiRouter } from '../server/api/routes.js';
import { createMcpRouter } from '../server/mcp/index.js';

dotenv.config();

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/api', createApiRouter());
app.use(createMcpRouter());

export default app;
