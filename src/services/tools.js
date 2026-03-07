import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { mkdir, writeFile } from 'fs/promises';
import { join, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import config from '../config.js';
import etrade from './etrade.js';

const __dirname = import.meta.dirname || (() => { const f = fileURLToPath(import.meta.url); return f.substring(0, f.lastIndexOf('/')); })();
const DATA_DIR = resolve(__dirname, '../../data');

// ── File save helper ─────────────────────────────────
async function saveToFile(filename, content) {
  const safe = basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!safe || safe.startsWith('.')) return { error: `Invalid filename: ${filename}` };
  await mkdir(DATA_DIR, { recursive: true });
  const filePath = join(DATA_DIR, safe);
  await writeFile(filePath, content, 'utf-8');
  return { url: `/files/${encodeURIComponent(safe)}`, filename: safe, size: Buffer.byteLength(content, 'utf-8') };
}

// ── CSV helpers ──────────────────────────────────────
function csvEscape(v) {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers, rows) {
  return [headers.join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\n');
}

function transactionsToCsv(data) {
  const txns = data.Transaction || [];
  if (!txns.length) return '';
  const headers = ['Date', 'Transaction ID', 'Type', 'Symbol', 'Security Type', 'Call/Put', 'Strike', 'Expiry', 'Quantity', 'Price', 'Amount', 'Fee', 'Description'];
  const rows = txns.map(t => {
    const b = t.brokerage || {};
    const p = b.product || {};
    const date = new Date(t.transactionDate).toISOString().split('T')[0];
    const expiry = p.expiryYear ? `20${String(p.expiryYear).padStart(2, '0')}-${String(p.expiryMonth).padStart(2, '0')}-${String(p.expiryDay).padStart(2, '0')}` : '';
    return [date, t.transactionId, t.transactionType, p.symbol || '', p.securityType || '', p.callPut || '', p.strikePrice ?? '', expiry, b.quantity ?? '', b.price ?? '', t.amount ?? '', b.fee ?? '', t.description?.trim() || ''];
  });
  return toCsv(headers, rows);
}

function portfolioToCsv(data) {
  const positions = data?.AccountPortfolio?.[0]?.Position || [];
  if (!positions.length) return '';
  const headers = ['Symbol', 'Description', 'Security Type', 'Call/Put', 'Strike', 'Expiry', 'Quantity', 'Price Paid', 'Market Value', 'Total Cost', 'Total Gain', 'Total Gain Pct', 'Day Gain', 'Day Gain Pct', 'Current Price', 'Change', 'Change Pct'];
  const rows = positions.map(pos => {
    const p = pos.Product || pos.product || {};
    const q = pos.Quick || pos.quick || {};
    const expiry = p.expiryYear ? `20${String(p.expiryYear).padStart(2, '0')}-${String(p.expiryMonth).padStart(2, '0')}-${String(p.expiryDay).padStart(2, '0')}` : '';
    return [
      p.symbol || pos.symbolDescription || '', pos.symbolDescription || '', p.securityType || '',
      p.callPut || '', p.strikePrice ?? '', expiry,
      pos.quantity ?? '', pos.pricePaid ?? '', pos.marketValue ?? '',
      pos.totalCost ?? '', pos.totalGain ?? '', pos.totalGainPct ?? '',
      q.lastTrade ?? pos.Quick?.lastTrade ?? '',
      q.change ?? '', q.changePct ?? '',
      pos.daysGain ?? '', pos.daysGainPct ?? '',
    ];
  });
  return toCsv(headers, rows);
}

function balanceToCsv(data) {
  const b = data || {};
  const c = b.Computed || b.computed || {};
  const headers = ['Account ID', 'Account Type', 'Net Cash', 'Cash Balance', 'Market Value', 'Total Account Value', 'Cash Buying Power', 'Margin Buying Power', 'Day Trader Buying Power'];
  const row = [
    b.accountId || '', b.accountType || '',
    c.cashAvailableForInvestment ?? b.cashAvailableForInvestment ?? '',
    c.cashBalance ?? b.cashBalance ?? '',
    c.RealTimeValues?.totalMarketValue ?? c.totalMarketValue ?? '',
    c.RealTimeValues?.totalAccountValue ?? c.totalAccountValue ?? '',
    c.cashBuyingPower ?? '', c.marginBuyingPower ?? '', c.dtCashBuyingPower ?? '',
  ];
  return toCsv(headers, [row]);
}

function accountsToCsv(data) {
  const accounts = data?.accounts || [];
  if (!accounts.length) return '';
  const headers = ['Account ID', 'Account ID Key', 'Account Name', 'Account Type', 'Institution Type', 'Account Status', 'Account Mode', 'Description'];
  const rows = accounts.map(a => [
    a.accountId || '', a.accountIdKey || '', a.accountName || '', a.accountType || '',
    a.institutionType || '', a.accountStatus || '', a.accountMode || '', a.accountDesc || '',
  ]);
  return toCsv(headers, rows);
}

// ── Markdown table helpers ───────────────────────────
function toMd(title, headers, rows) {
  const sep = headers.map(() => '---');
  const lines = [
    `# ${title}`, '',
    '| ' + headers.join(' | ') + ' |',
    '| ' + sep.join(' | ') + ' |',
    ...rows.map(r => '| ' + r.map(v => String(v ?? '').replace(/\|/g, '\\|')).join(' | ') + ' |'),
  ];
  return lines.join('\n');
}

function transactionsToMd(data) {
  const txns = data.Transaction || [];
  if (!txns.length) return '';
  const headers = ['Date', 'Type', 'Symbol', 'C/P', 'Strike', 'Expiry', 'Qty', 'Price', 'Amount', 'Fee'];
  const rows = txns.map(t => {
    const b = t.brokerage || {}; const p = b.product || {};
    const date = new Date(t.transactionDate).toISOString().split('T')[0];
    const expiry = p.expiryYear ? `20${String(p.expiryYear).padStart(2, '0')}-${String(p.expiryMonth).padStart(2, '0')}-${String(p.expiryDay).padStart(2, '0')}` : '';
    return [date, t.transactionType, p.symbol || '', p.callPut || '', p.strikePrice ?? '', expiry, b.quantity ?? '', b.price ?? '', t.amount ?? '', b.fee ?? ''];
  });
  return toMd(`Transactions (${txns.length})`, headers, rows);
}

function portfolioToMd(data) {
  const positions = data?.AccountPortfolio?.[0]?.Position || [];
  if (!positions.length) return '';
  const headers = ['Symbol', 'Type', 'C/P', 'Strike', 'Expiry', 'Qty', 'Price Paid', 'Market Value', 'Total Gain', 'Gain %'];
  const rows = positions.map(pos => {
    const p = pos.Product || pos.product || {};
    const expiry = p.expiryYear ? `20${String(p.expiryYear).padStart(2, '0')}-${String(p.expiryMonth).padStart(2, '0')}-${String(p.expiryDay).padStart(2, '0')}` : '';
    return [p.symbol || '', p.securityType || '', p.callPut || '', p.strikePrice ?? '', expiry, pos.quantity ?? '', pos.pricePaid ?? '', pos.marketValue ?? '', pos.totalGain ?? '', pos.totalGainPct ?? ''];
  });
  return toMd(`Portfolio (${positions.length} positions)`, headers, rows);
}

function balanceToMd(data) {
  const b = data || {}; const c = b.Computed || b.computed || {};
  const headers = ['Field', 'Value'];
  const rows = [
    ['Account ID', b.accountId || ''],
    ['Account Type', b.accountType || ''],
    ['Cash Balance', c.cashBalance ?? b.cashBalance ?? ''],
    ['Market Value', c.RealTimeValues?.totalMarketValue ?? c.totalMarketValue ?? ''],
    ['Total Account Value', c.RealTimeValues?.totalAccountValue ?? c.totalAccountValue ?? ''],
    ['Cash Buying Power', c.cashBuyingPower ?? ''],
    ['Margin Buying Power', c.marginBuyingPower ?? ''],
  ];
  return toMd('Account Balance', headers, rows);
}

function accountsToMd(data) {
  const accounts = data?.accounts || [];
  if (!accounts.length) return '';
  const headers = ['Account ID', 'Name', 'Type', 'Status'];
  const rows = accounts.map(a => [a.accountId || '', a.accountName || '', a.accountType || '', a.accountStatus || '']);
  return toMd(`Accounts (${accounts.length})`, headers, rows);
}

function gainsToCsv(data) {
  const rows = (data.gains || []).map(g => [
    g.symbol, g.securityType, g.callPut || '', g.strikePrice ?? '',
    g.description, g.dateAcquired ?? '', g.quantity, g.costPerShare,
    g.totalCost, g.marketValue, g.gain, g.gainPct, g.term,
  ]);
  return toCsv(['Symbol', 'Type', 'C/P', 'Strike', 'Description', 'Date Acquired', 'Quantity', 'Cost/Share', 'Total Cost', 'Market Value', 'Gain', 'Gain %', 'Term'], rows);
}

function gainsToMd(data) {
  const rows = (data.gains || []).map(g => [
    g.symbol, g.callPut || '', g.strikePrice ?? '', g.dateAcquired ?? '',
    g.quantity, g.totalCost, g.marketValue, g.gain, g.gainPct, g.term,
  ]);
  return toMd(`Unrealized Gains (${data.totalCount} lots)`,
    ['Symbol', 'C/P', 'Strike', 'Acquired', 'Qty', 'Cost', 'Value', 'Gain', 'Gain %', 'Term'], rows);
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

// Tool registry — single source of truth
const tools = {
  current_datetime: {
    description: 'Returns the current date and time in UTC and local time with timezone. Takes no arguments.',
    parameters: {},
    execute: () => {
      const now = new Date();
      return {
        utc: now.toISOString(),
        local: now.toString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        offset: now.getTimezoneOffset(),
      };
    },
  },
  web_search: {
    description: 'Search the web. Requires a "query" argument.',
    parameters: { query: 'string' },
    execute: async ({ query }) => {
      const engine = config.search.engine;
      if (engine === 'tavily') {
        const res = await searchTavily(query);
        return { ...res, sources: 'Tavily' };
      }
      if (engine === 'keiro') {
        const res = await searchKeiro(query);
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
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LLM-Workbench/1.0)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      });
      const html = await res.text();
      const { document } = parseHTML(html);

      const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
      turndown.remove(['script', 'style', 'noscript']);

      // Try Readability (article extraction)
      const article = new Readability(document).parse();

      let markdown, title;
      if (article && article.content) {
        markdown = turndown.turndown(article.content);
        title = article.title;
      } else {
        // Fallback: strip boilerplate from raw HTML
        const { document: doc2 } = parseHTML(html);
        for (const sel of ['script', 'style', 'noscript', 'nav', 'footer', 'header', 'aside']) {
          doc2.querySelectorAll(sel).forEach(el => el.remove());
        }
        markdown = turndown.turndown(doc2.toString());
        title = doc2.querySelector('title')?.textContent || '';
      }

      // Truncate to keep token usage reasonable
      const maxLen = 4000;
      if (markdown.length > maxLen) {
        markdown = markdown.slice(0, maxLen) + '\n\n[...truncated]';
      }

      return { url, title, content: markdown };
    },
  },
  save_file: {
    description: 'Save content to a file for download. Requires "filename" (e.g. "report.md", "data.csv") and "content" (the text content to save). Returns a download URL. Use for generated text, reports, code, or small data sets. Avoid for large data (50+ records) — use the source tool\'s saveAs parameter instead to prevent output truncation.',
    parameters: { filename: 'string', content: 'string' },
    execute: async ({ filename, content }) => {
      if (!filename || !content) return { error: 'Both "filename" and "content" are required.' };
      return await saveToFile(filename, content);
    },
  },
  etrade_account: {
    description: 'Retrieve E*TRADE brokerage account data. Requires an "action" argument: "list" (list accounts), "balance" (account balance), "portfolio" (positions/holdings), "transactions" (transaction history, defaults to last 30 days or use startDate/endDate), or "gains" (unrealized gains with lot-level cost basis and short/long term classification). For balance/portfolio/transactions/gains, also requires "accountIdKey" — use the ENCODED string key (e.g. "-HfArItq47WyjwKBqyytsA"), NOT the numeric accountId. Get it from the "list" action response. For transactions, optional "startDate" and "endDate" in MMDDYYYY format (e.g. "01012026"), and "count" (max 50). To export data to a file, add "saveAs" with a filename — the server converts and saves directly. File format is determined by extension: .md (markdown table), .json (raw API data), anything else including .csv defaults to structured CSV. When the user doesn\'t specify a filename, generate one from the action (e.g. "transactions.csv", "portfolio.csv", "balance.csv", "accounts.csv"). Usage guide: "gains" for current holdings with cost basis and short/long term (tax planning); "transactions" for trade history including all buys/sells (default last 30 days); "transactions" with startDate/endDate for a specific period (e.g. tax year). Gains shows only open positions; transactions shows all activity including closed trades. By default, use saveAs for file exports. If the user asks to customize columns or reshape data, first fetch without saveAs, then use save_file — but only for small results (under 20 records) to avoid truncation.',
    parameters: { action: 'string', accountIdKey: 'string (optional)', startDate: 'string (optional)', endDate: 'string (optional)', count: 'number (optional)', saveAs: 'string (optional)' },
    execute: async ({ action, accountIdKey, startDate, endDate, count, saveAs }) => {
      if (!etrade.isAuthenticated()) {
        return { error: 'E*TRADE not authenticated. Click "E*TRADE (connect)" in the status bar to authenticate.' };
      }
      let result;
      switch (action) {
        case 'list':
          result = await etrade.listAccounts();
          break;
        case 'balance':
          if (!accountIdKey) return { error: 'accountIdKey required. Use action "list" first.' };
          result = await etrade.getBalance(accountIdKey);
          break;
        case 'portfolio':
          if (!accountIdKey) return { error: 'accountIdKey required. Use action "list" first.' };
          result = await etrade.getPortfolio(accountIdKey);
          break;
        case 'transactions':
          if (!accountIdKey) return { error: 'accountIdKey required. Use action "list" first.' };
          result = await etrade.getTransactions(accountIdKey, { count, startDate, endDate });
          break;
        case 'gains':
          if (!accountIdKey) return { error: 'accountIdKey required. Use action "list" first.' };
          result = await etrade.getGains(accountIdKey);
          break;
        default:
          return { error: `Unknown action: ${action}. Use: list, balance, portfolio, transactions, gains` };
      }
      // Save to file if requested
      if (saveAs && result && !result.error) {
        let content;
        const formatters = { transactions: transactionsToCsv, portfolio: portfolioToCsv, list: accountsToCsv, balance: balanceToCsv, gains: gainsToCsv };
        const mdFormatters = { transactions: transactionsToMd, portfolio: portfolioToMd, list: accountsToMd, balance: balanceToMd, gains: gainsToMd };
        if (saveAs.endsWith('.json')) {
          content = JSON.stringify(result, null, 2);
        } else if (saveAs.endsWith('.md') && mdFormatters[action]) {
          content = mdFormatters[action](result);
        } else {
          // Default to CSV for .csv, .txt, or any unrecognized extension
          content = formatters[action]?.(result) || JSON.stringify(result, null, 2);
        }
        if (!content) return { ...result, saveError: 'No data to save' };
        const file = await saveToFile(saveAs, content);
        // Return summary + file info (avoid echoing all data back to LLM)
        const summary = action === 'transactions'
          ? { transactionCount: result.transactionCount || 0, totalCount: result.totalCount || 0, moreTransactions: result.moreTransactions || false }
          : { recordCount: Array.isArray(result) ? result.length : 1 };
        return { ...summary, savedFile: file };
      }
      return result;
    },
  },
};

// Build system prompt from registry
export function getSystemPrompt() {
  const toolList = Object.entries(tools)
    .map(([name, t]) => `- ${name}: ${t.description}`)
    .join('\n');

  const now = new Date();
  const datetime = {
    utc: now.toISOString(),
    local: now.toString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offset: now.getTimezoneOffset(),
  };

  return `You are a helpful, knowledgeable assistant. Current date/time: ${datetime.local} (UTC: ${datetime.utc}, timezone: ${datetime.timezone}). Your training data may be outdated — for questions about current events, people in office, recent news, or anything time-sensitive, ALWAYS use web_search first before answering.

To use a tool, respond ONLY with:

<tool_call>
{"name": "tool_name", "arguments": {}}
</tool_call>

Available tools:
${toolList}

Tool rules:
- Output ONLY the <tool_call> block when using a tool, no other text.
- Wait for the tool result before answering.
- Do not fabricate tool results.
- After web_search, ALWAYS use web_fetch on the most relevant result URL to get full details before answering. Search snippets alone are not sufficient.
- When analyzing options positions from etrade_account, ALWAYS use the current date/time (provided above) to calculate days-to-expiry. Never estimate or guess expiration dates — compute them from the portfolio data. Verify your time-to-expiry math before reporting. Common covered call strategies use ~30-day income-generating calls, not imminent expirations — frame your analysis accordingly.

## Response Formatting

Adapt formatting to response length:
- **Under 50 words**: Plain text, no special formatting needed.
- **50–150 words**: Use **bold** for key terms. Keep to 1–2 short paragraphs.
- **150–300 words**: Use ## headers to break into sections. Use bullet points where appropriate.
- **Over 300 words**: Begin with a **Key Takeaway** block (2–3 bullets). Use headers, lists, and tables.

Rules:
- Answer the question in the first sentence. Never bury the conclusion.
- Use **bold** for key terms only — never bold entire sentences.
- Use bullet points for 3+ related items. Use numbered lists only for sequential steps.
- Use tables for comparisons of 3+ items.
- Use fenced code blocks with language tags for code. Use \`inline code\` for technical terms.
- Mermaid v11 diagrams are supported via \`\`\`mermaid code blocks. No emoji in Mermaid text. Pie values must be positive — use a table for negative values. For ANY bar or line chart, the FIRST LINE must be exactly "xychart-beta" — no other chart type keyword exists (not "barChart", "lineChart", "line chart", "bar chart"). Use "bar" and "line" as series keywords inside xychart-beta. Valid types: pie, xychart-beta, flowchart, timeline, mindmap, gantt, journey, sequenceDiagram.
- Keep paragraphs to 2–4 sentences.
- Use emoji sparingly as section markers (e.g., 📌 Key Point, ⚠️ Warning) — never inline or decorative.
- Use plain, direct language. No filler phrases or sycophantic openers.
- Separate major topic shifts with a horizontal rule (---).`;
}

// Parse <tool_call>...</tool_call> from LLM output
export function parseToolCall(text) {
  const match = text.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return { name: parsed.name, arguments: parsed.arguments || {} };
  } catch {
    return null;
  }
}

// Execute a tool by name
export async function executeTool(name, args) {
  const tool = tools[name];
  if (!tool) {
    const available = Object.keys(tools).join(', ');
    return JSON.stringify({ error: `Unknown tool: ${name}. Available tools: ${available}` });
  }
  try {
    const result = await tool.execute(args);
    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}
