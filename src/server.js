import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import promptRoutes from './routes/prompt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(join(__dirname, 'public')));

app.use('/api/prompt', promptRoutes);

app.get('/', (_req, res) => {
  res.sendFile(join(__dirname, 'views', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`LLM Workbench running at http://localhost:${PORT}`);
});
