export default {
  port: parseInt(process.env.PORT || '3000', 10),
  llama: {
    baseUrl: process.env.LLAMA_URL || 'http://localhost:8080',
    maxContextTokens: parseInt(process.env.LLAMA_MAX_CONTEXT || '131072', 10),
  },
  tavily: {
    apiKey: process.env.TAVILY_API_KEY || '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',
  },
};
