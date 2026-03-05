import { Router } from 'express';
import slotsService from '../services/slots.js';
import config from '../config.js';

const router = Router();

router.get('/', async (_req, res) => {
  const health = await slotsService.checkHealth();
  if (health.status === 'error') {
    return res.status(502).json(health);
  }
  res.json(health);
});

router.get('/internet', async (_req, res) => {
  try {
    const resp = await fetch('https://1.1.1.1/cdn-cgi/trace', {
      signal: AbortSignal.timeout(3000),
    });
    res.json({ ok: resp.ok });
  } catch {
    res.json({ ok: false });
  }
});

router.get('/search', async (_req, res) => {
  try {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.tavily.apiKey}`,
      },
      body: JSON.stringify({ query: 'ping', max_results: 1 }),
      signal: AbortSignal.timeout(5000),
    });
    res.json({ ok: resp.ok, engine: 'Tavily' });
  } catch {
    res.json({ ok: false, engine: 'Tavily' });
  }
});

export default router;
