// ID の生成（main / 画面の共通部品）

function randomBase36(len) {
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => (b % 36).toString(36)).join('');
}

export function newId(prefix) {
  return `${prefix}_${randomBase36(8)}`;
}

const pad = n => String(n).padStart(2, '0');

// 断片の ID は作成日時が読めるようにする（例：f_20261003104233_a1b2）
export function newFragmentId(date = new Date()) {
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `f_${stamp}_${randomBase36(4)}`;
}

// ローカル時刻の ISO 風表記（タイムゾーンなし）：2026-10-03T10:42:33
export function localStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
