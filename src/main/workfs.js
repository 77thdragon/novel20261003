// 作品フォルダのファイル操作（作品フォルダの中だけ）
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveInside, toRel, assertWritable, checkFileName } from './pathsafe.js';

const TEXT_EXT = new Set(['.md', '.txt', '.markdown', '.text']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.tsumiki']);
const MAX_ENTRIES = 5000;
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

// UTF-8（BOM あり・なし）を優先し、だめなら Shift_JIS として読む。どちらでもなければ null
export function decodeBuffer(buf, { partial = false } = {}) {
  let body = buf;
  let bom = false;
  if (body.length >= 3 && body.subarray(0, 3).equals(UTF8_BOM)) { bom = true; body = body.subarray(3); }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body, { stream: partial }), encoding: 'utf-8', bom };
  } catch { /* 次を試す */ }
  try {
    return { text: new TextDecoder('shift_jis', { fatal: true }).decode(body, { stream: partial }), encoding: 'shift_jis', bom: false };
  } catch {
    return null;
  }
}

async function looksLikeText(abs, size) {
  if (size > 2 * 1024 * 1024) return false;
  if (size === 0) return true;
  const fh = await fs.open(abs, 'r');
  try {
    const buf = Buffer.alloc(Math.min(size, 8192));
    await fh.read(buf, 0, buf.length, 0);
    if (buf.includes(0)) return false;
    return decodeBuffer(buf, { partial: true }) !== null;
  } finally {
    await fh.close();
  }
}

export async function listTree(root) {
  const out = [];
  async function walk(dirAbs) {
    let entries;
    try { entries = await fs.readdir(dirAbs, { withFileTypes: true }); } catch { return; }
    // フォルダを先に、その中は名前順
    entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name, 'ja'));
    for (const e of entries) {
      if (out.length >= MAX_ENTRIES) return;
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dirAbs, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        out.push({ path: toRel(root, abs), name: e.name, kind: 'dir' });
        await walk(abs);
      } else if (e.isFile()) {
        let st;
        try { st = await fs.stat(abs); } catch { continue; }
        const ext = path.extname(e.name).toLowerCase();
        const text = TEXT_EXT.has(ext) || (ext === '' && await looksLikeText(abs, st.size).catch(() => false));
        out.push({ path: toRel(root, abs), name: e.name, kind: 'file', ext, text, size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  }
  await walk(root);
  return out;
}

export async function readText(root, rel) {
  const abs = resolveInside(root, rel);
  const [buf, st] = await Promise.all([fs.readFile(abs), fs.stat(abs)]);
  const dec = decodeBuffer(buf);
  if (!dec) throw new Error('テキストとして読めないファイルです');
  return {
    path: rel,
    text: dec.text.replace(/\r\n/g, '\n'),
    encoding: dec.encoding,
    bom: dec.bom,
    eol: dec.text.includes('\r\n') ? 'crlf' : 'lf',
    readonly: dec.encoding !== 'utf-8',
    mtimeMs: st.mtimeMs,
  };
}

// 一時ファイルに書いてから置き換える（書き込み途中で落ちても元のファイルが壊れない）
export async function atomicWrite(abs, data) {
  const dir = path.dirname(abs);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(abs)}.${process.pid}.${Date.now()}.tsumiki-tmp`);
  await fs.writeFile(tmp, data);
  try {
    await fs.rename(tmp, abs);
  } catch {
    // ほかのアプリがファイルを開いていて置き換えられないときは、直接書く
    await fs.writeFile(abs, data);
    await fs.rm(tmp, { force: true });
  }
}

export async function writeText(root, rel, text, { eol = 'lf', bom = false, expectedMtimeMs = null } = {}) {
  assertWritable(rel);
  const abs = resolveInside(root, rel);
  if (expectedMtimeMs != null) {
    try {
      const st = await fs.stat(abs);
      if (Math.abs(st.mtimeMs - expectedMtimeMs) > 1) return { conflict: true, mtimeMs: st.mtimeMs };
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  let body = String(text ?? '').replace(/\r\n/g, '\n');
  if (eol === 'crlf') body = body.replace(/\n/g, '\r\n');
  const data = bom ? Buffer.concat([UTF8_BOM, Buffer.from(body, 'utf8')]) : Buffer.from(body, 'utf8');
  await atomicWrite(abs, data);
  const st = await fs.stat(abs);
  return { conflict: false, mtimeMs: st.mtimeMs };
}

function checkRelName(rel) {
  for (const part of String(rel).replace(/\\/g, '/').split('/').filter(Boolean)) {
    const err = checkFileName(part);
    if (err) throw new Error(err);
  }
}

export async function createText(root, rel, text = '') {
  assertWritable(rel);
  checkRelName(rel);
  const abs = resolveInside(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  try {
    await fs.writeFile(abs, String(text), { flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST') throw new Error('同じ名前のファイルがあります');
    throw e;
  }
  return { path: rel };
}

export async function renamePath(root, from, to) {
  assertWritable(from);
  assertWritable(to);
  checkRelName(to);
  const a = resolveInside(root, from);
  const b = resolveInside(root, to);
  let targetExists = true;
  try { await fs.access(b); } catch (e) { if (e.code === 'ENOENT') targetExists = false; else throw e; }
  // 大文字小文字だけの変更は同じファイルとして許す
  if (targetExists && a.toLowerCase() !== b.toLowerCase()) throw new Error('同じ名前のファイルがあります');
  await fs.mkdir(path.dirname(b), { recursive: true });
  await fs.rename(a, b);
  return { path: to };
}

// 削除はごみ箱へ（trash には Electron の shell.trashItem を渡す）
export async function trashPath(root, rel, trash) {
  assertWritable(rel);
  const abs = resolveInside(root, rel);
  await trash(abs);
}

export async function exists(root, rel) {
  try {
    await fs.access(resolveInside(root, rel, { allowRoot: true }));
    return true;
  } catch {
    return false;
  }
}
