// 履歴（Git）：変更・差分・コミット・履歴・別案・リモート。通信は押したときだけ
import { html, useState, useEffect, useMemo } from '../lib.js';
import {
  S, useStore, set, refreshGit, refreshTree, loadAllData, refreshFragments, flushDoc, openDoc,
  toast, fail, confirmDialog, promptDialog, withBusy,
} from '../store.js';
import { api } from '../api.js';
import { Icon, Empty } from '../ui.js';
import { cls, signed, fmtDate } from '../util.js';
import { sentenceDiff, lineDiff, collapseSame } from '/shared/text.js';

const KIND = { new: ['A', '新規'], modified: ['M', '変更'], deleted: ['D', '削除'], renamed: ['R', '名前変更'], conflict: ['!', '衝突'] };

async function afterCheckout() {
  const path = S.doc?.path;
  await Promise.all([refreshTree(), loadAllData(), refreshFragments(), refreshGit()]);
  if (path) {
    if (await api.exists(path)) await openDoc(path, { view: S.view });
    else set({ doc: null, docDirty: false });
  }
}

function DiffPane({ path }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let alive = true;
    setD(null);
    if (path) api.git.diff(path).then(r => { if (alive) setD(r); }).catch(e => { if (alive) setD({ error: e.message }); });
    return () => { alive = false; };
  }, [path, S.git.status]);
  const rows = useMemo(() => {
    if (!d || d.error || d.binary) return [];
    return collapseSame(d.prose ? sentenceDiff(d.old, d.now) : lineDiff(d.old, d.now), 2);
  }, [d]);
  if (!path) {
    return S.git.status.length
      ? html`<${Empty} title="左の一覧からファイルを選ぶと、差分が出ます" />`
      : html`<${Empty} title="変更はありません">最後のコミットから、作品フォルダの中身は変わっていません。</${Empty}>`;
  }
  if (!d) return html`<p class="note pad">読み込み中…</p>`;
  if (d.error) return html`<p class="note pad">${d.error}</p>`;
  return html`<div class="diff-sheet">
    <div class="fh"><span>${path}</span><span>${KIND[d.kind]?.[1] ?? ''}</span><span>${d.prose ? '文単位（句点ごと）' : '行単位'}</span></div>
    ${d.binary ? html`<p class="note">画像などのファイルは差分を表示しません。</p>` : null}
    ${!d.binary && !rows.length ? html`<p class="note">中身の違いはありません（改行コードなどの違いだけかもしれません）。</p>` : null}
    ${rows.map((r, i) => {
      if (r.type === 'gap') return html`<div key=${i} class="dl gap">…… 変わっていない ${r.count} ${d.prose ? '文' : '行'} ……</div>`;
      if (r.type === 'same') return html`<div key=${i} class=${cls('dl', !d.prose && 'md')} data-g=" ">${r.text}</div>`;
      if (r.type === 'add') return html`<div key=${i} class=${cls('dl add', !d.prose && 'md')} data-g="+"><ins>${r.text}</ins></div>`;
      if (r.type === 'del') return html`<div key=${i} class=${cls('dl del', !d.prose && 'md')} data-g="−"><del>${r.text}</del></div>`;
      return html`<div key=${i} class="dl mod" data-g="~">${r.segs.map(sg => (sg.t === '=' ? sg.s : sg.t === '-' ? html`<del>${sg.s}</del>` : html`<ins>${sg.s}</ins>`))}</div>`;
    })}
  </div>`;
}

function Remote({ info }) {
  const setUrl = async () => {
    const url = await promptDialog({
      title: 'GitHub のリポジトリを設定',
      label: 'リポジトリの URL',
      value: info.remoteUrl || '',
      placeholder: 'https://github.com/ユーザー名/リポジトリ名.git',
      hint: 'GitHub で先に空のリポジトリを作り、その URL を入れます。設定しただけでは何も送りません。',
      ok: '設定する',
    });
    if (!url?.trim()) return;
    try { await api.git.setRemote(url.trim()); await refreshGit(); toast('リモートを設定しました（まだ何も送っていません）'); } catch (e) { fail(e); }
  };
  const fetchIt = async () => {
    if (!(await confirmDialog({ title: 'リモートの状態を確認しますか？', body: html`<p><code>${info.remoteUrl}</code> に接続して、最新の状態を取得します。手元のファイルは変わりません。</p>`, ok: '確認する' }))) return;
    try { await withBusy('リモートを確認しています…', () => api.git.fetch()); await refreshGit(); toast('リモートの状態を確認しました'); } catch (e) { fail(e); }
  };
  const pullIt = async () => {
    if (!(await confirmDialog({ title: 'リモートの変更を取り込みますか？', body: html`<p><code>${info.remoteUrl}</code> から、手元にない変更を取り込みます（早送りできるときだけ。履歴が分かれているときは何もしません）。</p>`, ok: 'プルする' }))) return;
    try {
      await flushDoc();
      await withBusy('取り込んでいます…', () => api.git.pull());
      await afterCheckout();
      toast('リモートの変更を取り込みました');
    } catch (e) { fail(e); }
  };
  const pushIt = async () => {
    try {
      const pv = await api.git.pushPreview();
      if (!pv.commits.length && pv.upstream) { toast('送るコミットはありません'); return; }
      const ok = await confirmDialog({
        title: 'GitHub に送りますか？',
        wide: true,
        body: html`<div class="push-pv">
          <p>次の内容を送信します。送ったあとは、リモートの設定によってはほかの人も見られます。</p>
          <dl class="kv"><dt>送信先</dt><dd class="mono">${pv.remoteUrl}</dd><dt>ブランチ</dt><dd class="mono">${pv.branch}</dd></dl>
          <div class="label">送るコミット（${pv.commits.length}件）</div>
          <ul class="pv-list">${pv.commits.slice(0, 30).map(c => html`<li class="mono">${c}</li>`)}</ul>
        </div>`,
        ok: '送信する',
        danger: true,
      });
      if (!ok) return;
      await withBusy('GitHub に送っています…', () => api.git.push());
      await refreshGit();
      toast('プッシュしました');
    } catch (e) { fail(e); }
  };
  return html`<div class="sec">
    <div class="sec-h"><span class="label">リモート（GitHub）</span></div>
    ${info.remoteUrl ? html`
      <div class="remote-url mono" title=${info.remoteUrl}>${info.remoteUrl}</div>
      <div class="remote-state">${info.upstream ? html`追跡先 <span class="mono">${info.upstream}</span> · 未プッシュ ${info.ahead} · 未取り込み ${info.behind}` : 'まだプッシュしていません'}</div>
      <div class="btn-row">
        <button type="button" class="btn sm" onClick=${fetchIt} title="リモートに接続して状態を確認します"><${Icon} name="refresh" sm />確認</button>
        <button type="button" class="btn sm" onClick=${pullIt} disabled=${!info.upstream}><${Icon} name="pull" sm />プル</button>
        <button type="button" class="btn sm primary" onClick=${pushIt}><${Icon} name="up" sm />プッシュ</button>
      </div>
      <button type="button" class="linkish small" onClick=${setUrl}>URL を変える</button>`
    : html`<p class="note">リモートは未設定です。GitHub に置く場合は URL を設定します。設定しただけでは何も送りません。</p>
      <button type="button" class="btn sm" onClick=${setUrl}>リポジトリの URL を設定</button>`}
  </div>`;
}

function Branches({ list, info }) {
  const create = async () => {
    const name = await promptDialog({ title: '別案をつくる', label: 'ブランチの名前', value: '別案/', hint: '今の状態から分かれて、試し書きできます。気に入らなければ本線に戻るだけです。', ok: 'つくって切り替える' });
    if (!name?.trim() || name.trim() === '別案/') return;
    try { await flushDoc(); await api.git.createBranch(name.trim()); await afterCheckout(); toast(`「${name.trim()}」に切り替えました`); } catch (e) { fail(e); }
  };
  const sw = async b => {
    if (b.current) return;
    if (!(await confirmDialog({ title: `「${b.name}」に切り替えますか？`, body: '作品フォルダのファイルが、そのブランチの内容に変わります。コミットしていない変更があると切り替えられません。', ok: '切り替える' }))) return;
    try { await flushDoc(); await api.git.switchBranch(b.name); await afterCheckout(); toast(`「${b.name}」に切り替えました`); } catch (e) { fail(e); }
  };
  return html`<div class="sec">
    <div class="sec-h"><span class="label">別案（ブランチ）</span><span class="grow"></span>
      <button type="button" class="btn sm ghost" onClick=${create} disabled=${!info.hasCommits}><${Icon} name="plus" sm />別案をつくる</button></div>
    <ul class="branches">
      ${list.map(b => html`<li class=${cls(b.current && 'cur')}><button type="button" onClick=${() => sw(b)} title=${b.current ? '今のブランチ' : '押して切り替える'}>
        <span class="b"></span><span class="nm mono">${b.name}</span>${b.current ? html`<small>いまここ</small>` : null}</button></li>`)}
      ${!list.length ? html`<li class="note">最初のコミットのあとに使えます</li>` : null}
    </ul>
  </div>`;
}

export function HistoryView() {
  const s = useStore();
  const g = s.git;
  const [sel, setSel] = useState(null);
  const [off, setOff] = useState(() => new Set());
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (sel && !g.status.some(x => x.path === sel)) setSel(g.status[0]?.path ?? null);
    if (!sel && g.status.length) setSel(g.status[0].path);
  }, [g.status]);

  if (!g.info) return html`<section class="view"><p class="note pad">読み込み中…</p></section>`;
  if (g.info.gitMissing) return html`<section class="view"><${Empty} title="git コマンドが見つかりません">Git for Windows をインストールすると、履歴を管理できます。</${Empty}></section>`;
  if (!g.info.isRepo) {
    const init = async () => {
      if (!(await confirmDialog({ title: 'このフォルダで Git を始めますか？', body: '作品フォルダの中に履歴（.git）を作ります。この PC の中だけの操作で、GitHub には何も送りません。人物・舞台の画像は初期設定で Git に含めません。', ok: 'Git を始める' }))) return;
      try { await withBusy('準備しています…', () => api.git.init()); await refreshGit(); toast('Git を始めました。最初のコミットをしてください'); } catch (e) { fail(e); }
    };
    return html`<section class="view"><${Empty} title="この作品はまだ Git で管理していません">
      コミットすると、その時点の原稿を何度でも取り出せるようになります。
      <div class="empty-actions"><button type="button" class="btn primary" onClick=${init}>このフォルダで Git を始める</button></div>
    </${Empty}></section>`;
  }

  const chosen = g.status.filter(x => !off.has(x.path));
  const paths = [...new Set(chosen.flatMap(x => (x.orig ? [x.path, x.orig] : [x.path])))];
  const proseDelta = chosen.reduce((a, x) => a + (x.delta || 0), 0);
  const doCommit = async push => {
    if (!msg.trim()) { toast('コミットメッセージを書いてください（例：オープニングを書き始めた）', 'error'); return; }
    if (!paths.length) { toast('コミットするファイルを選んでください', 'error'); return; }
    try {
      await flushDoc();
      await withBusy('コミットしています…', () => api.git.commit(paths, msg.trim()));
      setMsg('');
      setOff(new Set());
      await refreshGit();
      toast('コミットしました');
    } catch (e) { fail(e); }
  };
  const unpushed = g.log.filter(c => c.unpushed);
  const pushed = g.log.filter(c => !c.unpushed);

  return html`<section class="view v-hist" aria-label="履歴">
    <aside class="pane h-ch">
      <div class="sec">
        <span class="label">リポジトリ</span>
        <div class="branch-row"><${Icon} name="branch" sm /><b class="mono">${g.info.branch || '—'}</b>
          ${g.info.prefix ? html`<small class="muted" title=${g.info.top}>親フォルダの Git の一部（${g.info.prefix}）</small>` : null}</div>
      </div>
      <div class="sec">
        <div class="sec-h"><span class="label">変更</span><span class="count">${g.status.length}</span><span class="grow"></span>
          ${g.status.length ? html`<button type="button" class="linkish small" onClick=${() => setOff(off.size ? new Set() : new Set(g.status.map(x => x.path)))}>${off.size ? 'すべて選ぶ' : 'すべて外す'}</button>` : null}</div>
        ${g.status.length ? html`<ul class="changes">
          ${g.status.map(x => html`<li key=${x.path} aria-current=${sel === x.path ? 'true' : undefined} onClick=${() => setSel(x.path)}>
            <input type="checkbox" checked=${!off.has(x.path)} aria-label=${`${x.path} をコミットに含める`}
              onClick=${e => e.stopPropagation()}
              onChange=${e => setOff(prev => { const n = new Set(prev); if (e.target.checked) n.delete(x.path); else n.add(x.path); return n; })} />
            <span class=${cls('gs', KIND[x.kind]?.[0] || 'M')} title=${KIND[x.kind]?.[1]}>${KIND[x.kind]?.[0] || 'M'}</span>
            <span class="nm" title=${x.path}>${x.path}</span>
            ${x.delta !== null && x.delta !== undefined ? html`<span class=${cls('d', x.delta >= 0 ? 'p' : 'm')}>${signed(x.delta)}字</span>` : null}
          </li>`)}
        </ul>` : html`<p class="note">変更はありません。原稿を書くと、ここに並びます。</p>`}
      </div>
      <div class="sec commit-box">
        <label class="label" for="commit-msg">コミットメッセージ</label>
        <textarea id="commit-msg" rows="3" placeholder="何をしたかを一言で（例：オープニングを書き始めた）" value=${msg} onInput=${e => setMsg(e.target.value)}
          onKeyDown=${e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doCommit(false); } }}></textarea>
        <small class="note">${paths.length}ファイル${proseDelta ? ` · 文章 ${signed(proseDelta)}字` : ''}</small>
        <div class="btn-row">
          <button type="button" class="btn primary" onClick=${() => doCommit(false)} disabled=${!g.status.length}>コミット</button>
        </div>
      </div>
      <${Branches} list=${g.branches} info=${g.info} />
      <${Remote} info=${g.info} />
    </aside>
    <div class="h-diff">
      <div class="pane-h"><h2>差分</h2><span class="sub">文章は文単位で比べ、変わった文は文字単位で赤入れします</span>
        <span class="grow"></span><button type="button" class="icon-btn" title="読み直す" aria-label="読み直す" onClick=${refreshGit}><${Icon} name="refresh" /></button></div>
      <div class="diff-scroll"><${DiffPane} path=${sel} /></div>
    </div>
    <aside class="pane h-log">
      <div class="sec">
        <div class="sec-h"><span class="label">履歴</span><span class="count">${g.log.length}</span></div>
        ${unpushed.length ? html`<div class="grp-l">未プッシュ ${unpushed.length}</div>${unpushed.map(c => html`<${Commit} c=${c} />`)}` : null}
        ${pushed.length ? html`<div class="grp-l">${g.info.remoteUrl ? 'プッシュ済み' : 'この PC の履歴'}</div>${pushed.map(c => html`<${Commit} c=${c} />`)}` : null}
        ${!g.log.length ? html`<p class="note">まだコミットがありません。</p>` : null}
      </div>
    </aside>
  </section>`;
}

const Commit = ({ c }) => html`<div class=${cls('cm', c.unpushed && 'local')} key=${c.hash}>
  <span class="nd"></span><span class="t">${c.subject}</span>
  <span class="mt"><span class="mono">${c.short}</span><span>${fmtDate(c.date)}</span></span>
</div>`;
