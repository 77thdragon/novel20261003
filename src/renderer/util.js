// 画面の小さな道具

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
export const circled = n => (n >= 1 && n <= 20 ? CIRCLED[n - 1] : String(n));

export const cls = (...xs) => xs.filter(Boolean).join(' ');

export const basename = p => String(p ?? '').split('/').pop();
export const dirname = p => {
  const parts = String(p ?? '').split('/');
  parts.pop();
  return parts.join('/');
};
export const extname = p => {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i).toLowerCase() : '';
};

export function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return `${sameYear ? '' : d.getFullYear() + '/'}${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export const num = n => Number(n || 0).toLocaleString('ja-JP');

export const signed = n => (n > 0 ? `+${num(n)}` : n < 0 ? `−${num(-n)}` : '±0');

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

// 人物の色（CSS 変数 --c-<色>, --c-<色>-soft）
export const COLORS = [
  { key: 'rose', label: 'ばら' },
  { key: 'teal', label: '青緑' },
  { key: 'amber', label: '琥珀' },
  { key: 'indigo', label: '藍' },
  { key: 'green', label: '緑' },
  { key: 'plum', label: '紫' },
  { key: 'slate', label: '灰' },
];

export const SCENE_STATUSES = ['断片', '構築中', '草稿', '執筆中', '推敲', '確定'];
export const STATUS_CLASS = { 断片: 'st-frag', 構築中: 'st-build', 草稿: 'st-draft', 執筆中: 'st-write', 推敲: 'st-write', 確定: 'st-done' };
export const DECISION_STATUSES = ['確定', '保留', '棄却'];

export const imageUrl = (rel, v) => (rel ? `app://work/${encodeURI(rel)}?v=${v || 0}` : null);

// 画像を長辺 max px の WebP にする（この PC の中だけで処理）
export function shrinkImage(file, max = 1024) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) { reject(new Error('画像ファイル（PNG・JPG・WebP など）を選んでください')); return; }
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * r));
      c.height = Math.max(1, Math.round(img.naturalHeight * r));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(src);
      c.toBlob(async blob => {
        if (!blob) { reject(new Error('画像を変換できませんでした')); return; }
        const ext = blob.type === 'image/webp' ? 'webp' : 'png';
        resolve({ bytes: new Uint8Array(await blob.arrayBuffer()), ext });
      }, 'image/webp', 0.88);
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('この画像は読み込めませんでした')); };
    img.src = src;
  });
}

export function pickFile(accept = 'image/*') {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
