// 断片：書き留める・絞り込む・場面に置く
import { html, useState, useMemo } from '../lib.js';
import { useStore, addFragment, updateFragment, removeFragment, formDialog, openDoc } from '../store.js';
import { Icon, Empty } from '../ui.js';
import { cls, circled } from '../util.js';
import { FRAGMENT_TYPES } from '/shared/fragments.js';
import { sceneNumbers } from './manuscript.js';

export function FragmentsView() {
  const s = useStore();
  const [type, setType] = useState('セリフ');
  const [text, setText] = useState('');
  const [filter, setFilter] = useState('すべて');
  const [q, setQ] = useState('');
  const scenes = s.plot?.scenes ?? [];
  const nums = useMemo(() => sceneNumbers(s.plot), [s.plot]);
  const sceneLabel = id => {
    const sc = scenes.find(x => x.id === id);
    if (!sc) return '（見つからない場面）';
    return `${nums.has(id) ? circled(nums.get(id)) + ' ' : ''}${sc.title || '（無題）'}`;
  };

  const put = async () => {
    if (!text.trim()) return;
    const ok = await addFragment({ type, text });
    if (ok) setText('');
  };

  const loose = s.fragments.filter(f => !f.scene).length;
  const counts = {};
  for (const f of s.fragments) counts[f.type] = (counts[f.type] || 0) + 1;
  const list = s.fragments.filter(f =>
    (filter === 'すべて' || (filter === '未配置' ? !f.scene : f.type === filter))
    && (!q || f.text.includes(q) || (f.src || '').includes(q)));

  const edit = async f => {
    const r = await formDialog({
      title: '断片を編集',
      ok: '保存',
      extra: { label: '削除', danger: true },
      fields: [
        { key: 'type', label: '種類', type: 'select', value: f.type, options: FRAGMENT_TYPES.map(t => ({ value: t, label: t })) },
        { key: 'text', label: '文章', type: 'textarea', rows: 6, value: f.text },
      ],
    });
    if (r?.action === 'extra') return removeFragment(f);
    if (r?.action === 'ok') await updateFragment(f, { type: r.values.type, text: r.values.text });
  };

  return html`<section class="view v-frag" aria-label="断片">
    <div class="pane-h">
      <h2>断片</h2><span class="sub">セリフ・情景・人物のひとこと。まとめる前の素材を <code>断片/</code> に月ごとに貯めます</span>
    </div>
    <div class="frag-body">
      <div class="frag-inner">
        <div class="capture">
          <label class="sr" for="cap-text">新しい断片</label>
          <textarea id="cap-text" placeholder="思いついたことを、そのまま。（Ctrl+Enter で置く）" value=${text}
            onInput=${e => setText(e.target.value)}
            onKeyDown=${e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); put(); } }}></textarea>
          <div class="cap-row">
            <div class="typepick" role="group" aria-label="種類">
              ${FRAGMENT_TYPES.map(t => html`<button type="button" aria-pressed=${type === t} onClick=${() => setType(t)}>${t}</button>`)}
            </div>
            <span class="cap-dest">断片/ の今月のファイルに追記</span>
            <button type="button" class="btn primary" onClick=${put} disabled=${!text.trim()}>置く</button>
          </div>
        </div>
        <div class="filters" role="group" aria-label="絞り込み">
          ${['すべて', ...FRAGMENT_TYPES, '未配置'].map(o => html`<button type="button" aria-pressed=${filter === o} onClick=${() => setFilter(o)}>
            ${o}<span class="n">${o === 'すべて' ? s.fragments.length : o === '未配置' ? loose : counts[o] || 0}</span></button>`)}
          <input class="search-in" type="search" placeholder="文字列で探す" value=${q} onInput=${e => setQ(e.target.value)} aria-label="断片を文字列で探す" />
          <span class="sum">${s.fragments.length}件 · 場面に置いた ${s.fragments.length - loose} · 未配置 ${loose}</span>
        </div>
        ${list.length ? html`<div class="masonry">
          ${list.map(f => html`<article key=${f.id} class=${cls('frag', !f.scene && 'loose')}>
            <header>
              <span class="ftype">${f.type}</span>
              ${f.src ? html`<button type="button" class="fsrc linkish" title="元のファイルを開く" onClick=${() => openDoc(f.src)}>${f.src}</button>` : html`<span class="fsrc">${f.created.slice(0, 10)}</span>`}
            </header>
            <p class="ftext">${f.text}</p>
            <footer>
              ${f.scene ? html`<span class="placed">${sceneLabel(f.scene)}</span>` : html`<span class="muted">どの場面にも置いていない</span>`}
              <select aria-label="場面に置く" value="" onChange=${e => { const v = e.target.value; e.target.value = ''; if (v) updateFragment(f, { scene: v === '__none' ? null : v }); }}>
                <option value="">${f.scene ? '置き場所を変える…' : '場面に置く…'}</option>
                ${scenes.map(x => html`<option value=${x.id}>${sceneLabel(x.id)}</option>`)}
                ${f.scene ? html`<option value="__none">場面から外す</option>` : null}
              </select>
              <button type="button" class="icon-btn sm" title="編集" aria-label="断片を編集" onClick=${() => edit(f)}><${Icon} name="pen" sm /></button>
            </footer>
          </article>`)}
        </div>` : html`<${Empty} title=${s.fragments.length ? '条件に合う断片はありません' : 'まだ断片がありません'}>
          ${s.fragments.length ? '絞り込みを変えてみてください。' : '上の欄に書いて「置く」を押すか、原稿画面で文章を選んで「選択を断片にする」を押します。'}
        </${Empty}>`}
      </div>
    </div>
  </section>`;
}
