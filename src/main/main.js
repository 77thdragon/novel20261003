// つみき工房：Electron のメインプロセス
import { app, BrowserWindow, Menu, protocol, session, ipcMain, dialog, clipboard, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveInside } from './pathsafe.js';
import * as wfs from './workfs.js';
import * as data from './tsdata.js';
import * as frag from './fragstore.js';
import * as images from './images.js';
import * as git from './git.js';
import * as tsumiki from './tsumiki.js';
import { createSettings } from './settings.js';
import { countChars } from '../shared/text.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..');
const PROJECT = path.resolve(SRC, '..');
const RENDERER = path.join(SRC, 'renderer');
const SHARED = path.join(SRC, 'shared');
const VENDOR = {
  htm: path.join(PROJECT, 'node_modules', 'htm'),
  marked: path.join(PROJECT, 'node_modules', 'marked'),
  dompurify: path.join(PROJECT, 'node_modules', 'dompurify'),
};
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const SMOKE = process.env.TSUMIKI_SMOKE ? JSON.parse(process.env.TSUMIKI_SMOKE) : null;
if (SMOKE?.userData) app.setPath('userData', SMOKE.userData);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let win = null;
let work = null;
let settings = null;
const blockedRequests = [];

// ---------- 通信の遮断とセキュリティ ----------
function setupSecurity() {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'] },
    (details, callback) => {
      blockedRequests.push(details.url);
      callback({ cancel: true });
    },
  );
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (e, url) => { if (!url.startsWith('app://ui/')) e.preventDefault(); });
    contents.on('will-attach-webview', e => e.preventDefault());
  });
}

// ---------- app:// プロトコル（画面ファイルと作品内の画像だけ） ----------
function insideOrNull(base, rel) {
  try { return resolveInside(base, rel); } catch { return null; }
}

function resolveUi(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'shared') return insideOrNull(SHARED, parts.slice(1).join('/'));
  if (parts[0] === 'vendor') {
    const base = VENDOR[parts[1]];
    return base ? insideOrNull(base, parts.slice(2).join('/')) : null;
  }
  return insideOrNull(RENDERER, parts.length ? parts.join('/') : 'index.html');
}

function registerProtocol() {
  protocol.handle('app', async request => {
    try {
      const url = new URL(request.url);
      const pathname = decodeURIComponent(url.pathname);
      let file = null;
      if (url.hostname === 'ui') file = resolveUi(pathname);
      else if (url.hostname === 'work' && work) {
        const rel = pathname.replace(/^\/+/, '');
        if (images.isImagePath(rel)) file = insideOrNull(work.root, rel);
      }
      if (!file) return new Response('Not found', { status: 404 });
      const body = await fs.readFile(file);
      return new Response(body, {
        headers: {
          'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'no-store',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------- IPC ----------
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    const from = event.senderFrame?.url ?? '';
    if (!from.startsWith('app://ui/')) return { ok: false, error: '不正な呼び出し元です' };
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });
}

function requireRoot() {
  if (!work) throw new Error('作品が開かれていません');
  return work.root;
}

async function describeWork() {
  const root = requireRoot();
  const initialized = await data.isInitialized(root);
  const meta = initialized ? await data.readData(root, 'work') : null;
  return { root, name: path.basename(root), initialized, title: meta?.title || path.basename(root), meta };
}

async function openWork(root) {
  const abs = path.resolve(String(root));
  let st;
  try { st = await fs.stat(abs); } catch { throw new Error('フォルダが見つかりません'); }
  if (!st.isDirectory()) throw new Error('フォルダを選んでください');
  work = { root: abs };
  const desc = await describeWork();
  await settings.addRecent({ path: abs, title: desc.title });
  if (win) win.setTitle(`${desc.title} — つみき工房`);
  return desc;
}

const PROSE = new Set(['.md', '.txt', '.markdown', '.text', '']);
function isProse(rel) {
  return !rel.startsWith('.tsumiki/') && PROSE.has(path.extname(rel).toLowerCase());
}
function decode(buf) {
  if (!buf) return '';
  return wfs.decodeBuffer(buf)?.text.replace(/\r\n/g, '\n') ?? null;
}

function registerIpc() {
  // この PC の設定と作品
  handle('settings.get', () => settings.load());
  handle('settings.set', patch => settings.save(patch ?? {}));
  handle('works.recent', async () => (await settings.load()).recentWorks);
  handle('works.forget', p => settings.removeRecent(p));
  handle('works.pickFolder', async purpose => {
    const r = await dialog.showOpenDialog(win, {
      title: purpose === 'create' ? '新しい作品のフォルダを選ぶ（空のフォルダ）' : '作品フォルダを開く',
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('work.open', root => openWork(root));
  handle('work.current', () => (work ? describeWork() : null));
  handle('work.init', async title => {
    await data.initWork(requireRoot(), { title });
    const desc = await describeWork();
    await settings.addRecent({ path: desc.root, title: desc.title });
    if (win) win.setTitle(`${desc.title} — つみき工房`);
    return desc;
  });
  handle('work.close', () => { work = null; if (win) win.setTitle('つみき工房'); });

  // ファイル
  handle('files.tree', () => wfs.listTree(requireRoot()));
  handle('files.read', rel => wfs.readText(requireRoot(), rel));
  handle('files.write', (rel, text, opts) => wfs.writeText(requireRoot(), rel, text, opts ?? {}));
  handle('files.create', (rel, text) => wfs.createText(requireRoot(), rel, text ?? ''));
  handle('files.rename', (from, to) => wfs.renamePath(requireRoot(), from, to));
  handle('files.trash', rel => wfs.trashPath(requireRoot(), rel, abs => shell.trashItem(abs)));
  handle('files.exists', rel => wfs.exists(requireRoot(), rel));
  handle('files.reveal', rel => { shell.showItemInFolder(resolveInside(requireRoot(), rel || '.', { allowRoot: true })); });

  // 管理データ
  handle('data.read', name => data.readData(requireRoot(), name));
  handle('data.write', (name, obj) => data.writeData(requireRoot(), name, obj));

  // 断片
  handle('frag.list', () => frag.listFragments(requireRoot()));
  handle('frag.add', f => frag.addFragment(requireRoot(), f ?? {}));
  handle('frag.update', (file, id, patch) => frag.updateFragment(requireRoot(), file, id, patch ?? {}));
  handle('frag.remove', (file, id) => frag.removeFragment(requireRoot(), file, id));

  // 画像
  handle('img.save', async (kind, id, bytes, ext) => {
    const root = requireRoot();
    const rel = await images.saveImage(root, kind, id, bytes, ext);
    const meta = await data.readData(root, 'work');
    if (!meta.imagesInGit) await images.setImagesIgnored(root, true);
    return rel;
  });
  handle('img.remove', rel => images.removeImage(requireRoot(), rel, abs => shell.trashItem(abs)));
  handle('img.setInGit', async inGit => {
    const root = requireRoot();
    const meta = await data.readData(root, 'work');
    await data.writeData(root, 'work', { ...meta, imagesInGit: !!inGit });
    await images.setImagesIgnored(root, !inGit);
    return !!inGit;
  });

  // Git
  handle('git.info', () => git.info(requireRoot()));
  handle('git.status', async () => {
    const root = requireRoot();
    const i = await git.info(root);
    if (!i.isRepo) return [];
    const items = await git.status(root, i.prefix);
    for (const [n, it] of items.entries()) {
      it.prose = isProse(it.path);
      it.delta = null;
      if (!it.prose || n >= 200) continue;
      const before = it.kind === 'new' ? '' : decode(await git.fileAt(root, i.prefix, it.orig || it.path));
      let after = '';
      if (it.kind !== 'deleted') {
        try { after = (await wfs.readText(root, it.path)).text; } catch { after = null; }
      }
      if (before !== null && after !== null) it.delta = countChars(after) - countChars(before);
    }
    return items;
  });
  handle('git.diff', async rel => {
    const root = requireRoot();
    const i = await git.info(root);
    const st = (await git.status(root, i.prefix)).find(s => s.path === rel) ?? null;
    const oldBuf = !st || st.kind === 'new' ? null : await git.fileAt(root, i.prefix, st.orig || rel);
    const old = st && st.kind !== 'new' ? decode(oldBuf) : '';
    let now = null;
    if (st?.kind !== 'deleted') {
      try { now = (await wfs.readText(root, rel)).text; } catch { now = null; }
    } else {
      now = '';
    }
    return { path: rel, kind: st?.kind ?? null, prose: isProse(rel), binary: old === null || now === null, old: old ?? '', now: now ?? '' };
  });
  handle('git.log', () => git.log(requireRoot(), 100));
  handle('git.commit', (paths, message) => git.commit(requireRoot(), paths, message));
  handle('git.init', async () => {
    const root = requireRoot();
    await git.init(root);
    const meta = await data.readData(root, 'work');
    if (!meta.imagesInGit) await images.setImagesIgnored(root, true);
    return git.info(root);
  });
  handle('git.branches', () => git.branches(requireRoot()));
  handle('git.createBranch', name => git.createBranch(requireRoot(), name));
  handle('git.switchBranch', name => git.switchBranch(requireRoot(), name));
  handle('git.setRemote', url => git.setRemote(requireRoot(), url));
  handle('git.pushPreview', () => git.pushPreview(requireRoot()));
  handle('git.fetch', () => git.fetchRemote(requireRoot()));
  handle('git.pull', () => git.pull(requireRoot()));
  handle('git.push', () => git.push(requireRoot()));

  // つみきくずし（ファイルを読むだけ。AI は呼ばない）
  handle('tsumiki.scan', async () => {
    const root = requireRoot();
    const meta = await data.readData(root, 'work');
    return { dir: meta.tsumikiDir || 'つみき', ...(await tsumiki.scan(root, meta.tsumikiDir || 'つみき')) };
  });
  handle('tsumiki.questions', async () => tsumiki.readSkillQuestions((await settings.load()).skillsDir));
  handle('tsumiki.pickSkillsDir', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'つみきくずしのスキルフォルダ（.claude/skills）を選ぶ',
      properties: ['openDirectory'],
    });
    if (r.canceled) return null;
    await settings.save({ skillsDir: r.filePaths[0] });
    return r.filePaths[0];
  });
  handle('tsumiki.answersPath', async (round, phase) => {
    const meta = await data.readData(requireRoot(), 'work');
    return tsumiki.answersPath(meta.tsumikiDir || 'つみき', round, phase);
  });

  handle('clip.write', text => { clipboard.writeText(String(text ?? '')); });
  handle('smoke.blocked', () => blockedRequests.slice());
}

// ---------- ウィンドウ ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'つみき工房',
    backgroundColor: '#E7EAEE',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      offscreen: !!SMOKE,
    },
  });
  win.once('ready-to-show', () => { if (!SMOKE) win.show(); });
  win.loadURL(`app://ui/index.html${SMOKE ? '?smoke=1' : ''}`);
  if (SMOKE) runSmoke().catch(e => { console.error(e); app.exit(2); });
}

// ---------- 画面スモークテスト（npm run smoke から起動） ----------
async function runSmoke() {
  const errors = [];
  const wc = win.webContents;
  wc.on('console-message', (...args) => {
    const ev = args[0];
    const level = ev && typeof ev === 'object' && 'level' in ev ? ev.level : args[1];
    const message = ev && typeof ev === 'object' && 'message' in ev ? ev.message : args[2];
    if (level === 'error' || level === 3) errors.push(String(message));
  });
  wc.on('render-process-gone', (_e, d) => errors.push(`画面のプロセスが終了：${d.reason}`));
  wc.on('preload-error', (_e, _p, err) => errors.push(`preload：${err}`));
  await new Promise(resolve => wc.once('did-finish-load', resolve));
  const shots = [];
  try {
    await wc.executeJavaScript('window.__tsumikiTest.ready', true);
    for (const step of SMOKE.steps) {
      if (step.run) {
        await wc.executeJavaScript(`(async () => { const T = window.__tsumikiTest; ${step.run}\n })()`, true);
      }
      await new Promise(r => setTimeout(r, step.wait ?? 600));
      if (step.shot) {
        // 画面外描画では、描き直しを促してから撮る
        wc.invalidate();
        await new Promise(r => setTimeout(r, 200));
        const img = await wc.capturePage();
        const file = path.join(SMOKE.out, `${step.shot}.png`);
        await fs.writeFile(file, img.toPNG());
        shots.push(file);
      }
    }
  } catch (e) {
    errors.push(`手順の失敗：${e?.message || e}`);
  }
  const report = { errors, blocked: blockedRequests, shots };
  await fs.writeFile(path.join(SMOKE.out, 'report.json'), JSON.stringify(report, null, 2));
  app.exit(errors.length || blockedRequests.length ? 1 : 0);
}

// ---------- 起動 ----------
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    settings = createSettings(path.join(app.getPath('userData'), 'settings.json'));
    Menu.setApplicationMenu(null);
    setupSecurity();
    registerProtocol();
    registerIpc();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
