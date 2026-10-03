// つみきくずしの出力（roundN/）とスキル定義（SKILL.md）を読む。AI は呼ばない
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveInside } from './pathsafe.js';

export const PHASES = [
  { n: 1, label: '種', desc: '核心を掴む', names: ['phase1_種.md'] },
  { n: 2, label: '幹', desc: '構造と関係性', names: ['phase2_幹', 'phase2_幹.md'] },
  { n: 3, label: '枝葉', desc: '描写の設計', names: ['phase3_枝葉', 'phase3_枝葉.md'] },
  { n: 4, label: '検証', desc: '整合性チェック', names: ['phase4_検証.md'] },
];

// 「## 見出し」から次の「## 」までを取り出す
export function extractSection(md, title) {
  const lines = String(md ?? '').split(/\r?\n/);
  const start = lines.findIndex(l => /^##\s+/.test(l) && l.includes(title));
  if (start < 0) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    body.push(lines[i]);
  }
  const text = body.join('\n').trim();
  return text || null;
}

export async function scan(root, dirRel) {
  const dirAbs = resolveInside(root, dirRel || 'つみき');
  let entries;
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return { exists: false, rounds: [] };
    throw e;
  }
  const rounds = [];
  for (const d of entries) {
    const m = d.isDirectory() ? /^round(\d+)$/i.exec(d.name) : null;
    if (!m) continue;
    const rAbs = path.join(dirAbs, d.name);
    const rRel = `${dirRel}/${d.name}`;
    const items = await fs.readdir(rAbs, { withFileTypes: true });
    const names = new Set(items.map(e => e.name));
    const phases = PHASES.map(p => ({ n: p.n, label: p.label, desc: p.desc, done: p.names.some(x => names.has(x)) }));
    const deliverables = [];
    const others = [];
    for (const e of items) {
      if (e.isFile() && /\.md$/i.test(e.name)) {
        (e.name.startsWith('成果物_') ? deliverables : others).push(`${rRel}/${e.name}`);
      } else if (e.isDirectory()) {
        const inner = (await fs.readdir(path.join(rAbs, e.name))).filter(f => /\.md$/i.test(f)).sort((a, b) => a.localeCompare(b, 'ja'));
        for (const f of inner) (e.name.startsWith('成果物_') ? deliverables : others).push(`${rRel}/${e.name}/${f}`);
      }
    }
    deliverables.sort((a, b) => a.localeCompare(b, 'ja'));
    others.sort((a, b) => a.localeCompare(b, 'ja'));
    let judgement = null;
    let focus = null;
    if (names.has('phase4_検証.md')) {
      const t = await fs.readFile(path.join(rAbs, 'phase4_検証.md'), 'utf8');
      judgement = extractSection(t, '蒸留判断');
      focus = extractSection(t, '次ラウンドの焦点');
    }
    rounds.push({ n: Number(m[1]), name: d.name, path: rRel, phases, deliverables, others, judgement, focus });
  }
  rounds.sort((a, b) => a.n - b.n);
  return { exists: true, rounds };
}

// SKILL.md から「### Q1: 手放し質問」と、その直後の引用（> 「…」）を取り出す
export function parseSkillQuestions(md) {
  const lines = String(md ?? '').split(/\r?\n/);
  const out = [];
  let step = '';
  for (let i = 0; i < lines.length; i++) {
    const s = /^##\s+(Step\s*\d+.*)$/.exec(lines[i]);
    if (s) { step = s[1].trim(); continue; }
    const q = /^###\s+Q(\d+)\s*[:：]\s*(.+)$/.exec(lines[i]);
    if (!q) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    const quote = [];
    while (j < lines.length && lines[j].startsWith('>')) { quote.push(lines[j].replace(/^>\s?/, '')); j++; }
    const question = quote.join('\n').trim().replace(/^「([^]*)」$/, '$1');
    out.push({ no: Number(q[1]), title: q[2].trim(), question, step });
  }
  return out;
}

export async function readSkillQuestions(skillsDir) {
  if (!skillsDir || !path.isAbsolute(skillsDir)) return { phases: [] };
  const phases = [];
  for (const p of PHASES) {
    try {
      const md = await fs.readFile(path.join(skillsDir, `tsumiki-phase${p.n}`, 'SKILL.md'), 'utf8');
      phases.push({ n: p.n, label: p.label, questions: parseSkillQuestions(md) });
    } catch {
      phases.push({ n: p.n, label: p.label, questions: [] });
    }
  }
  return { phases };
}

export function answersPath(dirRel, round, phase) {
  const r = Number(round);
  const p = Number(phase);
  if (!Number.isInteger(r) || r < 1 || !Number.isInteger(p) || p < 1 || p > 4) throw new Error('Round とフェーズの指定が不正です');
  return `${dirRel || 'つみき'}/round${r}/回答メモ_phase${p}.md`;
}
