// 作品の管理データ（.tsumiki/*.json）
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite } from './workfs.js';

export const DATA_DIR = '.tsumiki';
export const DEFAULT_COLUMNS = ['冒頭', '序盤', '中盤', '終盤', 'ラスト'];

const DEFAULTS = {
  work: () => ({ version: 1, title: '', tsumikiDir: 'つみき', imagesInGit: false }),
  plot: () => ({ version: 1, columns: [...DEFAULT_COLUMNS], scenes: [], threads: [] }),
  characters: () => ({ version: 1, characters: [], matrix: {} }),
  places: () => ({ version: 1, places: [] }),
  decisions: () => ({ version: 1, items: [] }),
};

export const DATA_NAMES = Object.keys(DEFAULTS);

function fileOf(root, name) {
  if (!DEFAULTS[name]) throw new Error(`不明なデータです：${name}`);
  return path.join(root, DATA_DIR, `${name}.json`);
}

// 足りない項目は初期値で補う（手で編集されて項目が消えていても動くように）
function normalize(name, obj) {
  const base = DEFAULTS[name]();
  const out = { ...base, ...(obj && typeof obj === 'object' ? obj : {}) };
  for (const [k, v] of Object.entries(base)) {
    if (Array.isArray(v) && !Array.isArray(out[k])) out[k] = v;
    if (v && typeof v === 'object' && !Array.isArray(v) && (typeof out[k] !== 'object' || Array.isArray(out[k]) || out[k] === null)) out[k] = v;
  }
  if (name === 'plot' && out.columns.length === 0) out.columns = [...DEFAULT_COLUMNS];
  return out;
}

export async function readData(root, name) {
  const abs = fileOf(root, name);
  let raw;
  try {
    raw = await fs.readFile(abs, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return DEFAULTS[name]();
    throw e;
  }
  try {
    return normalize(name, JSON.parse(raw.replace(/^﻿/, '')));
  } catch {
    throw new Error(`${DATA_DIR}/${name}.json の形式が壊れています。エディタで確認してください`);
  }
}

export async function writeData(root, name, obj) {
  const abs = fileOf(root, name);
  await atomicWrite(abs, JSON.stringify(normalize(name, obj), null, 2) + '\n');
}

export async function isInitialized(root) {
  try {
    await fs.access(path.join(root, DATA_DIR, 'work.json'));
    return true;
  } catch {
    return false;
  }
}

export async function initWork(root, { title }) {
  if (await isInitialized(root)) return readData(root, 'work');
  const work = { ...DEFAULTS.work(), title: String(title || path.basename(root)) };
  await writeData(root, 'work', work);
  return work;
}
