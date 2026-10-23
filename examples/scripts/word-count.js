// Demo script: count lines, words and characters of a text file.
// Usage: node word-count.js <file> [--top=N]

import { readFileSync } from 'node:fs';

const [file, flag = ''] = process.argv.slice(2);
const n = Number(flag.replace('--top=', ''));
const text = readFileSync(file, 'utf8');
const words = text.split(/\s+/u).filter(Boolean);
console.log(`lines: ${text.split('\n').length}, words: ${words.length}, characters: ${text.length}`);

if (flag.startsWith('--top=')) {
  const counts = new Map();
  for (const w of words) counts.set(w.toLowerCase(), (counts.get(w.toLowerCase()) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, n);
  console.log(top.map(([w, c]) => `${w}: ${c}`).join('\n'));
}
