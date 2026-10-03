// デスクトップアプリ（exe）を作り、デスクトップにショートカット「つみき工房」を置く
//   npm run package
// この PC の中だけで完結する（Electron 本体はキャッシュ済みのものを使う）
import { packager } from '@electron/packager';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));

const [appDir] = await packager({
  dir: project,
  out: path.join(project, 'dist'),
  overwrite: true,
  platform: 'win32',
  arch: 'x64',
  name: 'TsumikiKobo',
  executableName: 'TsumikiKobo',
  appVersion: pkg.version,
  asar: false,
  prune: true,
  ignore: [/^\/(test|smoke-output|docs|dist|scripts)(\/|$)/, /^\/\.gitignore$/],
  win32metadata: { ProductName: 'つみき工房', FileDescription: 'つみき工房（小説執筆・ローカル専用）' },
});
const exe = path.join(appDir, 'TsumikiKobo.exe');
await fs.access(exe);
console.log(`アプリを作りました：${exe}`);

// デスクトップのショートカット（日本語のパスを確実に渡すため、PowerShell には UTF-16 で渡す）
const ps = [
  "$d = [Environment]::GetFolderPath('Desktop')",
  "$p = Join-Path $d 'つみき工房.lnk'",
  '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($p)',
  `$s.TargetPath = '${exe.replace(/'/g, "''")}'`,
  `$s.WorkingDirectory = '${appDir.replace(/'/g, "''")}'`,
  "$s.Description = 'つみき工房（小説執筆・ローカル専用）'",
  '$s.Save()',
  'Write-Output $p',
].join('; ');
const encoded = Buffer.from(ps, 'utf16le').toString('base64');
const out = await new Promise((resolve, reject) => {
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true });
  const chunks = [];
  p.stdout.on('data', d => chunks.push(d));
  p.stderr.on('data', d => process.stderr.write(d));
  p.on('exit', code => (code === 0 ? resolve(Buffer.concat(chunks).toString('utf8').trim()) : reject(new Error(`ショートカットを作れませんでした（${code}）`))));
});
console.log(`デスクトップにショートカットを置きました：${out}`);
