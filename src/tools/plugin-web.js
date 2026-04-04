import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import config from '../config.js';

let _gotScraping;
async function getGotScraping() {
  if (!_gotScraping) {
    _gotScraping = (await import('got-scraping')).gotScraping;
  }
  return _gotScraping;
}


// ── Search engine backends ───────────────────────────
async function searchTavily(query) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.tavily.apiKey}`,
    },
    body: JSON.stringify({ query, max_results: 5 }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text();
    console.warn(`[web_search] Tavily returned ${res.status}: ${body}`);
    return { error: `Search failed (HTTP ${res.status})`, results: [] };
  }
  const data = await res.json();
  return { results: (data.results || []).map(r => ({ title: r.title, url: r.url, description: r.content || '' })) };
}

async function searchKeiro(query) {
  const res = await fetch(`${config.keiro.baseUrl}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: config.keiro.apiKey, query }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text();
    console.warn(`[web_search] Keiro returned ${res.status}: ${body}`);
    return { error: `Search failed (HTTP ${res.status})`, results: [] };
  }
  const data = await res.json();
  const results = data.data?.search_results || [];
  return { results: results.slice(0, 5).map(r => ({ title: r.title || '', url: r.url || '', description: r.snippet || '' })) };
}

async function searchDDG(query) {
  const gotScraping = await getGotScraping();
  const res = await gotScraping({
    url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    headerGeneratorOptions: { browsers: ['chrome'], operatingSystems: ['linux'], devices: ['desktop'] },
    timeout: { request: 15000 },
    followRedirect: true,
  });
  const { document } = parseHTML(res.body);
  const results = [];
  for (const el of document.querySelectorAll('.result')) {
    const anchor = el.querySelector('.result__a');
    const snippet = el.querySelector('.result__snippet');
    if (!anchor) continue;
    const href = anchor.getAttribute('href') || '';
    // DDG wraps URLs through //duckduckgo.com/l/?uddg=...
    const match = href.match(/uddg=([^&]+)/);
    const finalUrl = match ? decodeURIComponent(match[1]) : href;
    if (!finalUrl || finalUrl.startsWith('/')) continue;
    results.push({
      title: anchor.textContent?.trim() || '',
      url: finalUrl,
      description: snippet?.textContent?.trim() || '',
    });
    if (results.length >= 5) break;
  }
  if (!results.length) {
    return { error: 'No results parsed (DDG may have changed layout or blocked)', results: [] };
  }
  return { results };
}

export default {
  group: 'web',
  status: {
    managed: false,
    label: 'Search',
  },
  routing: [
    '- Web questions, current events, news → use "web_search" then "web_fetch"',
  ],
  prompt: `## Web Research
- After web_search, try web_fetch on the most relevant result URL to get full details. If web_fetch fails (Cloudflare block, login wall, "enable JavaScript", empty content), use the search snippet descriptions directly — they often contain the data you need.
- Do NOT retry the same blocked site via proxy or alternate URL. Move on.
- Maximum 3 web_search calls and 3 web_fetch calls per user question. If you still lack information after that, answer with what you have and tell the user what you could not retrieve.`,
  tools: {
    web_search: {
      description: 'Search the web. Requires a "query" argument.',
      parameters: { query: 'string' },
      execute: async ({ query }) => {
        const engine = config.search.engine;
        if (engine === 'duckduckgo') {
          const res = await searchDDG(query).catch(e => ({ error: e.message, results: [] }));
          return { ...res, sources: 'DuckDuckGo' };
        }
        if (engine === 'tavily') {
          const res = await searchTavily(query).catch(e => ({ error: e.message, results: [] }));
          return { ...res, sources: 'Tavily' };
        }
        if (engine === 'keiro') {
          const res = await searchKeiro(query).catch(e => ({ error: e.message, results: [] }));
          return { ...res, sources: 'Keiro' };
        }
        // 'both' — run in parallel, merge and deduplicate by URL
        const [keiro, tavily] = await Promise.all([
          searchKeiro(query).catch(e => ({ error: e.message, results: [] })),
          searchTavily(query).catch(e => ({ error: e.message, results: [] })),
        ]);
        const keiroOk = keiro.results.length > 0;
        const tavilyOk = tavily.results.length > 0;
        let sources;
        if (keiroOk && tavilyOk) sources = 'Keiro + Tavily';
        else if (keiroOk) sources = 'Keiro (Tavily failed)';
        else if (tavilyOk) sources = 'Tavily (Keiro failed)';
        else sources = 'both failed';
        const seen = new Set();
        const merged = [];
        for (const r of [...keiro.results, ...tavily.results]) {
          if (!seen.has(r.url)) {
            seen.add(r.url);
            merged.push(r);
          }
        }
        return { results: merged.slice(0, 8), sources };
      },
    },
    web_fetch: {
      description: 'Fetch a web page and extract its full content as markdown. Requires a "url" argument. ALWAYS use after web_search to read the most relevant result before answering.',
      parameters: { url: 'string' },
      execute: async ({ url }) => {
        let html;
        if (config.stealthFetch) {
          const gotScraping = await getGotScraping();
          const res = await gotScraping({
            url,
            headerGeneratorOptions: { browsers: ['chrome'], operatingSystems: ['linux'], devices: ['desktop'] },
            timeout: { request: 15000 },
            followRedirect: true,
          });
          html = res.body;
        } else {
          const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LLM-Workbench/1.0)' },
            redirect: 'follow',
            signal: AbortSignal.timeout(10000),
          });
          html = await res.text();
        }
        const { document } = parseHTML(html);

        const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
        turndown.remove(['script', 'style', 'noscript']);

        const article = new Readability(document).parse();

        let markdown, title;
        if (article && article.content) {
          markdown = turndown.turndown(article.content);
          title = article.title;
        } else {
          const { document: doc2 } = parseHTML(html);
          for (const sel of ['script', 'style', 'noscript', 'nav', 'footer', 'header', 'aside']) {
            doc2.querySelectorAll(sel).forEach(el => el.remove());
          }
          markdown = turndown.turndown(doc2.toString());
          title = doc2.querySelector('title')?.textContent || '';
        }

        const maxLen = 4000;
        if (markdown.length > maxLen) {
          markdown = markdown.slice(0, maxLen) + '\n\n[...truncated]';
        }

        return { url, title, content: markdown };
      },
    },
  },
};
