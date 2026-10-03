// メインプロセスへの呼び出し（preload が公開した window.tsumiki.call だけを使う）
const call = (channel, ...args) => window.tsumiki.call(channel, ...args);

export const api = {
  settingsGet: () => call('settings.get'),
  settingsSet: patch => call('settings.set', patch),
  worksRecent: () => call('works.recent'),
  worksForget: p => call('works.forget', p),
  pickFolder: purpose => call('works.pickFolder', purpose),
  workOpen: root => call('work.open', root),
  workCurrent: () => call('work.current'),
  workInit: title => call('work.init', title),
  workClose: () => call('work.close'),

  tree: () => call('files.tree'),
  read: rel => call('files.read', rel),
  write: (rel, text, opts) => call('files.write', rel, text, opts),
  create: (rel, text) => call('files.create', rel, text),
  rename: (from, to) => call('files.rename', from, to),
  trash: rel => call('files.trash', rel),
  exists: rel => call('files.exists', rel),
  reveal: rel => call('files.reveal', rel),

  dataRead: name => call('data.read', name),
  dataWrite: (name, obj) => call('data.write', name, obj),

  fragList: () => call('frag.list'),
  fragAdd: f => call('frag.add', f),
  fragUpdate: (file, id, patch) => call('frag.update', file, id, patch),
  fragRemove: (file, id) => call('frag.remove', file, id),

  imgSave: (kind, id, bytes, ext) => call('img.save', kind, id, bytes, ext),
  imgRemove: rel => call('img.remove', rel),
  imgSetInGit: v => call('img.setInGit', v),

  git: {
    info: () => call('git.info'),
    status: () => call('git.status'),
    diff: rel => call('git.diff', rel),
    log: () => call('git.log'),
    commit: (paths, message) => call('git.commit', paths, message),
    init: () => call('git.init'),
    branches: () => call('git.branches'),
    createBranch: name => call('git.createBranch', name),
    switchBranch: name => call('git.switchBranch', name),
    setRemote: url => call('git.setRemote', url),
    pushPreview: () => call('git.pushPreview'),
    fetch: () => call('git.fetch'),
    pull: () => call('git.pull'),
    push: () => call('git.push'),
  },

  tsumiki: {
    scan: () => call('tsumiki.scan'),
    questions: () => call('tsumiki.questions'),
    pickSkillsDir: () => call('tsumiki.pickSkillsDir'),
    answersPath: (round, phase) => call('tsumiki.answersPath', round, phase),
  },

  clip: text => call('clip.write', text),
  smokeBlocked: () => call('smoke.blocked'),
};
