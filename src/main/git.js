// git コマンドの呼び出し。通信する操作（fetch / pull / push）は、画面で押されたときだけ呼ばれる
import { spawn } from 'node:child_process';

const BASE = ['-c', 'core.quotepath=false', '-c', 'i18n.logOutputEncoding=utf-8', '--literal-pathspecs'];

export function runGit(cwd, args, { input = null, buffer = false, timeout = 120_000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('git', [...BASE, ...args], {
        cwd,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      });
    } catch (error) {
      resolve({ code: 127, stdout: buffer ? Buffer.alloc(0) : '', stderr: String(error.message), error });
      return;
    }
    const out = [];
    const err = [];
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', d => out.push(d));
    child.stderr.on('data', d => err.push(d));
    child.on('error', error => {
      clearTimeout(timer);
      resolve({ code: 127, stdout: buffer ? Buffer.alloc(0) : '', stderr: String(error.message), error });
    });
    child.on('close', code => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out);
      resolve({ code: code ?? 1, stdout: buffer ? stdout : stdout.toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
    });
    if (input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}

function friendly(args, stderr) {
  const s = stderr || '';
  if (/Please tell me who you are|unable to auto-detect email/i.test(s)) {
    return 'Git のユーザー名とメールアドレスが設定されていません（git config --global user.name / user.email）';
  }
  if (/would be overwritten by checkout|would be overwritten by merge|Your local changes/i.test(s)) {
    return '未コミットの変更があるため実行できません。先にコミットしてください';
  }
  if (/Not possible to fast-forward|non-fast-forward|rejected/i.test(s)) {
    return 'リモートと手元の履歴が分かれています。自動では取り込めません';
  }
  if (/Could not resolve host|unable to access|Connection|timed out/i.test(s)) {
    return 'リモートに接続できませんでした。ネットワークと URL を確認してください';
  }
  if (/Authentication failed|could not read Username|Permission denied/i.test(s)) {
    return 'リモートの認証に失敗しました。GitHub へのログイン状態を確認してください';
  }
  if (/nothing to commit|no changes added to commit/i.test(s)) {
    return 'コミットする変更がありません';
  }
  if (/is not a valid branch name|not a valid branch name/i.test(s)) return 'その名前はブランチに使えません';
  if (/already exists/i.test(s)) return '同じ名前がすでにあります';
  const tail = s.trim().split('\n').slice(-2).join(' ').slice(0, 300);
  return `Git の操作に失敗しました（git ${args[0]}）${tail ? '：' + tail : ''}`;
}

async function git(cwd, args, opts) {
  const r = await runGit(cwd, args, opts);
  if (r.code === 127) throw new Error('git コマンドが見つかりません。Git for Windows をインストールしてください');
  if (r.code !== 0) throw new Error(friendly(args, r.stderr));
  return r.stdout;
}

export async function info(cwd) {
  const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (inside.code === 127) return { isRepo: false, gitMissing: true };
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') return { isRepo: false };
  const [top = '', prefix = ''] = (await git(cwd, ['rev-parse', '--show-toplevel', '--show-prefix'])).split('\n');
  const hasCommits = (await runGit(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])).code === 0;
  let branch = (await runGit(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim();
  const detached = !branch;
  if (detached && hasCommits) branch = (await git(cwd, ['rev-parse', '--short', 'HEAD'])).trim();
  const up = await runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const upstream = up.code === 0 ? up.stdout.trim() : null;
  const remotes = (await git(cwd, ['remote'])).split('\n').map(s => s.trim()).filter(Boolean);
  const remoteUrl = remotes.includes('origin') ? (await git(cwd, ['remote', 'get-url', 'origin'])).trim() : null;
  let ahead = 0;
  let behind = 0;
  if (upstream) {
    const [a, b] = (await git(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'])).trim().split(/\s+/).map(Number);
    ahead = a || 0;
    behind = b || 0;
  } else if (hasCommits && remotes.length) {
    const r = await runGit(cwd, ['rev-list', '--count', 'HEAD', '--not', '--remotes']);
    ahead = r.code === 0 ? Number(r.stdout.trim()) || 0 : 0;
  }
  return { isRepo: true, top: top.trim(), prefix: prefix.trim(), hasCommits, branch, detached, upstream, remotes, remoteUrl, ahead, behind };
}

function kindOf(x, y) {
  if (x === '?') return 'new';
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflict';
  if (x === 'R' || x === 'C') return 'renamed';
  if (x === 'A') return y === 'D' ? 'deleted' : 'new';
  if (x === 'D' || y === 'D') return 'deleted';
  return 'modified';
}

// porcelain の出力はリポジトリ直下からのパス。作品フォルダ（prefix）からのパスに直す
export async function status(cwd, prefix = '') {
  const out = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
  const parts = out.split('\0');
  const items = [];
  const strip = p => (!prefix ? p : p.startsWith(prefix) ? p.slice(prefix.length) : null);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p || p.length < 4) continue;
    const x = p[0];
    const y = p[1];
    const file = strip(p.slice(3));
    let orig = null;
    if (x === 'R' || x === 'C') orig = strip(parts[++i] ?? '');
    if (file === null) continue;
    items.push({ path: file, orig, x, y, kind: kindOf(x, y) });
  }
  return items;
}

// HEAD 時点のファイル内容（なければ null）
export async function fileAt(cwd, prefix, rel, rev = 'HEAD') {
  const r = await runGit(cwd, ['show', `${rev}:${prefix}${rel}`], { buffer: true });
  return r.code === 0 ? r.stdout : null;
}

export async function log(cwd, n = 100) {
  const fmt = '%H%x1f%h%x1f%ad%x1f%an%x1f%s%x1e';
  const r = await runGit(cwd, ['log', `-n${n}`, '--date=iso-strict', `--pretty=format:${fmt}`, '--', '.']);
  if (r.code !== 0) return [];
  const i = await info(cwd);
  let unpushed = new Set();
  if (i.upstream) {
    unpushed = new Set((await git(cwd, ['rev-list', '@{u}..HEAD'])).split('\n').filter(Boolean));
  } else if (i.remotes?.length) {
    const u = await runGit(cwd, ['rev-list', 'HEAD', '--not', '--remotes']);
    if (u.code === 0) unpushed = new Set(u.stdout.split('\n').filter(Boolean));
  }
  return r.stdout.split('\x1e').map(s => s.replace(/^\n/, '')).filter(Boolean).map(rec => {
    const [hash, short, date, author, subject] = rec.split('\x1f');
    return { hash, short, date, author, subject, unpushed: unpushed.has(hash) };
  });
}

export async function commit(cwd, paths, message) {
  const msg = String(message ?? '').trim();
  if (!msg) throw new Error('コミットメッセージを書いてください');
  if (!paths?.length) throw new Error('コミットするファイルを選んでください');
  const list = paths.join('\0');
  await git(cwd, ['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: list });
  await git(cwd, ['commit', '-m', msg, '--pathspec-from-file=-', '--pathspec-file-nul'], { input: list });
  return (await git(cwd, ['rev-parse', '--short', 'HEAD'])).trim();
}

export async function init(cwd) {
  await git(cwd, ['init', '-b', 'main']);
}

export async function branches(cwd) {
  // for-each-ref の書式では「%1f」が制御文字 0x1f になる（log の %x1f とは書き方が違う）
  const r = await runGit(cwd, ['branch', '--format=%(HEAD)%1f%(refname:short)']);
  if (r.code !== 0) return [];
  return r.stdout.split('\n').filter(Boolean).map(l => {
    const [head, name] = l.split('\x1f');
    return { name, current: head === '*' };
  });
}

export async function createBranch(cwd, name) {
  const n = String(name ?? '').trim();
  const chk = await runGit(cwd, ['check-ref-format', '--branch', n]);
  if (!n || chk.code !== 0) throw new Error('その名前はブランチに使えません');
  await git(cwd, ['switch', '-c', n]);
}

export async function switchBranch(cwd, name) {
  await git(cwd, ['switch', String(name)]);
}

export function checkRemoteUrl(url) {
  const u = String(url ?? '').trim();
  if (/^(https:\/\/|ssh:\/\/|git@|file:\/\/)/i.test(u) || /^[a-zA-Z]:[\\/]/.test(u) || u.startsWith('/')) return u;
  throw new Error('URL の形式が違います（例：https://github.com/ユーザー名/リポジトリ名.git）');
}

export async function setRemote(cwd, url) {
  const u = checkRemoteUrl(url);
  const remotes = (await git(cwd, ['remote'])).split('\n').map(s => s.trim()).filter(Boolean);
  if (remotes.includes('origin')) await git(cwd, ['remote', 'set-url', 'origin', u]);
  else await git(cwd, ['remote', 'add', 'origin', u]);
}

export async function pushPreview(cwd) {
  const i = await info(cwd);
  const range = i.upstream ? ['@{u}..HEAD'] : ['HEAD', '--not', '--remotes'];
  const r = i.hasCommits ? await runGit(cwd, ['log', '--pretty=format:%h %s', ...range]) : { code: 1 };
  return {
    remoteUrl: i.remoteUrl,
    branch: i.branch,
    upstream: i.upstream,
    commits: r.code === 0 ? r.stdout.split('\n').filter(Boolean) : [],
  };
}

export async function fetchRemote(cwd) {
  await git(cwd, ['fetch', '--prune', 'origin'], { timeout: 300_000 });
}

export async function pull(cwd) {
  const i = await info(cwd);
  if (!i.upstream) throw new Error('このブランチはまだリモートと結びついていません。先にプッシュしてください');
  await git(cwd, ['pull', '--ff-only'], { timeout: 300_000 });
}

export async function push(cwd) {
  const i = await info(cwd);
  if (!i.remotes?.includes('origin')) throw new Error('リモートが設定されていません');
  if (i.detached) throw new Error('ブランチに切り替えてから実行してください');
  await git(cwd, i.upstream ? ['push'] : ['push', '-u', 'origin', i.branch], { timeout: 300_000 });
}
