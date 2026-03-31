import { Router } from 'express';
import { getPluginStatuses, getPluginAuth, listPluginGroups, setPluginEnabled } from '../services/tools.js';

const router = Router();

// List configurable plugin groups
router.get('/', async (_req, res) => {
  const groups = await listPluginGroups();
  res.json(groups);
});

// Toggle a plugin group on/off (hot load/unload)
router.post('/:group/toggle', async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (boolean) required' });
  const result = await setPluginEnabled(req.params.group, enabled);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// Poll all plugin statuses in one call
router.get('/status', async (_req, res) => {
  const statuses = await getPluginStatuses();
  res.json(statuses);
});

// Generic auth: start
router.post('/:group/auth/start', async (req, res) => {
  const auth = getPluginAuth(req.params.group);
  if (!auth) return res.status(404).json({ error: 'No auth for this plugin' });
  try {
    const result = await auth.start();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generic auth: complete
router.post('/:group/auth/complete', async (req, res) => {
  const auth = getPluginAuth(req.params.group);
  if (!auth) return res.status(404).json({ error: 'No auth for this plugin' });
  try {
    const result = await auth.complete(req.body.input);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generic auth: disconnect
router.post('/:group/auth/disconnect', async (req, res) => {
  const auth = getPluginAuth(req.params.group);
  if (!auth) return res.status(404).json({ error: 'No auth for this plugin' });
  try {
    const result = await auth.disconnect();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
