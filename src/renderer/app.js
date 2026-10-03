// 画面の骨組み：ヘッダー、工程レール、各画面、ステータスバー
import { html, render, useState, useEffect } from './lib.js';
import {
  S, useStore, boot, go, flushDoc, checkExternalChange, refreshTree, gitSoon, toggleTheme,
  chooseWork, createWork, closeWork, openWorkAt,
} from './store.js';
import { Icon, ModalHost, Toasts, Busy } from './ui.js';
import { cls, num } from './util.js';
import { WelcomeView } from './views/welcome.js';
import { ManuscriptView } from './views/manuscript.js';
import { FragmentsView } from './views/fragments.js';
import { PlotView } from './views/plot.js';
import { BibleView } from './views/bible.js';
import { QuestionsView } from './views/questions.js';
import { HistoryView } from './views/history.js';
import { installTestHooks } from './test-hooks.js';

const RAIL = [
  { view: 'fragments', icon: 'frag', label: '断片' },
  { view: 'questions', icon: 'ask', label: '問い' },
  { view: 'plot', icon: 'plot', label: 'プロット' },
  { view: 'manuscript', icon: 'pen', label: '原稿' },
];
const RAIL_BOTTOM = [
  { view: 'bible', icon: 'book', label: '設定' },
  { view: 'history', icon: 'branch', label: '履歴' },
];

function Rail() {
  const s = useStore();
  const loose = s.fragments.filter(f => !f.scene).length;
  const changes = s.git.status.length;
  const badge = { fragments: loose ? { n: loose, warm: true } : null, history: changes ? { n: changes } : null };
  const item = r => html`<button type="button" class="rail-btn" aria-current=${s.view === r.view ? 'page' : undefined} onClick=${() => go(r.view)}>
    <${Icon} name=${r.icon} />${r.label}
    ${badge[r.view] ? html`<span class=${cls('badge', badge[r.view].warm && 'warm')}>${badge[r.view].n}</span>` : null}
  </button>`;
  return html`<nav class="rail" aria-label="工程">
    ${RAIL.map((r, i) => html`${i ? html`<span class="rail-flow"></span>` : null}${item(r)}`)}
    <div class="rail-spacer"></div>
    <div class="rail-div"></div>
    ${RAIL_BOTTOM.map(item)}
  </nav>`;
}

function WorkMenu({ onClose }) {
  const s = useStore();
  useEffect(() => {
    const off = e => { if (!e.target.closest('.workmenu, .work-btn')) onClose(); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, []);
  const act = fn => () => { onClose(); fn(); };
  const others = s.settings.recentWorks.filter(w => w.path.toLowerCase() !== s.work?.root.toLowerCase()).slice(0, 6);
  return html`<div class="workmenu" role="menu">
    <div class="menu-cur"><b>${s.work?.title}</b><small class="mono">${s.work?.root}</small></div>
    ${others.length ? html`<hr /><div class="menu-label">最近の作品</div>${others.map(w => html`
      <button type="button" role="menuitem" onClick=${act(() => openWorkAt(w.path))}><span class="nm">${w.title}</span><small class="mono">${w.path}</small></button>`)}` : null}
    <hr />
    <button type="button" role="menuitem" onClick=${act(chooseWork)}>作品フォルダを開く…</button>
    <button type="button" role="menuitem" onClick=${act(createWork)}>新しい作品を作る…</button>
    <button type="button" role="menuitem" onClick=${act(closeWork)}>作品を閉じる</button>
  </div>`;
}

function Header() {
  const s = useStore();
  const [menu, setMenu] = useState(false);
  const g = s.git.info;
  return html`<header class="titlebar">
    <div class="brand">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="14" width="18" height="6.5" rx="1.2" class="b-fill"/><rect x="6" y="8" width="9" height="6" rx="1.2" class="b-line"/><rect x="13.6" y="2.6" width="6" height="5.6" rx="1.2" transform="rotate(18 16.6 5.4)" class="b-line"/></svg>
      <span class="nm">つみき工房</span>
    </div>
    <span class="tb-sep"></span>
    <button type="button" class="work-btn" aria-haspopup="true" aria-expanded=${menu} onClick=${() => setMenu(!menu)}>
      ${s.work?.title}<${Icon} name="down" sm />
    </button>
    ${menu ? html`<${WorkMenu} onClose=${() => setMenu(false)} />` : null}
    <span class="grow"></span>
    ${g?.isRepo ? html`<button type="button" class=${cls('sync', !s.git.status.length && !(g.remoteUrl && g.ahead) && 'clean')} onClick=${() => go('history')} title="履歴（Git）を開く">
      <span class="dot"></span><${Icon} name="branch" sm /><span class="txt">${g.branch || '—'}</span>
      ${s.git.status.length ? html`<span class="txt">変更 ${s.git.status.length}</span>` : null}
      ${g.remoteUrl && g.ahead ? html`<span class="txt">未プッシュ ${g.ahead}</span>` : null}
    </button>` : null}
    <button type="button" class="icon-btn" aria-label="ライトとダークを切り替え" title="ライト／ダーク" onClick=${toggleTheme}><${Icon} name="moon" /></button>
  </header>`;
}

function StatusBar() {
  const s = useStore();
  const g = s.git.info;
  return html`<footer class="statusbar">
    ${g?.isRepo ? html`<span class="seg"><${Icon} name="branch" sm />${g.branch}</span><span class="seg">変更 ${s.git.status.length}</span>` : html`<span class="seg">Git 未使用</span>`}
    ${s.doc && s.view === 'manuscript' ? html`<span class="seg">${s.doc.path} · ${num(s.docChars)}字${s.docDirty ? ' · 保存待ち' : ''}</span>` : null}
    <span class="seg offline" title="画面からの外部通信はすべて遮断しています。外に出るのは、履歴画面で押したプッシュ・プル・確認だけです"><${Icon} name="lock" sm />ローカル専用</span>
  </footer>`;
}

function Shell() {
  const s = useStore();
  const View = {
    manuscript: ManuscriptView, fragments: FragmentsView, plot: PlotView,
    bible: BibleView, questions: QuestionsView, history: HistoryView,
  }[s.view] ?? ManuscriptView;
  return html`<div class=${cls('app', s.focus && 'focus')}>
    <${Header} />
    <${Rail} />
    <main class="views"><${View} /></main>
    <${StatusBar} />
  </div>`;
}

function App() {
  const s = useStore();
  if (!s.ready) return null;
  return html`
    ${s.work ? html`<${Shell} />` : html`<${WelcomeView} />`}
    <${ModalHost} />
    <${Toasts} />
    <${Busy} />`;
}

// ほかのアプリでの変更を拾う（ウィンドウに戻ったとき）
window.addEventListener('focus', () => {
  if (!S.work) return;
  checkExternalChange();
  refreshTree();
  gitSoon();
});

// 保存待ちがあるときは、保存してから閉じる
let closing = false;
window.addEventListener('beforeunload', e => {
  if (closing || !S.docDirty) return;
  e.preventDefault();
  e.returnValue = '';
  closing = true;
  flushDoc().finally(() => window.close());
});

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    flushDoc();
  }
});

// 画像を枠の外に落としたとき、ファイルを開いてしまわないようにする
for (const ev of ['dragover', 'drop']) {
  window.addEventListener(ev, e => {
    if (Array.from(e.dataTransfer?.types || []).includes('Files') && !e.defaultPrevented) e.preventDefault();
  });
}

if (new URLSearchParams(location.search).has('smoke')) installTestHooks();
render(html`<${App} />`, document.getElementById('app'));
boot();
