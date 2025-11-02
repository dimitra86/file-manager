#!/usr/bin/env node

const fs = require('fs');
const fsPromises = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const readline = require('readline');

// --- Parse CLI for --username ---
const argv = process.argv.slice(2);
let providedUsername = null;
for (const a of argv) {
  if (a.startsWith('--username=')) {
    providedUsername = a.split('=')[1];
    break;
  }
}
if (!providedUsername) {
  console.error('Missing --username argument. Use: npm run start -- --username=your_username');
  process.exit(1);
}

// --- Utility helpers ---
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '' });
let cwd = os.homedir(); // starting working directory
const rootPath = path.parse(cwd).root;
const usernameForMessages = providedUsername;

function printCwd() {
  console.log(`You are currently in ${cwd}`);
}

function invalidInput() {
  console.log('Invalid input');
}

function operationFailed() {
  console.log('Operation failed');
}

// safe join: resolves but prevents going above root of current drive
function safeResolve(target) {
  const resolved = path.isAbsolute(target) ? path.normalize(target) : path.normalize(path.join(cwd, target));
  // Prevent going above root (root of the drive where cwd is)
  const rootOfCwd = path.parse(cwd).root;
  if (!resolved.startsWith(rootOfCwd)) return rootOfCwd;
  return resolved;
}

async function listDir() {
  try {
    const items = await fsPromises.readdir(cwd, { withFileTypes: true });
    const dirs = items.filter(i => i.isDirectory()).map(d => d.name).sort((a,b)=>a.localeCompare(b));
    const files = items.filter(i => i.isFile()).map(f => f.name).sort((a,b)=>a.localeCompare(b));
    // Print folders first then files with type label
    for (const d of dirs) console.log(`${d} <DIR>`);
    for (const f of files) console.log(`${f} <FILE>`);
  } catch (e) {
    operationFailed();
  }
}

async function goUp() {
  const parent = path.dirname(cwd);
  const rootOfCwd = path.parse(cwd).root;
  if (cwd === rootOfCwd) {
    // do not change
    return;
  }
  cwd = parent;
}

async function changeDir(arg) {
  if (!arg) { invalidInput(); return; }
  const dest = safeResolve(arg);
  try {
    const st = await fsPromises.stat(dest);
    if (!st.isDirectory()) { invalidInput(); return; }
    // Ensure not above root
    const rootOfCwd = path.parse(cwd).root;
    if (!dest.startsWith(rootOfCwd)) { /* don't allow */ return; }
    cwd = dest;
  } catch (e) {
    operationFailed();
  }
}

async function catFile(arg) {
  if (!arg) { invalidInput(); return; }
  const target = safeResolve(arg);
  try {
    const st = await fsPromises.stat(target);
    if (!st.isFile()) { invalidInput(); return; }
    const rs = fs.createReadStream(target, { encoding: 'utf8' });
    rs.on('error', () => { operationFailed(); rs.destroy(); });
    rs.pipe(process.stdout, { end: false });
    await new Promise(resolve => rs.on('end', resolve));
    console.log(''); // newline after content
  } catch (e) {
    operationFailed();
  }
}

async function addFile(arg) {
  if (!arg) { invalidInput(); return; }
  const target = path.join(cwd, arg);
  try {
    await fsPromises.open(target, 'wx').then(h=>h.close()).catch(err=>{
      if (err.code === 'EEXIST') throw err;
      throw err;
    });
  } catch (e) {
    operationFailed();
  }
}

async function makeDir(arg) {
  if (!arg) { invalidInput(); return; }
  const target = path.join(cwd, arg);
  try {
    await fsPromises.mkdir(target, { recursive: false });
  } catch (e) {
    operationFailed();
  }
}

async function renameFile(oldP, newName) {
  if (!oldP || !newName) { invalidInput(); return; }
  const src = safeResolve(oldP);
  const dest = path.join(path.dirname(src), newName);
  try {
    await fsPromises.rename(src, dest);
  } catch (e) {
    operationFailed();
  }
}

async function copyFile(srcArg, destDirArg) {
  if (!srcArg || !destDirArg) { invalidInput(); return; }
  const src = safeResolve(srcArg);
  const destDir = safeResolve(destDirArg);
  try {
    const st = await fsPromises.stat(src);
    if (!st.isFile()) { invalidInput(); return; }
    const dstStat = await fsPromises.stat(destDir).catch(()=>null);
    if (!dstStat || !dstStat.isDirectory()) { invalidInput(); return; }
    const destPath = path.join(destDir, path.basename(src));
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(src);
      const ws = fs.createWriteStream(destPath);
      rs.on('error', err => { ws.destroy(); reject(err); });
      ws.on('error', reject);
      ws.on('finish', resolve);
      rs.pipe(ws);
    });
  } catch (e) {
    operationFailed();
  }
}

async function moveFile(srcArg, destDirArg) {
  if (!srcArg || !destDirArg) { invalidInput(); return; }
  const src = safeResolve(srcArg);
  const destDir = safeResolve(destDirArg);
  try {
    const st = await fsPromises.stat(src);
    if (!st.isFile()) { invalidInput(); return; }
    const dstStat = await fsPromises.stat(destDir).catch(()=>null);
    if (!dstStat || !dstStat.isDirectory()) { invalidInput(); return; }
    const destPath = path.join(destDir, path.basename(src));
    // try rename first
    try {
      await fsPromises.rename(src, destPath);
      return;
    } catch (_) {
      // fallback to copy+delete using streams
    }
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(src);
      const ws = fs.createWriteStream(destPath);
      rs.on('error', err => { ws.destroy(); reject(err); });
      ws.on('error', reject);
      ws.on('finish', resolve);
      rs.pipe(ws);
    });
    await fsPromises.unlink(src);
  } catch (e) {
    operationFailed();
  }
}

async function removeFile(arg) {
  if (!arg) { invalidInput(); return; }
  const target = safeResolve(arg);
  try {
    const st = await fsPromises.stat(target);
    if (!st.isFile()) { invalidInput(); return; }
    await fsPromises.unlink(target);
  } catch (e) {
    operationFailed();
  }
}

function osInfo(option) {
  try {
    switch(option) {
      case '--EOL':
        // Show visible representation of EOL
        const eol = os.EOL === '\n' ? '\\n' : '\\r\\n';
        console.log(eol);
        break;
      case '--cpus':
        const cpus = os.cpus();
        console.log(`Total CPUs: ${cpus.length}`);
        cpus.forEach((c, i) => {
          // convert speed from MHz to GHz with 2 decimals
          const ghz = (c.speed / 1000).toFixed(2);
          console.log(`CPU ${i + 1}: ${c.model.trim()} - ${ghz}GHz`);
        });
        break;
      case '--homedir':
        console.log(os.homedir());
        break;
      case '--username':
        console.log(os.userInfo().username);
        break;
      case '--architecture':
        console.log(process.arch);
        break;
      default:
        invalidInput();
    }
  } catch (e) {
    operationFailed();
  }
}

async function hashFile(arg) {
  if (!arg) { invalidInput(); return; }
  const target = safeResolve(arg);
  try {
    const st = await fsPromises.stat(target);
    if (!st.isFile()) { invalidInput(); return; }
    const hash = crypto.createHash('sha256');
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(target);
      rs.on('data', chunk => hash.update(chunk));
      rs.on('error', reject);
      rs.on('end', resolve);
    });
    console.log(hash.digest('hex'));
  } catch (e) {
    operationFailed();
  }
}

async function compressFile(srcArg, destArg) {
  if (!srcArg || !destArg) { invalidInput(); return; }
  const src = safeResolve(srcArg);
  const destPath = safeResolve(destArg);
  try {
    const st = await fsPromises.stat(src);
    if (!st.isFile()) { invalidInput(); return; }
    const destDir = path.dirname(destPath);
    const destStat = await fsPromises.stat(destDir).catch(()=>null);
    if (!destStat || !destStat.isDirectory()) { invalidInput(); return; }
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(src);
      const brot = zlib.createBrotliCompress();
      const ws = fs.createWriteStream(destPath);
      rs.on('error', err => { brot.destroy(); ws.destroy(); reject(err); });
      ws.on('error', reject);
      ws.on('finish', resolve);
      rs.pipe(brot).pipe(ws);
    });
  } catch (e) {
    operationFailed();
  }
}

async function decompressFile(srcArg, destArg) {
  if (!srcArg || !destArg) { invalidInput(); return; }
  const src = safeResolve(srcArg);
  const destPath = safeResolve(destArg);
  try {
    const st = await fsPromises.stat(src);
    if (!st.isFile()) { invalidInput(); return; }
    const destDir = path.dirname(destPath);
    const destStat = await fsPromises.stat(destDir).catch(()=>null);
    if (!destStat || !destStat.isDirectory()) { invalidInput(); return; }
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(src);
      const brot = zlib.createBrotliDecompress();
      const ws = fs.createWriteStream(destPath);
      rs.on('error', err => { brot.destroy(); ws.destroy(); reject(err); });
      ws.on('error', reject);
      ws.on('finish', resolve);
      rs.pipe(brot).pipe(ws);
    });
  } catch (e) {
    operationFailed();
  }
}



// --- Command dispatcher ---
async function handleLine(line) {
  const trimmed = (line || '').trim();
  if (!trimmed) return;
  if (trimmed === '.exit' || trimmed === 'exit') {
    exitAndCleanup();
    return;
  }
  const parts = trimmed.split(' ').filter(Boolean);
  const cmd = parts[0];
  try {
    switch(cmd) {
      case 'up':
        await goUp();
        break;
      case 'cd':
        await changeDir(parts.slice(1).join(' '));
        break;
      case 'ls':
        await listDir();
        break;
      case 'cat':
        await catFile(parts.slice(1).join(' '));
        break;
      case 'add':
        await addFile(parts.slice(1).join(' '));
        break;
      case 'mkdir':
        await makeDir(parts.slice(1).join(' '));
        break;
      case 'rn':
        await renameFile(parts[1], parts.slice(2).join(' '));
        break;
      case 'cp':
        await copyFile(parts[1], parts.slice(2).join(' '));
        break;
      case 'mv':
        await moveFile(parts[1], parts.slice(2).join(' '));
        break;
      case 'rm':
        await removeFile(parts.slice(1).join(' '));
        break;
      case 'os':
        osInfo(parts[1]);
        break;
      case 'hash':
        await hashFile(parts.slice(1).join(' '));
        break;
      case 'compress':
        await compressFile(parts[1], parts.slice(2).join(' '));
        break;
      case 'decompress':
        await decompressFile(parts[1], parts.slice(2).join(' '));
        break;
      default:
        invalidInput();
    }
  } catch (e) {
    operationFailed();
  } finally {
    printCwd();
  }
}


// --- Exit handling ---
function exitAndCleanup() {
  console.log(`Thank you for using File Manager, ${usernameForMessages}, goodbye!`);
  rl.close();
  process.exit(0);
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('');
  exitAndCleanup();
});

// Start prompt
console.log(`Welcome to the File Manager, ${usernameForMessages}!`);
printCwd();
rl.setPrompt('> ');
rl.prompt();
rl.on('line', async (line) => {
  await handleLine(line);
  rl.prompt();
});
