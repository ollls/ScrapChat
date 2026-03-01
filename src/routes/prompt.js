import { Router } from 'express';

const router = Router();

router.post('/', (req, res) => {
  const { prompt, model } = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  // Placeholder: echo back the prompt until LLM integration is added
  const response = {
    model: model || 'placeholder',
    prompt: prompt.trim(),
    response: `[Placeholder] Received prompt: "${prompt.trim()}"`,
    timestamp: new Date().toISOString(),
  };

  res.json(response);
});

export default router;
