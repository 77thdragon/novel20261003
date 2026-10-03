// 文字数・文分割・差分。main / 画面 / テストの共通部品（依存なしの ES Module）

// ルビ記法 |漢字《かな》 と 漢字《かな》（青空文庫・なろう式）。読みの部分は数えない
const RUBY = /[|｜]([^|｜《\n]+)《[^》\n]*》|(\p{Script=Han}+)《[^》\n]*》/gu;

export function stripRuby(text) {
  return String(text ?? '').replace(RUBY, (m, bar, han) => bar ?? han);
}

// 空白・改行を除いた文字数（サロゲートペアも1文字）
export function countChars(text) {
  if (!text) return 0;
  let n = 0;
  for (const ch of stripRuby(text)) if (!/\s/u.test(ch)) n++;
  return n;
}

// 句点、または閉じかっこが続かない！？で文を区切る。段落（改行）でも区切る
const SENTENCE_END = /(?<=。|[！？!?](?![」』）)！？!?]))/u;

export function splitSentences(text) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    for (const s of para.split(SENTENCE_END)) {
      const t = s.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

export function splitLines(text) {
  const s = String(text ?? '');
  if (s === '') return [];
  return s.replace(/\n$/, '').split('\n');
}

// 最長共通部分列による差分。ops: [['=', x] | ['-', x] | ['+', x]]
const LCS_LIMIT = 4_000_000;

export function lcsOps(a, b, eq = (x, y) => x === y) {
  let start = 0;
  while (start < a.length && start < b.length && eq(a[start], b[start])) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && eq(a[endA - 1], b[endB - 1])) { endA--; endB--; }
  const head = a.slice(0, start).map(x => ['=', x]);
  const tail = a.slice(endA).map(x => ['=', x]);
  const ma = a.slice(start, endA), mb = b.slice(start, endB);
  const n = ma.length, m = mb.length;
  let mid;
  if (n === 0) mid = mb.map(x => ['+', x]);
  else if (m === 0) mid = ma.map(x => ['-', x]);
  else if (n * m > LCS_LIMIT) mid = [...ma.map(x => ['-', x]), ...mb.map(x => ['+', x])];
  else {
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = eq(ma[i], mb[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    mid = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (eq(ma[i], mb[j])) { mid.push(['=', ma[i]]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { mid.push(['-', ma[i]]); i++; }
      else { mid.push(['+', mb[j]]); j++; }
    }
    while (i < n) mid.push(['-', ma[i++]]);
    while (j < m) mid.push(['+', mb[j++]]);
  }
  return [...head, ...mid, ...tail];
}

// 文字単位の差分を、連続する同種をまとめたセグメントにする
export function charSegments(a, b) {
  const segs = [];
  for (const [t, ch] of lcsOps([...a], [...b])) {
    const last = segs[segs.length - 1];
    if (last && last.t === t) last.s += ch; else segs.push({ t, s: ch });
  }
  return segs;
}

// 行（文）の差分を表示用の行にする。削除の直後に追加が続く組は「変更」として文字単位で示す
function toRows(ops, pairMods) {
  const rows = [];
  for (let k = 0; k < ops.length;) {
    if (ops[k][0] === '=') { rows.push({ type: 'same', text: ops[k][1] }); k++; continue; }
    const dels = [], adds = [];
    while (k < ops.length && ops[k][0] === '-') dels.push(ops[k++][1]);
    while (k < ops.length && ops[k][0] === '+') adds.push(ops[k++][1]);
    const pairs = pairMods ? Math.min(dels.length, adds.length) : 0;
    for (let x = 0; x < pairs; x++) rows.push({ type: 'mod', segs: charSegments(dels[x], adds[x]) });
    for (const s of dels.slice(pairs)) rows.push({ type: 'del', text: s });
    for (const s of adds.slice(pairs)) rows.push({ type: 'add', text: s });
  }
  return rows;
}

export function sentenceDiff(oldText, newText) {
  return toRows(lcsOps(splitSentences(oldText), splitSentences(newText)), true);
}

export function lineDiff(oldText, newText) {
  return toRows(lcsOps(splitLines(oldText), splitLines(newText)), false);
}

// 変わっていない行が長く続くところを畳む（前後 context 行は残す）
export function collapseSame(rows, context = 2) {
  const out = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].type !== 'same') { out.push(rows[i]); i++; continue; }
    let j = i;
    while (j < rows.length && rows[j].type === 'same') j++;
    const run = rows.slice(i, j);
    const keepHead = i === 0 ? 0 : context;
    const keepTail = j === rows.length ? 0 : context;
    if (run.length > keepHead + keepTail + 1) {
      out.push(...run.slice(0, keepHead));
      out.push({ type: 'gap', count: run.length - keepHead - keepTail });
      out.push(...run.slice(run.length - keepTail));
    } else {
      out.push(...run);
    }
    i = j;
  }
  return out;
}
