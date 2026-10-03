// 断片ファイル（断片/YYYY-MM.md）の読み書き。メタ情報は HTML コメントに入れる
//
// <!-- tsumiki:fragment id="f_..." type="セリフ" scene="s_..." src="アイデアメモ.txt" created="2026-10-03T10:42:33" -->
// 本文

export const FRAGMENT_TYPES = ['セリフ', 'シーン', 'キャラ', 'モチーフ', '感覚', '設定'];

const MARKER = /<!--\s*tsumiki:fragment\b([^]*?)-->/g;
const ATTR = /([a-z]+)="([^"]*)"/g;
const ATTR_ORDER = ['id', 'type', 'scene', 'src', 'created'];

// コメントの中に入れても壊れないようにする（"--" と改行と引用符を逃がす）
function escapeAttr(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '&#10;')
    .replace(/-(?=-)/g, '&#45;');
}

function unescapeAttr(v) {
  return v
    .replace(/&#45;/g, '-')
    .replace(/&#10;/g, '\n')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

export function parseFragments(markdown) {
  const md = String(markdown ?? '').replace(/\r\n/g, '\n');
  const marks = [...md.matchAll(MARKER)];
  if (!marks.length) return { header: md.trimEnd(), items: [] };
  const header = md.slice(0, marks[0].index).trimEnd();
  const items = marks.map((m, i) => {
    const attrs = {};
    for (const a of m[1].matchAll(ATTR)) attrs[a[1]] = unescapeAttr(a[2]);
    const bodyEnd = i + 1 < marks.length ? marks[i + 1].index : md.length;
    const text = md.slice(m.index + m[0].length, bodyEnd).replace(/^\n/, '').trim();
    return {
      id: attrs.id || '',
      type: attrs.type || '',
      scene: attrs.scene || null,
      src: attrs.src || null,
      created: attrs.created || '',
      text,
    };
  });
  return { header, items };
}

export function serializeFragments(header, items) {
  const head = String(header ?? '').trimEnd();
  const blocks = items.map(it => {
    const attrs = ATTR_ORDER
      .filter(k => it[k] !== null && it[k] !== undefined && it[k] !== '')
      .map(k => `${k}="${escapeAttr(it[k])}"`)
      .join(' ');
    return `<!-- tsumiki:fragment ${attrs} -->\n${String(it.text ?? '').trim()}\n`;
  });
  return (head ? head + '\n\n' : '') + blocks.join('\n');
}

export function monthFileName(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}.md`;
}

export function monthHeader(date = new Date()) {
  return `# 断片 ${date.getFullYear()}年${date.getMonth() + 1}月`;
}
