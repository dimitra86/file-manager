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
