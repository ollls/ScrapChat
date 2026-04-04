import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import vm from 'vm';
import config from '../config.js';

let _gotScraping, _CookieJar;
async function getGotScraping() {
  if (!_gotScraping) {
    _gotScraping = (await import('got-scraping')).gotScraping;
    _CookieJar = (await import('tough-cookie')).CookieJar;
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

// ── Google challenge solver ─────────────────────────
function makeClassList() {
  const classes = new Set();
  return {
    add: (...c) => c.forEach(x => classes.add(x)),
    remove: (...c) => c.forEach(x => classes.delete(x)),
    contains: (c) => classes.has(c),
    toggle: (c) => { if (classes.has(c)) classes.delete(c); else classes.add(c); },
    get length() { return classes.size; },
    toString: () => [...classes].join(' '),
  };
}

function makeElement(tag) {
  return {
    tagName: tag, classList: makeClassList(), className: '',
    getAttribute: () => null, setAttribute: () => {},
    style: {}, children: [], childNodes: [], parentNode: null,
    appendChild: () => {}, removeChild: () => {}, textContent: '', innerHTML: '',
  };
}

function solveGoogleChallenge(html, searchUrl, userAgent) {
  return new Promise((resolve, reject) => {
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
    const timeout = setTimeout(() => reject(new Error('Challenge solve timeout')), 10000);
    const google = { c: { cap: 0, fbts: 0, e: () => {} }, tick: () => {}, rdn: false };
    let solvedCookie = '';
    const ctx = {
      window: {}, google,
      document: {
        _c: '',
        getElementById: () => makeElement('div'),
        createElement: (tag) => makeElement(tag),
        body: makeElement('body'),
        documentElement: makeElement('html'),
        get cookie() { return this._c; },
        set cookie(v) {
          this._c += (this._c ? '; ' : '') + v;
          solvedCookie = v.split(';')[0];
        },
      },
      navigator: { sendBeacon: () => true, userAgent: userAgent || '' },
      location: {
        href: searchUrl, search: '?' + searchUrl.split('?')[1],
        replace: (u) => { clearTimeout(timeout); resolve({ cookie: solvedCookie, redirectUrl: u }); },
      },
      setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, 100)),
      setInterval: () => 0, clearTimeout: () => {},
      self: undefined, globalThis: undefined, console,
      Error, TypeError, RangeError, SyntaxError, ReferenceError, URIError,
      Array, Object, String, Number, Boolean, RegExp, Date, Math, JSON,
      Symbol, Promise, Map, Set, WeakMap, WeakSet, Proxy, Reflect,
      parseInt, parseFloat, isNaN, isFinite, NaN, Infinity, undefined,
      encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
      Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array,
      Float32Array, Float64Array, ArrayBuffer, DataView, BigInt,
      TextEncoder: globalThis.TextEncoder, TextDecoder: globalThis.TextDecoder,
      performance: { now: () => Date.now(), getEntriesByType: () => [], navigation: { type: 0 } },
      screen: { width: 1920, height: 1080, colorDepth: 24, availWidth: 1920, availHeight: 1040 },
      Image: class { set src(_v) {} },
      crypto: globalThis.crypto, atob: globalThis.atob, btoa: globalThis.btoa,
    };
    ctx.window = ctx; ctx.window.google = google; ctx.self = ctx; ctx.globalThis = ctx;
    const sandbox = vm.createContext(ctx);
    for (const s of scripts) {
      try { vm.runInContext(s, sandbox, { timeout: 10000 }); } catch (_e) { /* ignore */ }
    }
  });
}

function parseGoogleResults(html) {
  const { document } = parseHTML(html);
  const results = [];
  // Walk h3 elements and find their parent anchors
  for (const h3 of document.querySelectorAll('h3')) {
    let a = h3.closest('a');
    if (!a) {
      // Try walking up manually
      let el = h3.parentElement;
      while (el && el.tagName !== 'A') el = el.parentElement;
      a = el;
    }
    if (!a) continue;
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('http') || href.includes('google.')) continue;
    // Find snippet near the result
    const container = a.parentElement?.parentElement;
    let description = '';
    if (container) {
      for (const span of container.querySelectorAll('span')) {
        if (span.textContent.length > 40 && !span.querySelector('h3')) {
          description = span.textContent.trim();
          break;
        }
      }
    }
    results.push({ title: h3.textContent.trim(), url: href, description });
    if (results.length >= 5) break;
  }
  return results;
}

// ── Google search: challenge solve flow (HTTP/1.1) ──
async function searchGoogle(query) {
  const gotScraping = await getGotScraping();
  const cookieJar = new _CookieJar();
  const sessionToken = {};
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&num=5`;
  const commonOpts = {
    headerGeneratorOptions: { browsers: ['chrome'], operatingSystems: ['linux'], devices: ['desktop'] },
    timeout: { request: 15000 },
    followRedirect: true,
    cookieJar,
    sessionToken,
    http2: false,
  };

  // Step 1: fetch challenge page (sessionToken ensures consistent headers across requests)
  console.log('[google] Step 1: GET', searchUrl);
  const res1 = await gotScraping({ url: searchUrl, ...commonOpts });
  const h1 = res1.request.options.headers;
  console.log('[google]   HTTP/' + res1.httpVersion, res1.statusCode, res1.body.length + 'B');
  console.log('[google]   UA:', h1['user-agent']);
  console.log('[google]   sec-ch-ua:', h1['sec-ch-ua']);
  console.log('[google]   cookie:', h1['cookie'] || '(none)');
  console.log('[google]   challenge:', res1.body.includes('SG_SS'));
  const sc1 = res1.headers['set-cookie'];
  if (Array.isArray(sc1)) for (const c of sc1) console.log('[google]   Set-Cookie:', c.split(';')[0].slice(0, 60));
  if (!res1.body.includes('SG_SS')) {
    console.log('[google]   No challenge — parsing results directly');
    // No challenge — parse directly
    const results = parseGoogleResults(res1.body);
    if (results.length) return { results };
    return { error: 'No results parsed (Google may have changed layout)', results: [] };
  }

  // Step 2: solve challenge — pass actual UA from step 1 to solver
  console.log('[google] Step 2: Solving challenge...');
  const userAgent = res1.request.options.headers['user-agent'];
  const { cookie, redirectUrl } = await solveGoogleChallenge(res1.body, searchUrl, userAgent);
  console.log('[google]   SG_SS:', cookie.slice(0, 60) + '...');
  console.log('[google]   valid:', cookie.startsWith('SG_SS=*'));
  console.log('[google]   redirect:', redirectUrl);
  await cookieJar.setCookie(cookie + '; path=/; domain=.google.com', 'https://www.google.com/');
  const jar = await cookieJar.getCookies('https://www.google.com/');
  console.log('[google]   jar:', jar.map(c => c.key).join(', '));

  // Step 3: navigate to the redirect URL (as location.replace would)
  console.log('[google] Step 3: Waiting 2s...');
  await new Promise(r => setTimeout(r, 2000));
  const targetUrl = redirectUrl || searchUrl;
  console.log('[google] Step 4: GET', targetUrl);
  const res2 = await gotScraping({
    url: targetUrl,
    ...commonOpts,
    headers: {
      'referer': searchUrl,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
    },
  });
  const h2 = res2.request.options.headers;
  console.log('[google]   HTTP/' + res2.httpVersion, res2.statusCode, res2.body.length + 'B');
  console.log('[google]   UA match:', h1['user-agent'] === h2['user-agent']);
  console.log('[google]   sec-fetch-site:', h2['sec-fetch-site']);
  console.log('[google]   referer:', h2['referer']?.slice(0, 70));
  console.log('[google]   cookie:', h2['cookie']?.slice(0, 100) + '...');
  const sc2 = res2.headers['set-cookie'];
  if (Array.isArray(sc2)) for (const c of sc2) console.log('[google]   Set-Cookie:', c.split(';')[0].slice(0, 60));
  console.log('[google]   captcha:', res2.body.includes('captcha'));
  console.log('[google]   sorry:', res2.body.includes('/sorry/'));
  console.log('[google]   results:', res2.body.includes('data-ved'));
  if (res2.body.includes('captcha') || res2.body.includes('/sorry/')) {
    return { error: 'Google returned CAPTCHA — try again later or switch engine', results: [] };
  }
  const results = parseGoogleResults(res2.body);
  if (results.length) return { results };
  return { error: 'No results parsed after challenge solve', results: [] };
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
    const urlEl = el.querySelector('.result__url');
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
        if (engine === 'google') {
          const res = await searchGoogle(query).catch(e => ({ error: e.message, results: [] }));
          return { ...res, sources: 'Google' };
        }
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
