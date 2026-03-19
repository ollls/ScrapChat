import { Router } from 'express';
import etrade from '../services/etrade.js';
import config from '../config.js';

const router = Router();

// Check auth status
router.get('/status', (_req, res) => {
  res.json({
    authenticated: etrade.isAuthenticated(),
    configured: !!(config.etrade.consumerKey && config.etrade.consumerSecret),
    sandbox: config.etrade.sandbox,
  });
});

// Start OAuth flow — returns the E*TRADE authorize URL
router.get('/auth', async (req, res) => {
  try {
    const url = await etrade.getAuthorizeUrl();
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Complete OAuth flow — user submits the verifier code
router.post('/auth', async (req, res) => {
  const { verifier } = req.body;
  if (!verifier) return res.status(400).json({ error: 'Verifier code required' });
  try {
    await etrade.handleCallback(verifier.trim());
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disconnect — clear tokens so user can re-authenticate
router.post('/disconnect', (_req, res) => {
  etrade.disconnect();
  res.json({ success: true });
});

export default router;
