// 問い：つみきくずしの進み具合と成果物を読む。AI は呼ばない（実行は Claude Code で）
import { html, useState, useEffect } from '../lib.js';
import { useStore, set, toast, fail, promptDialog, openDoc, saveWorkMeta, gitSoon, refreshTree } from '../store.js';
import { api } from '../api.js';
import { Icon, Empty, Markdown } from '../ui.js';
import { cls, basename } from '../util.js';

const PHASE_NAMES = { 1: '種', 2: '幹', 3: '枝葉', 4: '検証' };

export function parseAnswers(md) {
  const out = {};
  const parts = String(md ?? '').replace(/\r\n/g, '\n').split(/^## Q(\d+)[^\n]*\n/m);
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1].split('\n');
    while (body.length && (body[0].startsWith('>') || body[0].trim() === '')) body.shift();
    out[Number(parts[i])] = body.join('\n').trim();
  }
  return out;
}

function serializeAnswers(round, phase, questions, answers) {
  const head = `# 回答メモ Phase ${phase}「${PHASE_NAMES[phase]}」（Round ${round}）\n\nつみき工房で書いた回答メモです。Claude Code でつみきくずしを実行するときの材料にします。\n`;
  const body = questions.map(q => {
    const quote = q.question ? q.question.split('\n').map(l => `> ${l}`).join('\n') + '\n' : '';
    return `## Q${q.no} ${q.title}\n${quote}\n${(answers[q.no] || '').trim()}\n`;
  });
  return head + '\n' + body.join('\n');
}

function Reader({ file, onClose }) {
  const [text, setText] = useState(null);
  useEffect(() => {
    let alive = true;
    setText(null);
    api.read(file).then(f => { if (alive) setText(f.text); }).catch(e => { if (alive) setText(`読み込めませんでした：${e.message}`); });
    return () => { alive = false; };
  }, [file]);
  return html`<aside class="pane q-side reader">
    <div class="pane-h"><h2 class="ellip" title=${file}>${basename(file)}</h2><span class="grow"></span>
      <button type="button" class="btn sm" onClick=${() => openDoc(file)}>エディタで開く</button>
      <button type="button" class="icon-btn" aria-label="閉じる" onClick=${onClose}><${Icon} name="x" /></button>
    </div>
    <div class="reader-body">${text === null ? html`<p class="note">読み込み中…</p>` : html`<${Markdown} md=${text} />`}</div>
  </aside>`;
}

function Rounds({ scan, roundN, setRoundN, onOpen, reload }) {
  const s = useStore();
  if (!scan.exists) {
    const make = async () => {
      try {
        await api.create(`${scan.dir}/README.md`, `# ${scan.dir}\n\nつみきくずし（Claude Code のスキル）の出力を round1/ などに置くフォルダです。\n`);
        await refreshTree();
        gitSoon();
        reload();
      } catch (e) { fail(e); }
    };
    return html`<${Empty} title=${`まだ「${scan.dir}/」フォルダがありません`}>
      Claude Code でつみきくずしを実行し、出力を <code>${scan.dir}/round1/</code> に置くと、ここに Round ごとの進み具合が出ます。
      <div class="empty-actions"><button type="button" class="btn sm" onClick=${make}>「${scan.dir}/」フォルダを作る</button></div>
    </${Empty}>`;
  }
  if (!scan.rounds.length) {
    return html`<${Empty} title="まだ Round がありません"><code>${scan.dir}/round1/</code> に出力が置かれると、ここに出ます。最初は Claude Code で <code>/tsumiki-phase1</code> を実行します。</${Empty}>`;
  }
  const r = scan.rounds.find(x => x.n === roundN) ?? scan.rounds[scan.rounds.length - 1];
  const next = r.phases.find(p => !p.done);
  const latest = r.n === scan.rounds[scan.rounds.length - 1].n;
  const cmd = next ? `/tsumiki-phase${next.n}` : '/tsumiki';
  const copy = async () => { try { await api.clip(cmd); toast(`「${cmd}」をコピーしました`); } catch (e) { fail(e); } };
  const pending = r.deliverables.find(p => p.includes('未決事項'));
  return html`<div class="rounds">
    <div class="tabs" role="tablist" aria-label="Round">
      ${scan.rounds.map(x => html`<button type="button" role="tab" aria-selected=${x.n === r.n} onClick=${() => setRoundN(x.n)}>Round ${x.n}</button>`)}
    </div>
    <div class="phases">
      ${r.phases.map(p => html`<div class=${cls('phase', p.done && 'done', next?.n === p.n && 'cur')}>
        <span class="n"><i>${p.done ? '✓' : p.n}</i><span class="k">${p.label}</span><span class="d">${p.desc}</span></span>
        <small>${p.done ? '完了' : next?.n === p.n ? '次はここ' : 'まだ'}</small>
      </div>`)}
    </div>
    ${latest ? html`<div class="next-box">
      <div>${next
        ? html`次は Phase ${next.n}「${next.label}」です。Claude Code（つみきくずしのフォルダ）で次を実行します。`
        : html`この Round は検証まで終わっています。もう一周するかどうかを Claude Code の指揮者で判断します。`}</div>
      <div class="cmd"><code>${cmd}</code><button type="button" class="btn sm" onClick=${copy}><${Icon} name="copy" sm />コピー</button></div>
      <small class="note">AI の実行は Claude Code で行います。このアプリから外部へは何も送りません。</small>
    </div>` : null}
    ${r.judgement || r.focus ? html`<div class="judge">
      ${r.judgement ? html`<div><span class="label">蒸留判断</span><${Markdown} md=${r.judgement} /></div>` : null}
      ${r.focus ? html`<div><span class="label">次ラウンドの焦点</span><${Markdown} md=${r.focus} /></div>` : null}
    </div>` : null}
    <div class="sec-h"><span class="label">成果物</span><span class="count">${r.deliverables.length}</span><span class="grow"></span>
      ${pending ? html`<button type="button" class="btn sm ghost" onClick=${() => onOpen(pending)}>未決事項を読む</button>` : null}</div>
    ${r.deliverables.length ? html`<ul class="file-list">${r.deliverables.map(p => html`<li><button type="button" onClick=${() => onOpen(p)}><${Icon} name="file" sm /><span>${p.slice(r.path.length + 1)}</span></button></li>`)}</ul>`
      : html`<p class="note">成果物（成果物_*.md）はまだありません。Phase 1 が終わると初稿ができます。</p>`}
    ${r.others.length ? html`<div class="sec-h"><span class="label">分析・回答メモなど</span><span class="count">${r.others.length}</span></div>
      <ul class="file-list">${r.others.map(p => html`<li><button type="button" onClick=${() => onOpen(p)}><${Icon} name="file" sm /><span>${p.slice(r.path.length + 1)}</span></button></li>`)}</ul>` : null}
  </div>`;
}

function Notes({ scan, reloadScan }) {
  const s = useStore();
  const [qs, setQs] = useState(null);
  const [phase, setPhase] = useState(1);
  const lastRound = scan.rounds.length ? scan.rounds[scan.rounds.length - 1].n : 1;
  const [round, setRound] = useState(lastRound);
  const [answers, setAnswers] = useState({});
  const [dirty, setDirty] = useState(false);
  const loadQs = async () => { try { setQs(await api.tsumiki.questions()); } catch (e) { fail(e); } };
  useEffect(() => { loadQs(); }, [s.settings.skillsDir]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rel = await api.tsumiki.answersPath(round, phase);
        const md = (await api.exists(rel)) ? (await api.read(rel)).text : '';
        if (alive) { setAnswers(parseAnswers(md)); setDirty(false); }
      } catch (e) { fail(e); }
    })();
    return () => { alive = false; };
  }, [round, phase, s.work.root]);

  const pick = async () => {
    try {
      const dir = await api.tsumiki.pickSkillsDir();
      if (dir) set({ settings: await api.settingsGet() });
    } catch (e) { fail(e); }
  };
  if (!s.settings.skillsDir) {
    return html`<${Empty} title="つみきくずしのスキルの場所を設定すると、質問の一覧が出ます">
      つみきくずしのフォルダにある <code>.claude/skills</code> を選んでください。SKILL.md から各フェーズの質問を読み取り、回答メモを書けるようにします（AI は使いません）。
      <div class="empty-actions"><button type="button" class="btn sm primary" onClick=${pick}>スキルの場所を選ぶ</button></div>
    </${Empty}>`;
  }
  const list = qs?.phases.find(p => p.n === phase)?.questions ?? [];
  const save = async () => {
    try {
      const rel = await api.tsumiki.answersPath(round, phase);
      const text = serializeAnswers(round, phase, list, answers);
      if (await api.exists(rel)) await api.write(rel, text, {});
      else await api.create(rel, text);
      setDirty(false);
      toast(`${rel} に保存しました`);
      gitSoon();
      refreshTree();
      reloadScan();
    } catch (e) { fail(e); }
  };
  const rounds = [...new Set([...scan.rounds.map(r => r.n), lastRound, lastRound + 1])].sort((a, b) => a - b);
  return html`<div class="notes">
    <div class="notes-bar">
      <label>Round <select value=${round} onChange=${e => setRound(Number(e.target.value))}>${rounds.map(n => html`<option value=${n}>${n}${scan.rounds.some(r => r.n === n) ? '' : '（新しい周回）'}</option>`)}</select></label>
      <div class="tabs" role="tablist" aria-label="フェーズ">
        ${[1, 2, 3, 4].map(n => html`<button type="button" role="tab" aria-selected=${phase === n} onClick=${() => setPhase(n)}>Phase ${n}「${PHASE_NAMES[n]}」</button>`)}
      </div>
      <span class="grow"></span>
      <button type="button" class="btn sm ghost" title=${s.settings.skillsDir} onClick=${pick}>スキルの場所を変える</button>
      <button type="button" class="btn sm primary" disabled=${!dirty} onClick=${save}>保存</button>
    </div>
    ${list.length ? html`<ol class="qlist">${list.map(q => html`<li key=${q.no} class="qcard">
      <div class="qlabel">Q${q.no} ${q.title}${q.step ? html`<small>${q.step}</small>` : null}</div>
      ${q.question ? html`<p class="qtext">${q.question}</p>` : null}
      <textarea rows="3" placeholder="あなたの言葉で。迷っていることをそのまま書いても大丈夫です" value=${answers[q.no] || ''}
        onInput=${e => { setAnswers(a => ({ ...a, [q.no]: e.target.value })); setDirty(true); }}></textarea>
    </li>`)}</ol>` : html`<p class="note pad">このフェーズの質問が見つかりませんでした（${s.settings.skillsDir}\\tsumiki-phase${phase}\\SKILL.md）。</p>`}
  </div>`;
}

export function QuestionsView() {
  const s = useStore();
  const [scan, setScan] = useState(null);
  const [roundN, setRoundN] = useState(null);
  const [file, setFile] = useState(null);
  const [tab, setTab] = useState('rounds');
  const load = async () => {
    try {
      const r = await api.tsumiki.scan();
      setScan(r);
      if (r.rounds.length && (roundN === null || !r.rounds.some(x => x.n === roundN))) setRoundN(r.rounds[r.rounds.length - 1].n);
    } catch (e) { fail(e); }
  };
  useEffect(() => { load(); }, [s.work.root, s.work.meta?.tsumikiDir]);
  const changeDir = async () => {
    const v = await promptDialog({ title: 'つみきくずしの出力フォルダ', label: '作品フォルダの中の場所', value: s.work.meta?.tsumikiDir || 'つみき', hint: '例：つみき、output', ok: '変える' });
    if (v === null || !v.trim()) return;
    await saveWorkMeta({ tsumikiDir: v.trim().replace(/^[\\/]+|[\\/]+$/g, '') });
  };
  return html`<section class=${cls('view v-q', file && 'with-reader')} aria-label="問い">
    <div class="q-main">
      <div class="pane-h">
        <h2>問い（つみきくずし）</h2>
        <span class="sub">出力フォルダ：<code>${scan?.dir ?? '…'}/</code></span>
        <button type="button" class="btn sm ghost" onClick=${changeDir}>場所を変える</button>
        <button type="button" class="icon-btn" title="読み直す" aria-label="読み直す" onClick=${load}><${Icon} name="refresh" /></button>
        <span class="grow"></span>
        <div class="tabs" role="tablist" aria-label="表示">
          <button type="button" role="tab" aria-selected=${tab === 'rounds'} onClick=${() => setTab('rounds')}>進み具合と成果物</button>
          <button type="button" role="tab" aria-selected=${tab === 'notes'} onClick=${() => setTab('notes')}>質問と回答メモ</button>
        </div>
      </div>
      <div class="q-body">
        ${!scan ? html`<p class="note pad">読み込み中…</p>`
          : tab === 'rounds'
            ? html`<${Rounds} scan=${scan} roundN=${roundN} setRoundN=${setRoundN} onOpen=${setFile} reload=${load} />`
            : html`<${Notes} scan=${scan} reloadScan=${load} />`}
      </div>
    </div>
    ${file ? html`<${Reader} file=${file} onClose=${() => setFile(null)} />` : null}
  </section>`;
}
