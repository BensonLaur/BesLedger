import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const files = [
  ...new Set([
    ...execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' })
      .trim()
      .split('\n'),
    ...execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' })
      .trim()
      .split('\n'),
    ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' })
      .trim()
      .split('\n'),
  ]),
].filter(Boolean);
const types =
  /\.(ts|js|mjs|json|jsonc|vue|css|html|svg|md|yml|yaml|xml|java|gradle|properties|txt|bat|ps1|sh|pro)$|(^|\/)(\.gitignore|\.gitattributes|\.env.example|gradlew)$/;
for (const file of files) {
  if (!types.test(file) || !fs.existsSync(file)) continue;
  const raw = fs.readFileSync(file, 'utf8');
  if (raw.includes('\0')) continue;
  const eol = file.endsWith('.sh') || file.endsWith('/gradlew') ? '\n' : '\r\n';
  const normalized = raw
    .replace(/\r?\n/g, '\n')
    .replace(/[^\S\n]+$/gm, '')
    .replace(/\n*$/, '\n')
    .replace(/\n/g, eol);
  if (process.argv.includes('--check')) {
    if (raw !== normalized) {
      console.error(`格式不符：${file}`);
      process.exitCode = 1;
    }
  } else fs.writeFileSync(file, normalized, 'utf8');
}
