// プロット：区間×場面カードのボード、未配置のトレイ、糸（伏線・モチーフ）、場面の編集
import { html, useState, useEffect, useMemo, useRef } from '../lib.js';
import {
  S, useStore, set, saveData, openDoc, refreshTree, toast, fail, confirmDialog, promptDialog,
  updateFragment, newEntityId,
} from '../store.js';
import { api } from '../api.js';
import { Icon, Avatar, Empty, characterById } from '../ui.js';
import { cls, circled, SCENE_STATUSES, STATUS_CLASS } from '../util.js';
import { sceneNumbers } from './manuscript.js';

const blankScene = column => ({
  id: newEntityId('s'), title: '新しい場面', summary: '', status: '断片', column: column ?? null,
  pov: null, characters: [], place: '', functions: '', notes: '', manuscript: null,
});

function savePlot(next) { return saveData('plot', next); }

function updateScene(id, patch) {
  const p = S.plot;
  return savePlot({ ...p, scenes: p.scenes.map(x => (x.id === id ? { ...x, ...patch } : x)) });
}

export function moveScene(plot, id, column, beforeId) {
  const moving = plot.scenes.find(x => x.id === id);
  if (!moving) return plot;
  const rest = plot.scenes.filter(x => x.id !== id);
  const moved = { ...moving, column };
  let idx = beforeId ? rest.findIndex(x => x.id === beforeId) : -1;
  if (idx < 0) {
    const last = rest.map(x => x.column).lastIndexOf(column);
    idx = last >= 0 ? last + 1 : rest.length;
  }
  rest.splice(idx, 0, moved);
  return { ...plot, scenes: rest };
}

const safeName = t => String(t || '場面').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/, '').trim().slice(0, 40) || '場面';

async function createManuscript(sc, n) {
  const base = `原稿/${String(n || 0).padStart(2, '0')}_${safeName(sc.title)}`;
  for (let i = 1; i < 50; i++) {
    const rel = i === 1 ? `${base}.md` : `${base}-${i}.md`;
    try {
      await api.create(rel, '');
      await updateScene(sc.id, { manuscript: rel });
      await refreshTree();
      toast(`${rel} を作って紐づけました`);
      return rel;
    } catch (e) {
      if (!/同じ名前/.test(e.message)) { fail(e); return null; }
    }
  }
  return null;
}

// 入力中は手元に持ち、確定（フォーカスが外れた）ときに保存する
function TextField({ label, value, onCommit, multiline, rows = 3, placeholder }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  const commit = () => { if ((value ?? '') !== v) onCommit(v); };
  return html`<label class="field">
    <span>${label}</span>
    ${multiline
      ? html`<textarea rows=${rows} placeholder=${placeholder || ''} value=${v} onInput=${e => setV(e.target.value)} onBlur=${commit}></textarea>`
      : html`<input type="text" placeholder=${placeholder || ''} value=${v} onInput=${e => setV(e.target.value)} onBlur=${commit}
          onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />`}
  </label>`;
}

function SceneEditor({ id, onClose }) {
  const s = useStore();
  const sc = s.plot.scenes.find(x => x.id === id);
  const nums = useMemo(() => sceneNumbers(s.plot), [s.plot]);
  if (!sc) return null;
  const chars = s.characters?.characters ?? [];
  const textFiles = s.tree.filter(e => e.kind === 'file' && e.text);
  const up = patch => updateScene(sc.id, patch);
  const remove = async () => {
    const ok = await confirmDialog({ title: 'この場面を削除しますか？', body: `「${sc.title}」の場面カードを消します。原稿ファイルと断片は残ります（断片は未配置に戻ります）。`, ok: '削除する', danger: true });
    if (!ok) return;
    onClose();
    await savePlot({ ...S.plot, scenes: S.plot.scenes.filter(x => x.id !== sc.id) });
    for (const f of S.fragments.filter(f => f.scene === sc.id)) await updateFragment(f, { scene: null });
  };
  return html`<aside class="drawer" aria-label="場面の編集">
    <div class="drawer-h">
      <span class="no">${nums.has(sc.id) ? circled(nums.get(sc.id)) : '未配置'}</span><b>場面の編集</b><span class="grow"></span>
      <button type="button" class="icon-btn" aria-label="閉じる" onClick=${onClose}><${Icon} name="x" /></button>
    </div>
    <div class="drawer-body" key=${sc.id}>
      <${TextField} label="題名" value=${sc.title} onCommit=${v => up({ title: v.trim() || '（無題）' })} />
      <${TextField} label="概要" value=${sc.summary} multiline rows=${2} onCommit=${v => up({ summary: v })} />
      <div class="field-row">
        <label class="field"><span>状態</span>
          <select value=${sc.status} onChange=${e => up({ status: e.target.value })}>${SCENE_STATUSES.map(x => html`<option value=${x}>${x}</option>`)}</select></label>
        <label class="field"><span>位置</span>
          <select value=${sc.column ?? ''} onChange=${e => savePlot(moveScene(S.plot, sc.id, e.target.value || null, null))}>
            ${s.plot.columns.map(c => html`<option value=${c}>${c}</option>`)}<option value="">未配置</option>
          </select></label>
      </div>
      <label class="field"><span>視点</span>
        <select value=${sc.pov ?? ''} onChange=${e => up({ pov: e.target.value || null })}>
          <option value="">未定</option>${chars.map(c => html`<option value=${c.id}>${c.name}</option>`)}
        </select></label>
      <div class="field"><span>登場人物</span>
        <div class="chip-pick">
          ${chars.map(c => {
            const on = sc.characters?.includes(c.id);
            return html`<label class=${cls('chip-opt', on && 'on')}><input type="checkbox" checked=${on}
              onChange=${e => up({ characters: e.target.checked ? [...(sc.characters || []), c.id] : (sc.characters || []).filter(x => x !== c.id) })} />
              <${Avatar} ch=${c} size=${16} />${c.short || c.name}</label>`;
          })}
          ${!chars.length ? html`<span class="muted">設定画面で人物を登録すると選べます</span>` : null}
        </div>
      </div>
      <${TextField} label="場所" value=${sc.place} onCommit=${v => up({ place: v })} />
      <${TextField} label="物語上の機能" value=${sc.functions} multiline rows=${4} onCommit=${v => up({ functions: v })} />
      <${TextField} label="メモ（確定設定との照合など）" value=${sc.notes} multiline rows=${4} onCommit=${v => up({ notes: v })} />
      <div class="field"><span>原稿</span>
        ${sc.manuscript ? html`<div class="ms-link">
          <span class="mono">${sc.manuscript}</span>
          <button type="button" class="btn sm" onClick=${() => openDoc(sc.manuscript)}>開く</button>
          <button type="button" class="btn sm ghost" onClick=${() => up({ manuscript: null })}>紐づけを外す</button>
        </div>` : html`<div class="ms-link">
          <button type="button" class="btn sm" onClick=${() => createManuscript(sc, nums.get(sc.id))}><${Icon} name="plus" sm />原稿ファイルを作る</button>
          <select aria-label="既存のファイルに紐づける" value="" onChange=${e => { if (e.target.value) up({ manuscript: e.target.value }); }}>
            <option value="">既存のファイルに紐づける…</option>
            ${textFiles.map(f => html`<option value=${f.path}>${f.path}</option>`)}
          </select>
        </div>`}
      </div>
      <button type="button" class="btn sm danger-ghost" onClick=${remove}>この場面を削除</button>
    </div>
  </aside>`;
}

function SceneCard({ sc, n, selected, onSelect, dragState, setDrag }) {
  const s = S;
  const pov = characterById(sc.pov);
  const people = (sc.characters || []).map(characterById).filter(Boolean);
  const nfrag = s.fragments.filter(f => f.scene === sc.id).length;
  return html`<article
    class=${cls('scard', !sc.column && 'unplaced', selected && 'sel', dragState?.id === sc.id && 'dragging', dragState?.before === sc.id && 'drop-before')}
    data-id=${sc.id} draggable="true" tabindex="0"
    onDragStart=${e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-tsumiki-scene', sc.id); setDrag({ id: sc.id, col: undefined, before: null }); }}
    onDragEnd=${() => setDrag(null)}
    onClick=${() => onSelect(sc.id)}
    onKeyDown=${e => { if (e.key === 'Enter') onSelect(sc.id); }}>
    <div class="top">${n ? html`<span class="no">${circled(n)}</span>` : null}<span class=${cls('pill', STATUS_CLASS[sc.status] || 'st-frag')}>${sc.status}</span></div>
    <h4>${sc.title || '（無題）'}</h4>
    ${sc.summary ? html`<p class="ss">${sc.summary}</p>` : null}
    <div class="meta">
      ${pov ? html`<span class="pov"><${Avatar} ch=${pov} size=${16} />${pov.short || pov.name}視点</span>` : html`<span class="pov muted">視点未定</span>`}
      ${people.length ? html`<span class="avs">${people.map(c => html`<${Avatar} ch=${c} size=${18} />`)}</span>` : null}
    </div>
    <div class="foot">
      <span>${sc.manuscript ? '原稿あり' : '原稿なし'}</span><span>断片 ${nfrag}</span>
    </div>
  </article>`;
}

export function PlotView() {
  const s = useStore();
  const [sel, setSel] = useState(() => s.plotSelect ?? null);
  const [drag, setDrag] = useState(null);
  useEffect(() => { if (s.plotSelect) { setSel(s.plotSelect); set({ plotSelect: null }); } }, [s.plotSelect]);
  const plot = s.plot;
  const nums = useMemo(() => sceneNumbers(plot), [plot]);
  if (!plot) return html`<section class="view"><${Empty} title="読み込み中…" /></section>`;

  const cols = plot.columns;
  const empty = cols.filter(c => !plot.scenes.some(x => x.column === c));
  const loose = plot.scenes.filter(x => !x.column);
  const povChars = [...new Set(plot.scenes.map(x => x.pov).filter(Boolean))].map(characterById).filter(Boolean);

  const zoneProps = col => ({
    onDragOver: e => {
      if (!drag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const cards = [...e.currentTarget.querySelectorAll('.scard')].filter(c => c.dataset.id !== drag.id);
      const next = cards.find(c => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      const before = next?.dataset.id ?? null;
      if (drag.col !== col || drag.before !== before) setDrag({ ...drag, col, before });
    },
    onDrop: e => {
      if (!drag) return;
      e.preventDefault();
      const next = moveScene(plot, drag.id, col, drag.before);
      setDrag(null);
      savePlot(next);
    },
  });

  const addScene = async (column = null) => {
    const sc = blankScene(column);
    await savePlot({ ...plot, scenes: [...plot.scenes, sc] });
    setSel(sc.id);
  };

  const addThread = async () => {
    const name = await promptDialog({ title: '糸を追加', label: '伏線・モチーフ・人物の線などの名前', placeholder: '例：古い懐中時計', ok: '追加' });
    if (!name?.trim()) return;
    await savePlot({ ...plot, threads: [...plot.threads, { id: newEntityId('t'), name: name.trim(), note: '', cells: {} }] });
  };

  const editThread = async t => {
    const name = await promptDialog({ title: '糸の名前', label: '名前', value: t.name, ok: '保存' });
    if (name === null) return;
    const note = await promptDialog({ title: '糸の説明', label: '補足（仕掛けの番号など）', value: t.note || '', ok: '保存' });
    if (note === null) return;
    await savePlot({ ...plot, threads: plot.threads.map(x => (x.id === t.id ? { ...x, name: name.trim() || x.name, note } : x)) });
  };

  const removeThread = async t => {
    if (!(await confirmDialog({ title: '糸を削除しますか？', body: `「${t.name}」の行を消します。`, ok: '削除する', danger: true }))) return;
    await savePlot({ ...plot, threads: plot.threads.filter(x => x.id !== t.id) });
  };

  const editCell = async (t, col) => {
    const v = await promptDialog({ title: `${t.name} — ${col}`, label: 'この区間での状態・出来事', value: t.cells?.[col] || '', multiline: true, ok: '保存' });
    if (v === null) return;
    const cells = { ...t.cells };
    if (v.trim()) cells[col] = v.trim(); else delete cells[col];
    await savePlot({ ...plot, threads: plot.threads.map(x => (x.id === t.id ? { ...x, cells } : x)) });
  };

  const editColumns = async () => {
    const v = await promptDialog({ title: '区間を編集', label: '1行に1つずつ（上から順に左から並びます）', value: cols.join('\n'), multiline: true, rows: 7, ok: '保存' });
    if (v === null) return;
    const next = [...new Set(v.split('\n').map(x => x.trim()).filter(Boolean))];
    if (!next.length) { toast('区間を1つ以上入れてください', 'error'); return; }
    // 数が同じなら、位置で対応させて名前を付け替える
    const rename = next.length === cols.length ? Object.fromEntries(cols.map((c, i) => [c, next[i]])) : {};
    const keep = c => (rename[c] ?? (next.includes(c) ? c : null));
    const lost = plot.scenes.filter(x => x.column && keep(x.column) === null).length;
    if (lost && !(await confirmDialog({ title: '区間を減らしますか？', body: `消える区間にある ${lost} 枚の場面は、未配置に戻ります。`, ok: '続ける' }))) return;
    await savePlot({
      ...plot,
      columns: next,
      scenes: plot.scenes.map(x => ({ ...x, column: x.column ? keep(x.column) : null })),
      threads: plot.threads.map(t => ({ ...t, cells: Object.fromEntries(Object.entries(t.cells || {}).map(([k, val]) => [keep(k), val]).filter(([k]) => k)) })),
    });
  };

  const grid = { gridTemplateColumns: `150px repeat(${cols.length}, minmax(190px, 1fr))`, minWidth: `${150 + cols.length * 196}px` };
  const last = i => (i === cols.length - 1 ? 'lastcol' : '');

  return html`<section class="view v-plot" aria-label="プロット">
    <div class="pane-h">
      <h2>プロット</h2><span class="sub">カードはドラッグで移動・並べ替え。押すと右で編集します</span>
      <span class="grow"></span>
      ${povChars.length ? html`<div class="legend">${povChars.map(c => html`<span><${Avatar} ch=${c} size=${14} />${c.short || c.name}視点</span>`)}</div>` : null}
      <button type="button" class="btn sm ghost" onClick=${editColumns}>区間を編集</button>
      <button type="button" class="btn sm" onClick=${addThread}><${Icon} name="plus" sm />糸</button>
      <button type="button" class="btn sm primary" onClick=${() => addScene(null)}><${Icon} name="plus" sm />場面</button>
    </div>
    ${plot.scenes.length && empty.length ? html`<div class="gap-alert"><${Icon} name="warn" sm />${empty.join('・')}に場面がまだありません</div>` : null}
    <div class=${cls('plot-body', sel && 'with-drawer')}>
      <div class="board-wrap">
        <div class="board-scroll">
          <div class="board" style=${grid}>
            <div class="corner"></div>
            ${cols.map((c, i) => html`<div class=${cls('bh', last(i))}>${c}<button type="button" class="icon-btn sm add-in" title=${`${c}に場面を追加`} aria-label=${`${c}に場面を追加`} onClick=${() => addScene(c)}><${Icon} name="plus" sm /></button></div>`)}
            <div class="rh"><b>場面</b><small>${plot.scenes.length}枚</small></div>
            ${cols.map((c, i) => {
              const cards = plot.scenes.filter(x => x.column === c);
              return html`<div class=${cls('drop', last(i), drag?.col === c && 'over', drag?.col === c && !drag.before && 'drop-end')} ...${zoneProps(c)}>
                ${cards.map(sc => html`<${SceneCard} key=${sc.id} sc=${sc} n=${nums.get(sc.id)} selected=${sel === sc.id} onSelect=${setSel} dragState=${drag} setDrag=${setDrag} />`)}
                ${!cards.length ? html`<div class="empty">ここにドロップ</div>` : null}
              </div>`;
            })}
            ${plot.threads.map(t => html`
              <div class="rh thread-h">
                <b>${t.name}</b>${t.note ? html`<small>${t.note}</small>` : null}
                <span class="row-tools">
                  <button type="button" class="icon-btn sm" title="名前と説明を編集" aria-label=${`${t.name} を編集`} onClick=${() => editThread(t)}><${Icon} name="pen" sm /></button>
                  <button type="button" class="icon-btn sm" title="この糸を削除" aria-label=${`${t.name} を削除`} onClick=${() => removeThread(t)}><${Icon} name="x" sm /></button>
                </span>
              </div>
              ${cols.map((c, i) => html`<div class=${last(i)}>
                <button type="button" class=${cls('thread', !t.cells?.[c] && 'empty-cell')} onClick=${() => editCell(t, c)} title="押して編集">${t.cells?.[c] || '＋'}</button>
              </div>`)}`)}
            <div class="addrow"><button type="button" class="btn sm ghost" onClick=${addThread}><${Icon} name="plus" sm />糸（伏線・モチーフ）を追加</button></div>
          </div>
        </div>
        <aside class=${cls('tray', drag?.col === null && 'over')} ...${zoneProps(null)}>
          <div class="tray-h"><b>未配置 <span class="muted">${loose.length}</span></b><small>位置が決まっていない場面。区間へドラッグします</small></div>
          ${loose.map(sc => html`<${SceneCard} key=${sc.id} sc=${sc} selected=${sel === sc.id} onSelect=${setSel} dragState=${drag} setDrag=${setDrag} />`)}
          ${!plot.scenes.length ? html`<p class="note">「＋場面」で最初のカードを作ります。</p>` : null}
        </aside>
      </div>
      ${sel ? html`<${SceneEditor} id=${sel} onClose=${() => setSel(null)} />` : null}
    </div>
  </section>`;
}
