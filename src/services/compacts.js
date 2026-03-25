import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const COMPACTS_FILE = join(DATA_DIR, 'compacts.json');

function load() {
  if (!existsSync(COMPACTS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(COMPACTS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function save(compacts) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(COMPACTS_FILE, JSON.stringify(compacts, null, 2));
}

export function listCompacts() {
  return load();
}

/** Get compact prompt for a specific color */
export function getCompactByColor(color) {
  return load().find(c => c.color === color) || null;
}

/** Upsert: if a compact with this color exists, overwrite it; otherwise create new */
export function upsertCompact(color, text, title) {
  const compacts = load();
  const idx = compacts.findIndex(c => c.color === color);
  const compact = {
    id: idx !== -1 ? compacts[idx].id : randomUUID(),
    color,
    title: title || null,
    text,
    updatedAt: new Date().toISOString(),
  };
  if (idx !== -1) {
    compacts[idx] = compact;
  } else {
    compacts.push(compact);
  }
  save(compacts);
  return compact;
}

export function reorderCompacts(ids) {
  const compacts = load();
  const byId = new Map(compacts.map(c => [c.id, c]));
  const reordered = ids.map(id => byId.get(id)).filter(Boolean);
  for (const c of compacts) {
    if (!ids.includes(c.id)) reordered.push(c);
  }
  save(reordered);
  return reordered;
}

export function updateCompact(id, { text, title } = {}) {
  const compacts = load();
  const compact = compacts.find(c => c.id === id);
  if (!compact) return null;
  if (text !== undefined) compact.text = text;
  if (title !== undefined) compact.title = title;
  compact.updatedAt = new Date().toISOString();
  save(compacts);
  return compact;
}

export function deleteCompact(id) {
  const compacts = load();
  const idx = compacts.findIndex(c => c.id === id);
  if (idx === -1) return false;
  compacts.splice(idx, 1);
  save(compacts);
  return true;
}
