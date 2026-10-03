// 原稿：ファイル一覧・横書きエディタ・場面の情報
import { html, useState, useRef, useMemo } from '../lib.js';
import {
  S, useStore, set, go, openDoc, editDoc, newDocFile, renameDoc, trashDoc, todayBase,
  addFragment, saveData, toast, formDialog,
} from '../store.js';
import { api } from '../api.js';
import { Icon, Avatar, Empty, characterById } from '../ui.js';
import { cls, num, signed, circled, STATUS_CLASS } from '../util.js';
import { FRAGMENT_TYPES } from '/shared/fragments.js';

const GIT_MARK = { new: 'A', modified: 'M', deleted: 'D', renamed: 'R', conflict: '!' };

// 場面番号（区間の順 → 区間内の並び）
export function sceneNumbers(plot) {
  const map = new Map();
  let n = 0;
  for (const col of plot?.columns ?? []) {
    for (const sc of plot.scenes.filter(x => x.column === col)) map.set(sc.id, ++n);
  }
  return map;
}

function FileTree() {
  const s = useStore();
  const [closed, setClosed] = useState(() => new Set());
  const marks = useMemo(() => new Map(s.git.status.map(x => [x.path, GIT_MARK[x.kind] || 'M'])), [s.git.status]);
  // テキストファイルを含むフォルダだけを出す
  const rows = useMemo(() => {
    const files = s.tree.filter(e => e.kind === 'file' && e.text);
    const dirs = new Set();
    for (const f of files) {
      const parts = f.path.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    }
    return s.tree.filter(e => (e.kind === 'dir' ? dirs.has(e.path) : e.text));
  }, [s.tree]);
  const hidden = path => {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) if (closed.has(parts.slice(0, i).join('/'))) return true;
    return false;
  };
  const toggle = p => setClosed(prev => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  return html`<div class="tree">
    ${rows.filter(e => !hidden(e.path)).map(e => {
      const depth = e.path.split('/').length - 1;
      const pad = { paddingLeft: `${8 + depth * 14}px` };
      if (e.kind === 'dir') {
        return html`<button type="button" class="titem dir" style=${pad} onClick=${() => toggle(e.path)} aria-expanded=${!closed.has(e.path)}>
          <span class=${cls('caret', closed.has(e.path) && 'closed')}>▾</span><${Icon} name="folder" sm /><span class="nm">${e.name}</span>
        </button>`;
      }
      const mark = marks.get(e.path);
      return html`<div class=${cls('titem-row', s.doc?.path === e.path && 'cur')}>
        <button type="button" class="titem" style=${pad} aria-current=${s.doc?.path === e.path ? 'true' : undefined} onClick=${() => openDoc(e.path)} title=${e.path}>
          <${Icon} name="file" sm /><span class="nm">${e.name}</span>
          ${mark ? html`<span class=${cls('gs', mark)} title="Git の状態">${mark}</span>` : null}
        </button>
        <span class="row-tools">
          <button type="button" class="icon-btn sm" title="名前を変える" aria-label=${`${e.name} の名前を変える`} onClick=${() => renameDoc(e.path)}><${Icon} name="pen" sm /></button>
          <button type="button" class="icon-btn sm" title="ごみ箱へ" aria-label=${`${e.name} をごみ箱へ`} onClick=${() => trashDoc(e.path)}><${Icon} name="x" sm /></button>
        </span>
      </div>`;
    })}
    ${!rows.length ? html`<p class="note pad">テキストファイルがまだありません。</p>` : null}
  </div>`;
}

function Inspector() {
  const s = useStore();
  const doc = s.doc;
  const nums = useMemo(() => sceneNumbers(s.plot), [s.plot]);
  if (!doc) return html`<aside class="pane insp"><div class="sec"><p class="note">ファイルを開くと、紐づいた場面や断片がここに出ます。</p></div></aside>`;
  const scenes = (s.plot?.scenes ?? []).filter(x => x.manuscript === doc.path);
  const fromHere = s.fragments.filter(f => f.src === doc.path);
  const unlinked = (s.plot?.scenes ?? []).filter(x => !x.manuscript);
  const link = async id => {
    if (!id) return;
    await saveData('plot', { ...s.plot, scenes: s.plot.scenes.map(x => (x.id === id ? { ...x, manuscript: doc.path } : x)) });
    toast('場面に紐づけました');
  };
  return html`<aside class="pane insp">
    ${scenes.map(sc => {
      const pov = characterById(sc.pov);
      const linked = s.fragments.filter(f => f.scene === sc.id);
      return html`<div class="sec" key=${sc.id}>
        <div class="scene-h">
          <div class="top"><span class="no">${nums.has(sc.id) ? circled(nums.get(sc.id)) : '未配置'}</span><span class=${cls('pill', STATUS_CLASS[sc.status] || 'st-frag')}>${sc.status}</span></div>
          <h3>${sc.title || '（無題の場面）'}</h3>
          ${sc.summary ? html`<p class="s">${sc.summary}</p>` : null}
        </div>
        <dl class="kv">
          <dt>位置</dt><dd>${sc.column || '未配置'}</dd>
          <dt>視点</dt><dd>${pov ? html`<${Avatar} ch=${pov} />${pov.short || pov.name}` : '未定'}</dd>
          ${sc.place ? html`<dt>場所</dt><dd>${sc.place}</dd>` : null}
          ${sc.characters?.length ? html`<dt>人物</dt><dd>${sc.characters.map(id => characterById(id)).filter(Boolean).map(c => html`<span class="who-chip"><${Avatar} ch=${c} />${c.short || c.name}</span>`)}</dd>` : null}
        </dl>
        ${sc.functions ? html`<div class="sub-sec"><span class="label">物語上の機能</span><p class="pre">${sc.functions}</p></div>` : null}
        ${sc.notes ? html`<div class="sub-sec"><span class="label">メモ</span><p class="pre">${sc.notes}</p></div>` : null}
        <div class="sub-sec">
          <div class="sec-h"><span class="label">紐づいた断片</span><span class="count">${linked.length}</span></div>
          ${linked.map(f => html`<div class="mini-frag" key=${f.id}><span class="ftype">${f.type}</span>${f.text}</div>`)}
          ${!linked.length ? html`<p class="note">まだありません。断片画面で「場面に置く」と、ここに出ます。</p>` : null}
        </div>
        <button type="button" class="btn sm" onClick=${() => { set({ plotSelect: sc.id }); go('plot'); }}>プロットで編集</button>
      </div>`;
    })}
    ${!scenes.length ? html`<div class="sec">
      <span class="label">場面</span>
      <p class="note">この原稿はまだ場面に紐づいていません。</p>
      ${unlinked.length ? html`<label class="field"><span class="sr">場面に紐づける</span>
        <select onChange=${e => link(e.target.value)}>
          <option value="">場面に紐づける…</option>
          ${unlinked.map(x => html`<option value=${x.id}>${nums.has(x.id) ? circled(nums.get(x.id)) + ' ' : ''}${x.title || '（無題）'}</option>`)}
        </select></label>` : null}
    </div>` : null}
    ${fromHere.length ? html`<div class="sec">
      <div class="sec-h"><span class="label">このファイルから取り出した断片</span><span class="count">${fromHere.length}</span></div>
      ${fromHere.map(f => html`<div class="mini-frag" key=${f.id}><span class="ftype">${f.type}</span>${f.text}</div>`)}
    </div>` : null}
  </aside>`;
}

export function ManuscriptView() {
  const s = useStore();
  const ta = useRef(null);
  const doc = s.doc;

  const toFragment = async () => {
    const el = ta.current;
    const sel = el ? el.value.slice(el.selectionStart, el.selectionEnd).trim() : '';
    if (!sel) { toast('断片にしたい文章を選んでから押してください'); return; }
    const scenes = s.plot?.scenes ?? [];
    const nums = sceneNumbers(s.plot);
    const r = await formDialog({
      title: '選んだ文章を断片にする',
      ok: '断片にする',
      fields: [
        { key: 'type', label: '種類', type: 'select', value: /^[「『]/.test(sel) ? 'セリフ' : 'シーン', options: FRAGMENT_TYPES.map(t => ({ value: t, label: t })) },
        { key: 'text', label: '文章', type: 'textarea', rows: 5, value: sel },
        { key: 'scene', label: '置く場面', type: 'select', value: scenes.find(x => x.manuscript === doc.path)?.id ?? '',
          options: [{ value: '', label: '（まだ置かない）' }, ...scenes.map(x => ({ value: x.id, label: `${nums.has(x.id) ? circled(nums.get(x.id)) + ' ' : ''}${x.title || '（無題）'}` }))] },
      ],
    });
    if (r?.action !== 'ok') return;
    await addFragment({ type: r.values.type, text: r.values.text, scene: r.values.scene || null, src: doc.path });
  };

  const base = doc ? todayBase(doc.path, s.docChars) : 0;
  return html`<section class="view v-ms" aria-label="原稿">
    <aside class="pane nav">
      <div class="nav-repo"><b>${s.work.title}</b><span class="mono">${s.work.root}</span></div>
      <div class="nav-actions">
        <button type="button" class="btn sm" onClick=${() => newDocFile('原稿')}><${Icon} name="plus" sm />新しい原稿</button>
        <button type="button" class="btn sm ghost" onClick=${() => newDocFile('')} title="作品フォルダの直下に作る">直下に作る</button>
      </div>
      <${FileTree} />
    </aside>
    <div class="ed">
      <div class="ed-bar">
        <span class="crumb">${doc ? html`${doc.path.split('/').slice(0, -1).join(' / ')}${doc.path.includes('/') ? ' / ' : ''}<b>${doc.path.split('/').pop()}</b>` : '原稿'}</span>
        <span class="grow"></span>
        ${doc && !doc.readonly ? html`<button type="button" class="btn sm ghost" onClick=${toFragment} title="選んだ文章を断片として保存します"><${Icon} name="frag" sm />選択を断片にする</button>` : null}
        <button type="button" class="btn sm ghost" aria-pressed=${s.focus} onClick=${() => set({ focus: !s.focus })}><${Icon} name="expand" sm />${s.focus ? '集中を終える' : '集中'}</button>
      </div>
      ${doc ? html`
        ${doc.readonly ? html`<div class="banner warn"><${Icon} name="lock" sm />このファイルは UTF-8 ではない文字コード（${doc.encoding}）なので、読み取り専用で開いています。</div>` : null}
        <div class="ed-scroll">
          <div class="sheet">
            <textarea key=${s.docLoadId} ref=${ta} class="paper" lang="ja" spellcheck="false" aria-label="本文"
              readonly=${doc.readonly} defaultValue=${doc.text} onInput=${e => editDoc(e.target.value)}></textarea>
          </div>
        </div>
        <div class="ed-foot">
          <span>本文 <b class="num">${num(s.docChars)}</b>字</span>
          <span>今日 <b class="num">${signed(s.docChars - base)}</b>字</span>
          <span class="saved">${doc.readonly ? '読み取り専用' : s.docDirty ? '保存待ち…' : 'ディスクに保存済み'}${doc.eol === 'crlf' ? ' · 改行 CRLF' : ''}</span>
        </div>` : html`<div class="ed-scroll"><${Empty} title="ファイルを選んでください">左の一覧から開くか、「新しい原稿」で作ります。<br />入力が止まると自動で保存します。</${Empty}></div>`}
    </div>
    <${Inspector} />
  </section>`;
}
