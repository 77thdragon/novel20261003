// 共通の部品：アイコン、人物アイコン、ダイアログ、通知、Markdown 表示
import { html, useState, useEffect, useRef } from './lib.js';
import { mdToHtml } from './lib.js';
import { S, useStore } from './store.js';
import { cls, imageUrl } from './util.js';

export const Icon = ({ name, sm }) => html`<svg class=${cls('i', sm && 'sm')} aria-hidden="true"><use href=${'#i-' + name} /></svg>`;

export function Avatar({ ch, size = 20, title }) {
  if (!ch) return html`<span class="av unk" style=${{ width: size + 'px', height: size + 'px' }} title=${title || '未定'}>？</span>`;
  const url = imageUrl(ch.image, ch.imageUpdated);
  const label = ch.initial || (ch.short || ch.name || '？').slice(0, 1);
  return html`<span
    class=${cls('av', `c-${ch.color || 'slate'}`, ch.absent && 'absent', url && 'has-img')}
    style=${{ width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.5) + 'px', backgroundImage: url ? `url("${url}")` : undefined }}
    title=${title || ch.name}>${url ? '' : label}</span>`;
}

export const Markdown = ({ md }) => html`<div class="md" dangerouslySetInnerHTML=${{ __html: mdToHtml(md) }}></div>`;

export const Empty = ({ title, children }) => html`<div class="empty-state"><b>${title}</b>${children ? html`<div>${children}</div>` : null}</div>`;

// ---------- 通知・処理中 ----------
export function Toasts() {
  const s = useStore();
  return html`<div class="toasts" role="status" aria-live="polite">
    ${s.toasts.map(t => html`<div key=${t.id} class=${cls('toast', t.kind === 'error' && 'error')}>${t.message}</div>`)}
  </div>`;
}

export function Busy() {
  const s = useStore();
  if (!s.busy) return null;
  return html`<div class="busy"><div class="busy-box"><span class="spinner"></span>${s.busy}</div></div>`;
}

// ---------- ダイアログ ----------
function FormField({ f, value, onInput }) {
  const id = `f-${f.key}`;
  if (f.type === 'checkbox') {
    return html`<label class="check-row"><input id=${id} type="checkbox" checked=${!!value} onChange=${e => onInput(e.target.checked)} />${f.label}</label>`;
  }
  let input;
  if (f.type === 'textarea' || f.type === 'lines') {
    input = html`<textarea id=${id} rows=${f.rows || 4} placeholder=${f.placeholder || ''} value=${value ?? ''} onInput=${e => onInput(e.target.value)}></textarea>`;
  } else if (f.type === 'select') {
    input = html`<select id=${id} value=${value ?? ''} onChange=${e => onInput(e.target.value)}>
      ${f.options.map(o => html`<option value=${o.value}>${o.label}</option>`)}
    </select>`;
  } else if (f.type === 'color') {
    input = html`<div class="color-pick" role="radiogroup" aria-label=${f.label}>
      ${f.options.map(o => html`<button type="button" class=${cls('swatch', `c-${o.key}`, value === o.key && 'on')} aria-pressed=${value === o.key} title=${o.label} onClick=${() => onInput(o.key)}></button>`)}
    </div>`;
  } else if (f.type === 'chips') {
    const list = Array.isArray(value) ? value : [];
    input = html`<div class="chip-pick">
      ${f.options.map(o => html`<label class=${cls('chip-opt', list.includes(o.value) && 'on')}>
        <input type="checkbox" checked=${list.includes(o.value)} onChange=${e => onInput(e.target.checked ? [...list, o.value] : list.filter(x => x !== o.value))} />${o.label}</label>`)}
      ${!f.options.length ? html`<span class="muted">${f.empty || 'まだありません'}</span>` : null}
    </div>`;
  } else {
    input = html`<input id=${id} type="text" placeholder=${f.placeholder || ''} value=${value ?? ''} onInput=${e => onInput(e.target.value)} />`;
  }
  return html`<div class="field"><label for=${id}>${f.label}</label>${input}${f.hint ? html`<small class="hint">${f.hint}</small>` : null}</div>`;
}

export function ModalHost() {
  const s = useStore();
  const m = s.modal;
  const [values, setValues] = useState({});
  const boxRef = useRef(null);
  useEffect(() => {
    if (!m) return;
    if (m.kind === 'prompt') setValues({ value: m.value ?? '' });
    if (m.kind === 'form') setValues(Object.fromEntries(m.fields.map(f => [f.key, f.value])));
    setTimeout(() => {
      const el = boxRef.current?.querySelector('input:not([type=checkbox]), textarea, select');
      // 削除などの確認では「やめる」に焦点を置く（Enter の押しまちがいで実行しない）
      (el || boxRef.current?.querySelector('.btn.primary') || boxRef.current?.querySelector('.modal-actions .btn:not(.danger)'))?.focus();
    }, 30);
  }, [m]);
  if (!m) return null;

  const cancel = () => m.resolve(m.kind === 'confirm' ? false : null);
  const ok = () => {
    if (m.kind === 'confirm') m.resolve(true);
    else if (m.kind === 'prompt') m.resolve(values.value ?? '');
    else m.resolve({ action: 'ok', values });
  };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    if (e.key === 'Enter' && (e.ctrlKey || (m.kind !== 'form' && !m.multiline && e.target.tagName !== 'TEXTAREA'))) { e.preventDefault(); ok(); }
  };
  return html`<div class="modal-back" onMouseDown=${e => { if (e.target === e.currentTarget) cancel(); }}>
    <div class=${cls('modal', m.wide && 'wide')} role="dialog" aria-modal="true" aria-label=${m.title} ref=${boxRef} onKeyDown=${onKey}>
      <h2>${m.title}</h2>
      ${m.body ? html`<div class="modal-body">${m.body}</div>` : null}
      ${m.kind === 'prompt' ? html`<div class="field">
        ${m.label ? html`<label for="prompt-input">${m.label}</label>` : null}
        ${m.multiline
          ? html`<textarea id="prompt-input" rows=${m.rows || 6} placeholder=${m.placeholder || ''} value=${values.value ?? ''} onInput=${e => setValues({ value: e.target.value })}></textarea>`
          : html`<input id="prompt-input" type="text" placeholder=${m.placeholder || ''} value=${values.value ?? ''} onInput=${e => setValues({ value: e.target.value })} />`}
        ${m.hint ? html`<small class="hint">${m.hint}</small>` : null}
      </div>` : null}
      ${m.kind === 'form' ? html`<div class="form-grid">
        ${m.fields.map(f => html`<${FormField} key=${f.key} f=${f} value=${values[f.key]} onInput=${v => setValues(p => ({ ...p, [f.key]: v }))} />`)}
      </div>` : null}
      <div class="modal-actions">
        ${m.extra ? html`<button type="button" class=${cls('btn', m.extra.danger ? 'danger-ghost' : 'ghost')} onClick=${() => m.resolve({ action: 'extra' })}>${m.extra.label}</button>` : null}
        <span class="grow"></span>
        <button type="button" class="btn" onClick=${cancel}>${m.cancel || 'やめる'}</button>
        <button type="button" class=${cls('btn', m.danger ? 'danger' : 'primary')} onClick=${ok}>${m.ok || 'OK'}</button>
      </div>
      ${m.kind !== 'confirm' && !m.multiline ? html`<small class="modal-hint">${m.kind === 'form' ? 'Ctrl+Enter で決定' : 'Enter で決定'}・Esc でやめる</small>` : null}
    </div>
  </div>`;
}

// 画像の枠（クリックで選ぶ・ドロップで入れる）
export function ImageSlot({ url, label, onPick, onDrop, onRemove, aspect = '4 / 3' }) {
  const [over, setOver] = useState(false);
  const hasFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files');
  return html`<div class="pimg">
    <button type="button" class=${cls('portrait', url && 'has', over && 'over')} style=${{ aspectRatio: aspect }}
      aria-label=${`${label}の画像を${url ? '変更' : '選ぶ'}`}
      onClick=${onPick}
      onDragOver=${e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); }}
      onDragLeave=${() => setOver(false)}
      onDrop=${e => { if (!hasFiles(e)) return; e.preventDefault(); setOver(false); onDrop(e.dataTransfer.files[0]); }}>
      ${url
        ? html`<img src=${url} alt=${`${label}の画像`} />`
        : html`<span class="ph-empty"><${Icon} name="image" />画像を選ぶ<small>またはここにドロップ</small></span>`}
    </button>
    ${url ? html`<div class="portrait-tools">
      <button type="button" class="btn sm" onClick=${onPick}>変更</button>
      <button type="button" class="btn sm" onClick=${onRemove}>外す</button>
    </div>` : null}
  </div>`;
}

export const characterById = id => S.characters?.characters.find(c => c.id === id) ?? null;
