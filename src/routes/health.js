import { Router } from 'express';
import slotsService from '../services/slots.js';

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

export default router;
