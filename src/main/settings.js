// この PC だけの設定（最近開いた作品、テーマ、つみきくずしスキルの場所）。作品フォルダには置かない
import fs from 'node:fs/promises';
import { atomicWrite } from './workfs.js';

const DEFAULTS = { theme: 'system', recentWorks: [], skillsDir: '' };
const MAX_RECENT = 10;

export function createSettings(file) {
  let cache = null;

  async function load() {
    if (cache) return cache;
    try {
      cache = { ...DEFAULTS, ...JSON.parse(await fs.readFile(file, 'utf8')) };
    } catch {
      cache = { ...DEFAULTS };
    }
    if (!Array.isArray(cache.recentWorks)) cache.recentWorks = [];
    return cache;
  }

  async function save(patch) {
    const cur = await load();
    const allowed = {};
    for (const k of Object.keys(DEFAULTS)) if (k in patch) allowed[k] = patch[k];
    cache = { ...cur, ...allowed };
    await atomicWrite(file, JSON.stringify(cache, null, 2) + '\n');
    return cache;
  }

  async function addRecent(work) {
    const cur = await load();
    const key = p => p.toLowerCase();
    const list = [{ path: work.path, title: work.title, openedAt: new Date().toISOString() },
      ...cur.recentWorks.filter(w => key(w.path) !== key(work.path))].slice(0, MAX_RECENT);
    return save({ recentWorks: list });
  }

  async function removeRecent(p) {
    const cur = await load();
    return save({ recentWorks: cur.recentWorks.filter(w => w.path.toLowerCase() !== String(p).toLowerCase()) });
  }

  return { load, save, addRecent, removeRecent };
}
