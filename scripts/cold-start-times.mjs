// Reads the commands.json of a Maestro run of .maestro/release/cold-start.yaml (in artifacts/maestro/<run>/<date>/<flow>/)
// and prints, per cold start, the milliseconds from the start of "launchApp" to the end of "assert calculators-screen is
// visible" (Maestro polls about every 0.2-1 s, so each value includes up to that much), then the median.
// Usage: node scripts/cold-start-times.mjs <path to commands.json>
import { readFileSync } from 'node:fs';
const cmds = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const kind = (c) => Object.keys(c.command)[0];
const times = [];
let start = null;
for (const c of cmds) {
  const k = kind(c);
  if (k === 'launchAppCommand') start = c.metadata.timestamp;
  if (start !== null && (k === 'assertConditionCommand' || k === 'extendedWaitUntil') && JSON.stringify(c.command).includes('calculators-screen')) {
    times.push(c.metadata.timestamp + (c.metadata.duration ?? 0) - start);
    start = null;
  }
}
times.forEach((t, i) => console.log(`start ${i + 1}: ${t} ms`));
const s = [...times].sort((a, b) => a - b);
console.log(`n=${s.length} median ${s[Math.floor(s.length / 2)]} ms, min ${s[0]} ms, max ${s[s.length - 1]} ms`);
