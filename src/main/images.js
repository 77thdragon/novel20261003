// 人物・舞台の画像（資料/人物/, 資料/舞台/）と .gitignore の切り替え
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveInside } from './pathsafe.js';
import { atomicWrite } from './workfs.js';

export const IMAGE_DIRS = { person: '資料/人物', place: '資料/舞台' };
const EXTS = new Set(['webp', 'png', 'jpg', 'jpeg', 'gif']);
const BLOCK_START = '# >>> tsumiki: 画像はこのPCの中だけに置く（Git に含めない）';
const BLOCK_END = '# <<< tsumiki';

export async function saveImage(root, kind, id, bytes, ext) {
  const dirRel = IMAGE_DIRS[kind];
  if (!dirRel) throw new Error('画像の種類が不正です');
  if (!/^[a-z]_[a-z0-9]+$/.test(String(id))) throw new Error('ID が不正です');
  const e = String(ext).toLowerCase();
  if (!EXTS.has(e)) throw new Error('対応していない画像形式です');
  const dirAbs = resolveInside(root, dirRel);
  await fs.mkdir(dirAbs, { recursive: true });
  for (const n of await fs.readdir(dirAbs)) {
    if (n.startsWith(`${id}.`)) await fs.rm(path.join(dirAbs, n), { force: true });
  }
  const rel = `${dirRel}/${id}.${e}`;
  await atomicWrite(resolveInside(root, rel), Buffer.from(bytes));
  return rel;
}

export function isImagePath(rel) {
  const r = String(rel ?? '').replace(/\\/g, '/');
  return Object.values(IMAGE_DIRS).some(d => r.startsWith(d + '/')) && EXTS.has(path.extname(r).slice(1).toLowerCase());
}

export async function removeImage(root, rel, trash) {
  if (!isImagePath(rel)) throw new Error('画像ファイルではありません');
  const abs = resolveInside(root, rel);
  try {
    await fs.access(abs);
  } catch {
    return;
  }
  await trash(abs);
}

// .gitignore の tsumiki の区画だけを足したり外したりする（ほかの行には触れない）
export async function setImagesIgnored(root, ignored) {
  const abs = path.join(root, '.gitignore');
  let text = '';
  try {
    text = await fs.readFile(abs, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (!ignored) return;
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const out = [];
  let skipping = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === BLOCK_START) { skipping = true; continue; }
    if (skipping) { if (line.trim() === BLOCK_END) skipping = false; continue; }
    out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  if (ignored) {
    if (out.length) out.push('');
    out.push(BLOCK_START, ...Object.values(IMAGE_DIRS).map(d => `${d}/`), BLOCK_END);
  }
  const next = out.length ? out.join(eol) + eol : '';
  if (next !== text) await atomicWrite(abs, next);
}

export async function imagesIgnored(root) {
  try {
    const text = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
    return text.split(/\r?\n/).some(l => l.trim() === BLOCK_START);
  } catch {
    return false;
  }
}
