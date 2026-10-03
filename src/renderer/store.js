// 画面全体の状態と操作
import { useState, useLayoutEffect } from './lib.js';
import { api } from './api.js';
import { countChars } from '/shared/text.js';
import { newId } from '/shared/ids.js';
import { debounce, today, shrinkImage } from './util.js';

export const S = {
  ready: false,
  settings: { theme: 'system', recentWorks: [], skillsDir: '' },
  work: null,
  view: 'manuscript',
  tree: [],
  doc: null,
  docLoadId: 0,
  docDirty: false,
  docChars: 0,
  plot: null,
  characters: null,
  places: null,
  decisions: null,
  fragments: [],
  git: { info: null, status: [], log: [], branches: [] },
  toasts: [],
  modal: null,
  busy: null,
  focus: false,
};

const subs = new Set();
let version = 0;
export function set(patch) {
  Object.assign(S, typeof patch === 'function' ? patch(S) : patch);
  version++;
  for (const f of subs) f();
}
// 描画してから購読するまでの間に状態が変わっても取りこぼさない（起動直後の読み込みが速いとき）
export function useStore() {
  const [seen, setSeen] = useState(version);
  useLayoutEffect(() => {
    const f = () => setSeen(version);
    subs.add(f);
    if (version !== seen) f();
    return () => subs.delete(f);
  }, []);
  return S;
}

// ---------- 通知とダイアログ ----------
let toastSeq = 0;
export function toast(message, kind = 'info') {
  const id = ++toastSeq;
  set({ toasts: [...S.toasts, { id, message, kind }] });
  setTimeout(() => set({ toasts: S.toasts.filter(t => t.id !== id) }), kind === 'error' ? 6000 : 3200);
}
export const fail = e => toast(e?.message || String(e), 'error');

function openModal(modal) {
  return new Promise(resolve => set({ modal: { ...modal, resolve: v => { set({ modal: null }); resolve(v); } } }));
}
export const confirmDialog = opts => openModal({ kind: 'confirm', ...opts });
export const promptDialog = opts => openModal({ kind: 'prompt', ...opts });
export const formDialog = opts => openModal({ kind: 'form', ...opts });

export async function withBusy(message, fn) {
  set({ busy: message });
  try { return await fn(); } finally { set({ busy: null }); }
}

// ---------- テーマ ----------
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}
export async function toggleTheme() {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = dark ? 'light' : 'dark';
  applyTheme(theme);
  set({ settings: await api.settingsSet({ theme }) });
}

// ---------- 起動と作品 ----------
export async function boot() {
  try {
    const settings = await api.settingsGet();
    applyTheme(settings.theme);
    set({ settings });
    const cur = await api.workCurrent();
    if (cur) await afterOpen(cur);
  } catch (e) {
    fail(e);
  } finally {
    set({ ready: true });
  }
}

export async function openWorkAt(root) {
  if (!root) return;
  try {
    await flushDoc();
    await afterOpen(await api.workOpen(root));
  } catch (e) {
    fail(e);
  }
}

export async function chooseWork() {
  const root = await api.pickFolder('open');
  if (root) await openWorkAt(root);
}

export async function createWork() {
  const root = await api.pickFolder('create');
  if (!root) return;
  const title = await promptDialog({
    title: '新しい作品',
    label: '題名',
    value: root.split(/[\\/]/).pop(),
    ok: '作る',
  });
  if (title === null) return;
  try {
    await flushDoc();
    await api.workOpen(root);
    const w = await api.workInit(title.trim() || root.split(/[\\/]/).pop());
    await afterOpen(w);
    toast(`「${w.title}」を作りました`);
  } catch (e) {
    fail(e);
  }
}

export async function closeWork() {
  await flushDoc();
  await api.workClose();
  set({ work: null, doc: null, docDirty: false, tree: [], plot: null, characters: null, places: null, decisions: null, fragments: [] });
  set({ settings: await api.settingsGet() });
}

async function afterOpen(w) {
  set({ work: w, doc: null, docDirty: false, docLoadId: S.docLoadId + 1 });
  if (!w.initialized) {
    const ok = await confirmDialog({
      title: 'このフォルダを作品として使います',
      body: `「${w.name}」に管理用のフォルダ .tsumiki/ を作ります。既存のファイルは書き換えません。`,
      ok: '作品として使う',
    });
    if (!ok) {
      await api.workClose();
      set({ work: null });
      return;
    }
    const title = w.name.replace(/^[★☆■□◆◇●○\s]+/, '') || w.name;
    set({ work: await api.workInit(title) });
  }
  await Promise.all([refreshTree(), loadAllData(), refreshFragments(), refreshGit()]);
  set({ settings: await api.settingsGet() });
}

// ---------- ファイル一覧と原稿 ----------
export async function refreshTree() {
  if (!S.work) return;
  try { set({ tree: await api.tree() }); } catch (e) { fail(e); }
}

let pendingText = null;
const saveSoon = debounce(() => flushDoc(), 800);

function todayKey(path) {
  return `today:${today()}:${S.work?.root}:${path}`;
}
export function todayBase(path, chars) {
  try {
    const k = todayKey(path);
    const v = localStorage.getItem(k);
    if (v === null) { localStorage.setItem(k, String(chars)); return chars; }
    return Number(v);
  } catch {
    return chars;
  }
}

export async function openDoc(path, { view = 'manuscript' } = {}) {
  try {
    await flushDoc();
    const f = await api.read(path);
    const chars = countChars(f.text);
    todayBase(path, chars);
    set({ doc: f, docDirty: false, docChars: chars, docLoadId: S.docLoadId + 1, view });
  } catch (e) {
    fail(e);
  }
}

export function editDoc(text) {
  if (!S.doc || S.doc.readonly) return;
  pendingText = text;
  set({ docDirty: true, docChars: countChars(text) });
  saveSoon();
}

export async function flushDoc() {
  saveSoon.cancel();
  if (pendingText === null || !S.doc) return;
  const text = pendingText;
  pendingText = null;
  const d = S.doc;
  try {
    const r = await api.write(d.path, text, { eol: d.eol, bom: d.bom, expectedMtimeMs: d.mtimeMs });
    if (r.conflict) {
      const overwrite = await confirmDialog({
        title: 'ほかのアプリでこのファイルが変更されました',
        body: `「${d.path}」が、このアプリの外で書き換えられています。どちらを残しますか？`,
        ok: 'こちらの内容で上書きする',
        cancel: 'ファイルを読み直す（こちらの変更は捨てる）',
        danger: true,
      });
      if (overwrite) {
        const r2 = await api.write(d.path, text, { eol: d.eol, bom: d.bom });
        set({ doc: { ...S.doc, text, mtimeMs: r2.mtimeMs }, docDirty: pendingText !== null });
      } else {
        await openDoc(d.path);
      }
    } else if (S.doc?.path === d.path) {
      set({ doc: { ...S.doc, text, mtimeMs: r.mtimeMs }, docDirty: pendingText !== null });
    }
    gitSoon();
  } catch (e) {
    pendingText = pendingText ?? text;
    toast(`保存できませんでした：${e.message}`, 'error');
  }
}

// ほかのアプリでの変更を、編集中でなければ読み直す
export async function checkExternalChange() {
  const d = S.doc;
  if (!d || S.docDirty) return;
  try {
    const f = await api.read(d.path);
    if (Math.abs(f.mtimeMs - d.mtimeMs) > 1 && f.text !== d.text) {
      set({ doc: f, docChars: countChars(f.text), docLoadId: S.docLoadId + 1 });
      toast('ほかのアプリでの変更を読み込みました');
    }
  } catch {
    set({ doc: null });
    toast(`「${d.path}」が見つからなくなりました`, 'error');
  }
}

export async function newDocFile(dir = '原稿') {
  const name = await promptDialog({ title: '新しいファイル', label: `${dir}/ に作るファイル名`, value: '', placeholder: '例：02_第二章.md', ok: '作る' });
  if (!name) return null;
  const file = /\.[a-z]+$/i.test(name.trim()) ? name.trim() : `${name.trim()}.md`;
  const rel = dir ? `${dir}/${file}` : file;
  try {
    await api.create(rel, '');
    await refreshTree();
    await openDoc(rel);
    gitSoon();
    return rel;
  } catch (e) {
    fail(e);
    return null;
  }
}

export async function renameDoc(path) {
  const parts = path.split('/');
  const old = parts.pop();
  const name = await promptDialog({ title: '名前を変える', label: '新しい名前', value: old, ok: '変える' });
  if (!name || name === old) return;
  const to = [...parts, name.trim()].join('/');
  try {
    if (S.doc?.path === path) await flushDoc();
    await api.rename(path, to);
    await relinkManuscript(path, to);
    if (S.doc?.path === path) set({ doc: { ...S.doc, path: to } });
    await refreshTree();
    gitSoon();
  } catch (e) {
    fail(e);
  }
}

export async function trashDoc(path) {
  const ok = await confirmDialog({ title: 'ファイルを削除しますか？', body: `「${path}」を Windows のごみ箱に移します。`, ok: 'ごみ箱に移す', danger: true });
  if (!ok) return;
  try {
    if (S.doc?.path === path) { pendingText = null; set({ doc: null, docDirty: false }); }
    await api.trash(path);
    await relinkManuscript(path, null);
    await refreshTree();
    gitSoon();
  } catch (e) {
    fail(e);
  }
}

async function relinkManuscript(from, to) {
  if (!S.plot) return;
  let changed = false;
  const scenes = S.plot.scenes.map(s => {
    if (s.manuscript !== from) return s;
    changed = true;
    return { ...s, manuscript: to };
  });
  if (changed) await saveData('plot', { ...S.plot, scenes });
}

// ---------- 管理データ ----------
export async function loadAllData() {
  try {
    const [plot, characters, places, decisions] = await Promise.all(
      ['plot', 'characters', 'places', 'decisions'].map(n => api.dataRead(n)),
    );
    set({ plot, characters, places, decisions });
  } catch (e) {
    fail(e);
  }
}

export async function saveData(name, obj) {
  set({ [name]: obj });
  try {
    await api.dataWrite(name, obj);
    gitSoon();
  } catch (e) {
    fail(e);
  }
}

export async function saveWorkMeta(patch) {
  const meta = { ...S.work.meta, ...patch };
  try {
    await api.dataWrite('work', meta);
    set({ work: { ...S.work, meta, title: meta.title || S.work.title } });
    gitSoon();
  } catch (e) {
    fail(e);
  }
}

export const newEntityId = prefix => newId(prefix);

// ---------- 断片 ----------
export async function refreshFragments() {
  if (!S.work) return;
  try { set({ fragments: await api.fragList() }); } catch (e) { fail(e); }
}

export async function addFragment(f) {
  try {
    const item = await api.fragAdd(f);
    set({ fragments: [item, ...S.fragments] });
    toast(`断片を ${item.file} に置きました`);
    gitSoon();
    return item;
  } catch (e) {
    fail(e);
    return null;
  }
}

export async function updateFragment(item, patch) {
  try {
    const next = await api.fragUpdate(item.file, item.id, patch);
    set({ fragments: S.fragments.map(x => (x.id === item.id ? next : x)) });
    gitSoon();
  } catch (e) {
    fail(e);
    await refreshFragments();
  }
}

export async function removeFragment(item) {
  const ok = await confirmDialog({ title: '断片を削除しますか？', body: item.text.slice(0, 80), ok: '削除する', danger: true });
  if (!ok) return;
  try {
    await api.fragRemove(item.file, item.id);
    set({ fragments: S.fragments.filter(x => x.id !== item.id) });
    gitSoon();
  } catch (e) {
    fail(e);
  }
}

// ---------- 画像（人物・舞台） ----------
export async function saveImageFor(kind, id, file) {
  const { bytes, ext } = await shrinkImage(file, 1024);
  return api.imgSave(kind, id, bytes, ext);
}

export async function setImagesInGit(v) {
  if (v) {
    const ok = await confirmDialog({
      title: '人物・舞台の画像を Git に含めますか？',
      body: '含めると、次のコミットから画像も履歴に入り、プッシュしたときに GitHub へ送られます。',
      ok: '含める',
      danger: true,
    });
    if (!ok) return;
  }
  try {
    await api.imgSetInGit(v);
    set({ work: { ...S.work, meta: { ...S.work.meta, imagesInGit: v } } });
    toast(v ? '画像も Git に含めます' : '画像は .gitignore に入れて、この PC の中だけに置きます');
    gitSoon();
  } catch (e) {
    fail(e);
  }
}

// ---------- Git ----------
export async function refreshGit() {
  if (!S.work) return;
  try {
    const info = await api.git.info();
    let status = [];
    let log = [];
    let branches = [];
    if (info.isRepo) [status, log, branches] = await Promise.all([api.git.status(), api.git.log(), api.git.branches()]);
    set({ git: { info, status, log, branches } });
  } catch (e) {
    fail(e);
  }
}
export const gitSoon = debounce(() => refreshGit(), 1200);

// ---------- 画面の切り替え ----------
export async function go(view) {
  if (view !== 'manuscript') await flushDoc();
  set({ view });
  if (view === 'history') refreshGit();
}
