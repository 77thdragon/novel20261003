// 断片の保存（断片/YYYY-MM.md）
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFragments, serializeFragments, monthFileName, monthHeader, FRAGMENT_TYPES } from '../shared/fragments.js';
import { newFragmentId, localStamp } from '../shared/ids.js';
import { resolveInside } from './pathsafe.js';
import { atomicWrite } from './workfs.js';

export const FRAGMENT_DIR = '断片';

function checkFile(file) {
  const f = String(file ?? '').replace(/\\/g, '/');
  if (!f.startsWith(FRAGMENT_DIR + '/') || !/\.md$/i.test(f) || f.slice(FRAGMENT_DIR.length + 1).includes('/')) {
    throw new Error('断片ファイルではありません');
  }
  return f;
}

async function load(root, file) {
  try {
    return parseFragments(await fs.readFile(resolveInside(root, file), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function listFragments(root) {
  let names = [];
  try {
    names = (await fs.readdir(path.join(root, FRAGMENT_DIR))).filter(n => /\.md$/i.test(n));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const all = [];
  for (const n of names) {
    const file = `${FRAGMENT_DIR}/${n}`;
    const parsed = await load(root, file);
    for (const it of parsed?.items ?? []) all.push({ ...it, file });
  }
  all.sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  return all;
}

export async function addFragment(root, { type, text, scene = null, src = null }, now = new Date()) {
  const body = String(text ?? '').trim();
  if (!body) throw new Error('断片が空です');
  if (!FRAGMENT_TYPES.includes(type)) throw new Error('断片の種類が不正です');
  const file = `${FRAGMENT_DIR}/${monthFileName(now)}`;
  const parsed = (await load(root, file)) ?? { header: monthHeader(now), items: [] };
  const item = { id: newFragmentId(now), type, scene: scene || null, src: src || null, created: localStamp(now), text: body };
  parsed.items.push(item);
  await atomicWrite(resolveInside(root, file), serializeFragments(parsed.header || monthHeader(now), parsed.items));
  return { ...item, file };
}

export async function updateFragment(root, file, id, patch) {
  const f = checkFile(file);
  const parsed = await load(root, f);
  const it = parsed?.items.find(x => x.id === id);
  if (!it) throw new Error('断片が見つかりません。ほかのアプリで変更された可能性があります');
  if ('text' in patch) {
    const body = String(patch.text ?? '').trim();
    if (!body) throw new Error('断片が空です');
    it.text = body;
  }
  if ('type' in patch) {
    if (!FRAGMENT_TYPES.includes(patch.type)) throw new Error('断片の種類が不正です');
    it.type = patch.type;
  }
  if ('scene' in patch) it.scene = patch.scene || null;
  await atomicWrite(resolveInside(root, f), serializeFragments(parsed.header, parsed.items));
  return { ...it, file: f };
}

export async function removeFragment(root, file, id) {
  const f = checkFile(file);
  const parsed = await load(root, f);
  if (!parsed) return;
  const next = parsed.items.filter(x => x.id !== id);
  if (next.length === parsed.items.length) throw new Error('断片が見つかりません');
  await atomicWrite(resolveInside(root, f), serializeFragments(parsed.header, next));
}
