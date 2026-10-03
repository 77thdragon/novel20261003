// アプリを起動する（ELECTRON_RUN_AS_NODE が残っていても普通に起動できるようにする）
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronPath, [project], { env, stdio: 'inherit', windowsHide: false });
child.on('exit', code => process.exit(code ?? 0));
