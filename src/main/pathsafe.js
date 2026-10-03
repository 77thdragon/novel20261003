// 作品フォルダの外へのアクセスを防ぐ
import path from 'node:path';

export function resolveInside(root, rel, { allowRoot = false } = {}) {
  if (typeof rel !== 'string' || rel.includes('\0')) throw new Error('パスが不正です');
  const cleaned = rel.replace(/\\/g, '/');
  if (path.isAbsolute(cleaned) || /^[a-zA-Z]:/.test(cleaned) || cleaned.startsWith('//')) {
    throw new Error('作品フォルダの外は扱えません');
  }
  const abs = path.resolve(root, cleaned);
  const back = path.relative(root, abs);
  if (back === '') {
    if (allowRoot) return abs;
    throw new Error('パスが不正です');
  }
  if (back === '..' || back.startsWith('..' + path.sep) || path.isAbsolute(back)) {
    throw new Error('作品フォルダの外は扱えません');
  }
  return abs;
}

export function toRel(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

// .git の中身はアプリから書き換えない
export function assertWritable(rel) {
  const top = String(rel).replace(/\\/g, '/').split('/').filter(Boolean)[0];
  if (top && top.toLowerCase() === '.git') throw new Error('.git の中は変更できません');
}

// Windows で使えないファイル名を弾く
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function checkFileName(name) {
  const n = String(name ?? '').trim();
  if (!n) return '名前を入力してください';
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(n)) return '次の文字は使えません：< > : " / \\ | ? *';
  if (/[. ]$/.test(n)) return '名前の最後に点や空白は使えません';
  if (RESERVED.test(n)) return 'その名前は Windows で使えません';
  if (n.length > 120) return '名前が長すぎます';
  return null;
}
