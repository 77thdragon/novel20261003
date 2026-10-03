// 画面スモークテスト用のつまみ（?smoke=1 で起動したときだけ有効）
import { S, set, go, openWorkAt, openDoc, flushDoc, saveData, refreshGit, refreshFragments, toggleTheme, closeWork } from './store.js';
import { api } from './api.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, label, timeout = 8000) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`待ちきれませんでした：${label}`);
    await sleep(50);
  }
}

function el(selector, text) {
  const list = [...document.querySelectorAll(selector)];
  const found = text ? list.find(e => e.textContent.includes(text)) : list[0];
  if (!found) throw new Error(`見つかりません：${selector}${text ? ` 「${text}」` : ''}`);
  return found;
}

export function installTestHooks() {
  window.__tsumikiTest = {
    ready: waitFor(() => S.ready, '起動', 15000),
    S,
    api,
    sleep,
    waitFor,
    set,
    go,
    openDoc,
    flushDoc,
    saveData,
    refreshGit,
    refreshFragments,
    toggleTheme,
    closeWork,
    el,
    click(selector, text) { el(selector, text).click(); },
    // 入力してから、画面が描き直されるのを待つ（人が押すより速くボタンを押さないように）
    async fill(selector, value) {
      const e = el(selector);
      e.value = value;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(150);
    },
    async modalOk() {
      await waitFor(() => document.querySelector('.modal'), 'ダイアログ');
      el('.modal .modal-actions .btn.primary, .modal .modal-actions .btn.danger').click();
      await waitFor(() => !document.querySelector('.modal'), 'ダイアログを閉じる');
    },
    async openWorkAccept(root) {
      const p = openWorkAt(root);
      await waitFor(() => document.querySelector('.modal') || S.work?.initialized, '作品を開く');
      if (document.querySelector('.modal')) await this.modalOk();
      await p;
      await waitFor(() => S.work?.initialized && S.plot, '作品の読み込み');
    },
    // 画像ファイルを枠にドロップしたのと同じことをする
    async dropTestImage(selector) {
      const c = document.createElement('canvas');
      c.width = 600;
      c.height = 800;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 0, 800);
      grad.addColorStop(0, '#c98aa8');
      grad.addColorStop(1, '#5b2a44');
      g.fillStyle = grad;
      g.fillRect(0, 0, 600, 800);
      g.fillStyle = '#fff';
      g.font = 'bold 80px sans-serif';
      g.fillText('TEST', 180, 200);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'test.png', { type: 'image/png' }));
      el(selector).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
  };
}
