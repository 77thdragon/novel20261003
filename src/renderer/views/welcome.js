// はじめの画面：作品を開く／作る／最近の作品
import { html } from '../lib.js';
import { useStore, chooseWork, createWork, openWorkAt, set, fail } from '../store.js';
import { api } from '../api.js';
import { Icon } from '../ui.js';
import { fmtDate } from '../util.js';

export function WelcomeView() {
  const s = useStore();
  const forget = async (e, p) => {
    e.stopPropagation();
    try { set({ settings: await api.worksForget(p) }); } catch (err) { fail(err); }
  };
  return html`<div class="welcome">
    <div class="welcome-box">
      <div class="welcome-brand">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="14" width="18" height="6.5" rx="1.2" class="b-fill"/><rect x="6" y="8" width="9" height="6" rx="1.2" class="b-line"/><rect x="13.6" y="2.6" width="6" height="5.6" rx="1.2" transform="rotate(18 16.6 5.4)" class="b-line"/></svg>
        <h1>つみき工房</h1>
      </div>
      <p class="lead">断片から原稿まで、作品フォルダの中だけで扱います。画面からの外部通信はすべて遮断しています（履歴画面でプッシュなどを押したときだけ GitHub と通信します）。</p>
      <div class="welcome-actions">
        <button type="button" class="btn primary" onClick=${chooseWork}><${Icon} name="folder" sm />作品フォルダを開く</button>
        <button type="button" class="btn" onClick=${createWork}><${Icon} name="plus" sm />新しい作品を作る</button>
      </div>
      ${s.settings.recentWorks.length ? html`<div class="recent">
        <div class="label">最近の作品</div>
        ${s.settings.recentWorks.map(w => html`<div class="recent-row" role="button" tabindex="0"
            onClick=${() => openWorkAt(w.path)} onKeyDown=${e => { if (e.key === 'Enter') openWorkAt(w.path); }}>
          <span class="nm">${w.title}</span>
          <small class="mono path">${w.path}</small>
          <small class="when">${fmtDate(w.openedAt)}</small>
          <button type="button" class="icon-btn sm" aria-label="一覧から外す" title="一覧から外す（フォルダは消えません）" onClick=${e => forget(e, w.path)}><${Icon} name="x" sm /></button>
        </div>`)}
      </div>` : null}
    </div>
  </div>`;
}
