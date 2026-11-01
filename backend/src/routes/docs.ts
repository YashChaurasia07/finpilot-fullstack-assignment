import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';

// openapi.yaml sits next to /src (and /dist), so one relative path works in dev, tests and the Docker image.
const specPath = path.join(__dirname, '..', '..', 'openapi.yaml');
const specText = readFileSync(specPath, 'utf8');

export const docsRoutes = Router();

docsRoutes.get('/openapi.yaml', (_req, res) => {
  res.type('application/yaml').send(specText);
});

docsRoutes.use('/docs', swaggerUi.serve, swaggerUi.setup(YAML.parse(specText), { customSiteTitle: 'FinPilot API docs' }));
