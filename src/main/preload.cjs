// 画面に公開する API はこれだけ（Node や Electron の機能は直接渡さない）
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set([
  'settings.get', 'settings.set',
  'works.recent', 'works.forget', 'works.pickFolder',
  'work.open', 'work.current', 'work.init', 'work.close',
  'files.tree', 'files.read', 'files.write', 'files.create', 'files.rename', 'files.trash', 'files.exists', 'files.reveal',
  'data.read', 'data.write',
  'frag.list', 'frag.add', 'frag.update', 'frag.remove',
  'img.save', 'img.remove', 'img.setInGit',
  'git.info', 'git.status', 'git.diff', 'git.log', 'git.commit', 'git.init', 'git.branches',
  'git.createBranch', 'git.switchBranch', 'git.setRemote', 'git.pushPreview', 'git.fetch', 'git.pull', 'git.push',
  'tsumiki.scan', 'tsumiki.questions', 'tsumiki.pickSkillsDir', 'tsumiki.answersPath',
  'clip.write', 'smoke.blocked',
]);

contextBridge.exposeInMainWorld('tsumiki', {
  call(channel, ...args) {
    if (!CHANNELS.has(channel)) return Promise.reject(new Error(`unknown channel: ${channel}`));
    return ipcRenderer.invoke(channel, ...args).then(r => {
      if (r && r.ok) return r.value;
      throw new Error(r?.error || '不明なエラーです');
    });
  },
});
