import { OAuth } from 'oauth';
import config from '../config.js';

const BASE = config.etrade.sandbox
  ? 'https://apisb.etrade.com'
  : 'https://api.etrade.com';

const AUTH_BASE = config.etrade.sandbox
  ? 'https://apisb.etrade.com'
  : 'https://api.etrade.com';

const AUTHORIZE_URL = 'https://us.etrade.com/e/t/etws/authorize';

// OAuth 1.0a client
const oauth = new OAuth(
  `${AUTH_BASE}/oauth/request_token`,
  `${AUTH_BASE}/oauth/access_token`,
  config.etrade.consumerKey,
  config.etrade.consumerSecret,
  '1.0',
  'oob', // out-of-band callback (user copies verifier manually)
  'HMAC-SHA1'
);

// Session state
let requestToken = null;
let requestTokenSecret = null;
let accessToken = null;
let accessTokenSecret = null;
let cachedAccounts = null; // cache from listAccounts for accountId → accountIdKey lookup

function isAuthenticated() {
  return !!(accessToken && accessTokenSecret);
}

function disconnect() {
  accessToken = null;
  accessTokenSecret = null;
  requestToken = null;
  requestTokenSecret = null;
  cachedAccounts = null;
}

function getAuthorizeUrl(callbackUrl) {
  return new Promise((resolve, reject) => {
    oauth.getOAuthRequestToken((err, token, tokenSecret) => {
      if (err) return reject(new Error(`Request token failed: ${JSON.stringify(err)}`));
      requestToken = token;
      requestTokenSecret = tokenSecret;
      const url = `${AUTHORIZE_URL}?key=${config.etrade.consumerKey}&token=${token}`;
      resolve(url);
    });
  });
}

function handleCallback(verifier) {
  return new Promise((resolve, reject) => {
    oauth.getOAuthAccessToken(
      requestToken,
      requestTokenSecret,
      verifier,
      (err, token, tokenSecret) => {
        if (err) return reject(new Error(`Access token failed: ${JSON.stringify(err)}`));
        accessToken = token;
        accessTokenSecret = tokenSecret;
        resolve({ success: true });
      }
    );
  });
}

function apiGet(path, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const url = `${BASE}${path}`;
    const timer = setTimeout(() => reject(new Error('E*TRADE API request timed out')), timeoutMs);
    oauth.get(url, accessToken, accessTokenSecret, (err, data, response) => {
      clearTimeout(timer);
      if (err) return reject(new Error(`API error: ${err.statusCode} ${err.data || ''}`));
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error(`Invalid JSON response: ${String(data).slice(0, 200)}`));
      }
    });
  });
}

async function listAccounts() {
  const data = await apiGet('/v1/accounts/list.json');
  const accounts = data.AccountListResponse?.Accounts?.Account || [];
  cachedAccounts = accounts;
  return { accounts, totalCount: accounts.length };
}

// Resolve accountIdKey: if a numeric accountId is passed, look up the real accountIdKey
function resolveAccountIdKey(value) {
  if (!value) return null;
  // If it looks like a numeric accountId (all digits), try to find the encoded accountIdKey
  if (/^\d+$/.test(value) && cachedAccounts) {
    const match = cachedAccounts.find(a => String(a.accountId) === value || String(a.accountIdKey) === value);
    if (match && match.accountIdKey !== value) {
      console.log(`[etrade] Resolved numeric accountId ${value} → accountIdKey ${match.accountIdKey}`);
      return match.accountIdKey;
    }
  }
  return value;
}

async function getBalance(accountIdKey, instType = 'BROKERAGE') {
  accountIdKey = resolveAccountIdKey(accountIdKey) || accountIdKey;
  const data = await apiGet(`/v1/accounts/${accountIdKey}/balance.json?instType=${instType}&realTimeNAV=true`);
  return data.BalanceResponse || data;
}

async function getPortfolio(accountIdKey) {
  accountIdKey = resolveAccountIdKey(accountIdKey) || accountIdKey;
  const data = await apiGet(`/v1/accounts/${accountIdKey}/portfolio.json?view=COMPLETE&totalsRequired=true`);
  const result = data.PortfolioResponse || data;
  const positions = result?.AccountPortfolio?.[0]?.Position || [];
  result.totalPositions = Array.isArray(positions) ? positions.length : 0;
  return result;
}

async function getGains(accountIdKey) {
  accountIdKey = resolveAccountIdKey(accountIdKey) || accountIdKey;
  const data = await apiGet(`/v1/accounts/${accountIdKey}/portfolio.json?view=COMPLETE&totalsRequired=true&lotsRequired=true`);
  const result = data.PortfolioResponse || data;
  const positions = result?.AccountPortfolio?.[0]?.Position || [];

  // Flatten: one row per lot (or per position if no lots)
  const gains = [];
  for (const pos of positions) {
    const p = pos.Product || pos.product || {};
    const lots = pos.positionLot || pos.PositionLot || [];
    if (lots.length > 0) {
      for (const lot of lots) {
        gains.push({
          symbol: p.symbol,
          securityType: p.securityType,
          callPut: p.callPut,
          strikePrice: p.strikePrice,
          description: pos.symbolDescription,
          dateAcquired: lot.acquiredDate,
          quantity: lot.remainingQty ?? pos.quantity,
          costPerShare: lot.price,
          totalCost: lot.totalCost,
          marketValue: lot.marketValue,
          gain: lot.totalGain,
          gainPct: lot.totalGainPct,
          term: lot.termCode === 1 ? 'Long' : lot.termCode === 0 ? 'Short' : 'Unknown',
        });
      }
    } else {
      gains.push({
        symbol: p.symbol,
        securityType: p.securityType,
        callPut: p.callPut,
        strikePrice: p.strikePrice,
        description: pos.symbolDescription,
        dateAcquired: pos.dateAcquired,
        quantity: pos.quantity,
        costPerShare: pos.pricePaid,
        totalCost: pos.totalCost,
        marketValue: pos.marketValue,
        gain: pos.totalGain,
        gainPct: pos.totalGainPct,
        term: 'Unknown',
      });
    }
  }

  const totals = result?.Totals || result?.totals || {};
  return { gains, totalGain: totals.totalGainLoss, totalGainPct: totals.totalGainLossPct, totalCount: gains.length };
}

// Normalize date to MMDDYYYY format expected by E*TRADE
function normalizeDate(str) {
  if (!str) return null;
  // Already MMDDYYYY (8 digits, no separators)
  if (/^\d{8}$/.test(str)) return str;
  // Try parsing common formats: YYYY-MM-DD, MM/DD/YYYY, MM-DD-YYYY, etc.
  const d = new Date(str);
  if (!isNaN(d)) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${mm}${dd}${yyyy}`;
  }
  return str; // pass through as-is, let E*TRADE reject if invalid
}

async function getTransactions(accountIdKey, { count = 50, startDate, endDate } = {}) {
  accountIdKey = resolveAccountIdKey(accountIdKey) || accountIdKey;
  // Default to last 30 days if no start date provided
  if (!startDate) {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    startDate = `${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${d.getFullYear()}`;
  }
  let url = `/v1/accounts/${accountIdKey}/transactions.json?count=${count}`;
  const sd = normalizeDate(startDate);
  const ed = normalizeDate(endDate);
  if (sd) url += `&startDate=${sd}`;
  if (ed) url += `&endDate=${ed}`;
  const fullUrl = `${BASE}${url}`;
  console.log(`[etrade] transactions request: ${fullUrl}`);
  console.log(`[etrade] params: startDate=${sd}, endDate=${ed}, count=${count}`);
  try {
    const data = await apiGet(url, 180000);
    console.log(`[etrade] transactions response keys:`, Object.keys(data));
    console.log(`[etrade] transactions response (first 500 chars):`, JSON.stringify(data).slice(0, 500));
    const result = data.TransactionListResponse || data;
    const txns = result?.Transaction || result?.transaction || [];
    result.totalCount = Array.isArray(txns) ? txns.length : 0;
    return result;
  } catch (err) {
    console.error(`[etrade] transactions error:`, err.message);
    throw err;
  }
}

export default {
  isAuthenticated,
  disconnect,
  getAuthorizeUrl,
  handleCallback,
  listAccounts,
  getBalance,
  getPortfolio,
  getGains,
  getTransactions,
};
