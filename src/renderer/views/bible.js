// 設定：人物（画像つき）・舞台・関係（感情マトリクス）・決定ログ
import { html, useState } from '../lib.js';
import {
  S, useStore, saveData, formDialog, promptDialog, confirmDialog, toast, fail, saveImageFor,
  setImagesInGit, newEntityId,
} from '../store.js';
import { api } from '../api.js';
import { Icon, Avatar, Empty, ImageSlot } from '../ui.js';
import { cls, COLORS, DECISION_STATUSES, imageUrl, pickFile } from '../util.js';

const TABS = [
  { key: 'people', label: '人物' },
  { key: 'places', label: '舞台' },
  { key: 'matrix', label: '関係' },
  { key: 'decisions', label: '決定ログ' },
];

const lines = v => String(v ?? '').split('\n').map(x => x.trim()).filter(Boolean);

// ---------- 人物 ----------
async function editCharacter(ch) {
  const isNew = !ch;
  const c = ch ?? { id: newEntityId('c'), name: '', short: '', reading: '', initial: '', color: COLORS[S.characters.characters.length % COLORS.length].key, absent: false, facts: [], traits: [], image: null };
  const r = await formDialog({
    title: isNew ? '人物を追加' : `${c.name} を編集`,
    ok: isNew ? '追加' : '保存',
    extra: isNew ? null : { label: '削除', danger: true },
    wide: true,
    fields: [
      { key: 'name', label: '名前', value: c.name, placeholder: '例：山田 花子' },
      { key: 'reading', label: '読み', value: c.reading, placeholder: '例：やまだ・はなこ' },
      { key: 'short', label: '呼び名（カードやアイコンで使う）', value: c.short, placeholder: '例：花子' },
      { key: 'initial', label: 'アイコンの文字（1文字）', value: c.initial, placeholder: '例：花' },
      { key: 'color', label: '色', type: 'color', value: c.color, options: COLORS },
      { key: 'absent', label: '直接描写しない人物（不在の中心など）', type: 'checkbox', value: c.absent },
      { key: 'facts', label: '基本情報（1行に1つ。カードに札で出ます）', type: 'lines', rows: 3, value: c.facts.join('\n'), placeholder: '17歳・高校2年\n図書委員' },
      { key: 'traits', label: '特徴（1行に1つ）', type: 'lines', rows: 5, value: c.traits.join('\n') },
    ],
  });
  if (!r) return;
  const list = S.characters.characters;
  if (r.action === 'extra') {
    if (!(await confirmDialog({ title: `${c.name} を削除しますか？`, body: '人物カードと関係のセルを消します。画像はごみ箱に移します。', ok: '削除する', danger: true }))) return;
    if (c.image) await api.imgRemove(c.image).catch(fail);
    const matrix = Object.fromEntries(Object.entries(S.characters.matrix || {}).filter(([k]) => !k.split('>').includes(c.id)));
    await saveData('characters', { ...S.characters, characters: list.filter(x => x.id !== c.id), matrix });
    return;
  }
  const v = r.values;
  if (!String(v.name).trim()) { toast('名前を入れてください', 'error'); return; }
  const next = {
    ...c, name: v.name.trim(), reading: v.reading.trim(), short: v.short.trim(),
    initial: Array.from(v.initial.trim())[0] || '', color: v.color, absent: !!v.absent,
    facts: lines(v.facts), traits: lines(v.traits),
  };
  await saveData('characters', { ...S.characters, characters: isNew ? [...list, next] : list.map(x => (x.id === c.id ? next : x)) });
}

async function setEntityImage(kind, dataName, listKey, entity, file) {
  try {
    if (!file) return;
    const rel = await saveImageFor(kind, entity.id, file);
    const cur = S[dataName];
    await saveData(dataName, { ...cur, [listKey]: cur[listKey].map(x => (x.id === entity.id ? { ...x, image: rel, imageUpdated: Date.now() } : x)) });
    toast('画像を設定しました（この PC の中だけに保存）');
  } catch (e) {
    fail(e);
  }
}

async function removeEntityImage(dataName, listKey, entity) {
  try {
    await api.imgRemove(entity.image);
    const cur = S[dataName];
    await saveData(dataName, { ...cur, [listKey]: cur[listKey].map(x => (x.id === entity.id ? { ...x, image: null, imageUpdated: Date.now() } : x)) });
    toast('画像を外しました（ファイルはごみ箱へ）');
  } catch (e) {
    fail(e);
  }
}

function People() {
  const s = useStore();
  const list = s.characters?.characters ?? [];
  return html`<div class="bible-inner">
    <div class="people-bar">
      <p class="lead">人物カードは <code>.tsumiki/characters.json</code> に保存します。画像は <code>資料/人物/</code> に置きます。</p>
      <label class="img-git" title="初期設定では .gitignore に入れて、この PC の中だけに置きます">
        <input type="checkbox" checked=${!!s.work.meta?.imagesInGit} onChange=${e => { const v = e.target.checked; e.target.checked = !v; setImagesInGit(v); }} />人物・舞台の画像を GitHub に含める
      </label>
      <button type="button" class="btn sm primary" onClick=${() => editCharacter(null)}><${Icon} name="plus" sm />人物を追加</button>
    </div>
    ${list.length ? html`<div class="people">
      ${list.map(c => html`<article key=${c.id} class=${cls('person', c.absent && 'absent')}>
        <${ImageSlot} label=${c.name} url=${imageUrl(c.image, c.imageUpdated)}
          onPick=${async () => setEntityImage('person', 'characters', 'characters', c, await pickFile())}
          onDrop=${f => setEntityImage('person', 'characters', 'characters', c, f)}
          onRemove=${() => removeEntityImage('characters', 'characters', c)} />
        <div class="ph">
          <${Avatar} ch=${c} size=${38} />
          <div class="ph-text"><h3>${c.name}</h3><div class="ruby">${c.reading}${c.absent ? '（直接描写しない）' : ''}</div></div>
          <button type="button" class="icon-btn sm" title="編集" aria-label=${`${c.name} を編集`} onClick=${() => editCharacter(c)}><${Icon} name="pen" sm /></button>
        </div>
        ${c.facts.length ? html`<div class="facts">${c.facts.map(f => html`<span class="chip">${f}</span>`)}</div>` : null}
        ${c.traits.length ? html`<ul class="bul">${c.traits.map(t => html`<li>${t}</li>`)}</ul>` : null}
      </article>`)}
    </div>` : html`<${Empty} title="まだ人物がいません">「人物を追加」で登録します。画像はカードの枠をクリックするか、画像をドロップします。</${Empty}>`}
  </div>`;
}

// ---------- 舞台 ----------
async function editPlace(p) {
  const isNew = !p;
  const cur = p ?? { id: newEntityId('p'), name: '', memo: '', image: null };
  const r = await formDialog({
    title: isNew ? '舞台を追加' : `${cur.name} を編集`,
    ok: isNew ? '追加' : '保存',
    extra: isNew ? null : { label: '削除', danger: true },
    wide: true,
    fields: [
      { key: 'name', label: '名前', value: cur.name, placeholder: '例：駅前の喫茶店' },
      { key: 'memo', label: 'メモ', type: 'textarea', rows: 8, value: cur.memo },
    ],
  });
  if (!r) return;
  const list = S.places.places;
  if (r.action === 'extra') {
    if (!(await confirmDialog({ title: `${cur.name} を削除しますか？`, ok: '削除する', danger: true }))) return;
    if (cur.image) await api.imgRemove(cur.image).catch(fail);
    await saveData('places', { ...S.places, places: list.filter(x => x.id !== cur.id) });
    return;
  }
  if (!r.values.name.trim()) { toast('名前を入れてください', 'error'); return; }
  const next = { ...cur, name: r.values.name.trim(), memo: r.values.memo };
  await saveData('places', { ...S.places, places: isNew ? [...list, next] : list.map(x => (x.id === cur.id ? next : x)) });
}

function Places() {
  const s = useStore();
  const list = s.places?.places ?? [];
  return html`<div class="bible-inner">
    <div class="people-bar">
      <p class="lead">舞台は <code>.tsumiki/places.json</code> に、画像は <code>資料/舞台/</code> に置きます。</p>
      <button type="button" class="btn sm primary" onClick=${() => editPlace(null)}><${Icon} name="plus" sm />舞台を追加</button>
    </div>
    ${list.length ? html`<div class="people">
      ${list.map(p => html`<article key=${p.id} class="person">
        <${ImageSlot} label=${p.name} url=${imageUrl(p.image, p.imageUpdated)} aspect="16 / 9"
          onPick=${async () => setEntityImage('place', 'places', 'places', p, await pickFile())}
          onDrop=${f => setEntityImage('place', 'places', 'places', p, f)}
          onRemove=${() => removeEntityImage('places', 'places', p)} />
        <div class="ph"><div class="ph-text"><h3>${p.name}</h3></div>
          <button type="button" class="icon-btn sm" title="編集" aria-label=${`${p.name} を編集`} onClick=${() => editPlace(p)}><${Icon} name="pen" sm /></button></div>
        ${p.memo ? html`<p class="pre memo">${p.memo}</p>` : null}
      </article>`)}
    </div>` : html`<${Empty} title="まだ舞台がありません">「舞台を追加」で、場所の名前とメモ、画像を登録します。</${Empty}>`}
  </div>`;
}

// ---------- 関係（感情マトリクス） ----------
function Matrix() {
  const s = useStore();
  const list = s.characters?.characters ?? [];
  const m = s.characters?.matrix ?? {};
  const edit = async (a, b) => {
    const key = `${a.id}>${b.id}`;
    const v = await promptDialog({ title: `${a.short || a.name} → ${b.short || b.name}`, label: '感情・関係', value: m[key] || '', multiline: true, rows: 6, ok: '保存' });
    if (v === null) return;
    const matrix = { ...m };
    if (v.trim()) matrix[key] = v.trim(); else delete matrix[key];
    await saveData('characters', { ...S.characters, matrix });
  };
  if (list.length < 2) return html`<div class="bible-inner"><${Empty} title="人物を2人以上登録すると使えます">行が「誰から」、列が「誰へ」の表になります。</${Empty}></div>`;
  return html`<div class="bible-inner">
    <p class="lead">行が「誰から」、列が「誰へ」。セルを押して書きます。空白のままにしておくのも、ひとつの決め方です。</p>
    <div class="mx-wrap">
      <table class="mx" style=${{ minWidth: `${120 + list.length * 200}px` }}>
        <thead><tr><th scope="col">から ＼ へ</th>${list.map(c => html`<th scope="col"><span class="who"><${Avatar} ch=${c} />${c.short || c.name}</span></th>`)}</tr></thead>
        <tbody>
          ${list.map(a => html`<tr>
            <th scope="row"><span class="who"><${Avatar} ch=${a} />${a.short || a.name}</span></th>
            ${list.map(b => (a.id === b.id
              ? html`<td class="diag">—</td>`
              : html`<td class="cell"><button type="button" class=${cls('mx-cell', !m[`${a.id}>${b.id}`] && 'empty-cell')} onClick=${() => edit(a, b)}>${m[`${a.id}>${b.id}`] || '＋'}</button></td>`))}
          </tr>`)}
        </tbody>
      </table>
    </div>
  </div>`;
}

// ---------- 決定ログ ----------
async function editDecision(item, status) {
  const isNew = !item;
  const d = item ?? { id: newEntityId('d'), status, title: '', note: '', ref: '' };
  const r = await formDialog({
    title: isNew ? `${status}を追加` : '決定ログを編集',
    ok: isNew ? '追加' : '保存',
    extra: isNew ? null : { label: '削除', danger: true },
    fields: [
      { key: 'status', label: '区分', type: 'select', value: d.status, options: DECISION_STATUSES.map(x => ({ value: x, label: x })) },
      { key: 'title', label: '内容', type: 'textarea', rows: 2, value: d.title },
      { key: 'note', label: '理由・補足', type: 'textarea', rows: 3, value: d.note },
      { key: 'ref', label: '参照（例：検討ログ 1-1）', value: d.ref },
    ],
  });
  if (!r) return;
  const items = S.decisions.items;
  if (r.action === 'extra') {
    await saveData('decisions', { ...S.decisions, items: items.filter(x => x.id !== d.id) });
    return;
  }
  if (!r.values.title.trim()) { toast('内容を入れてください', 'error'); return; }
  const next = { ...d, ...r.values, title: r.values.title.trim() };
  await saveData('decisions', { ...S.decisions, items: isNew ? [...items, next] : items.map(x => (x.id === d.id ? next : x)) });
}

function Decisions() {
  const s = useStore();
  const items = s.decisions?.items ?? [];
  const mark = { 確定: 'ok', 保留: 'warn', 棄却: 'shu' };
  return html`<div class="bible-inner">
    <p class="lead">決めたこと・保留にしたこと・採らないと決めた見立てを残します（<code>.tsumiki/decisions.json</code>）。</p>
    <div class="log-cols">
      ${DECISION_STATUSES.map(st => {
        const list = items.filter(x => x.status === st);
        return html`<section class=${cls('logc', st === '棄却' && 'rej')}>
          <h3><i class=${cls('mk', mark[st])}></i>${st}<span class="n">${list.length}</span><span class="grow"></span>
            <button type="button" class="icon-btn sm" title=${`${st}を追加`} aria-label=${`${st}を追加`} onClick=${() => editDecision(null, st)}><${Icon} name="plus" sm /></button></h3>
          <ul>
            ${list.map(d => html`<li key=${d.id} role="button" tabindex="0" onClick=${() => editDecision(d)} onKeyDown=${e => { if (e.key === 'Enter') editDecision(d); }}>
              <span class="t">${d.title}</span>
              ${d.note ? html`<span class="y">${d.note}</span>` : null}
              ${d.ref ? html`<span class="ref">${d.ref}</span>` : null}
            </li>`)}
            ${!list.length ? html`<li class="none">まだありません</li>` : null}
          </ul>
        </section>`;
      })}
    </div>
  </div>`;
}

export function BibleView() {
  const [tab, setTab] = useState('people');
  const Panel = { people: People, places: Places, matrix: Matrix, decisions: Decisions }[tab];
  return html`<section class="view v-bible" aria-label="設定">
    <div class="pane-h">
      <h2>設定</h2>
      <div class="tabs" role="tablist" aria-label="設定の種類">
        ${TABS.map(t => html`<button type="button" role="tab" aria-selected=${tab === t.key} onClick=${() => setTab(t.key)}>${t.label}</button>`)}
      </div>
    </div>
    <div class="bible-body"><${Panel} /></div>
  </section>`;
}
