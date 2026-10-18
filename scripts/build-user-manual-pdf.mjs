// Builds docs/user-manual/UNITECH-EHR-user-manual.pdf from docs/user-manual/README.md:
// the Markdown is rendered to a right-to-left Arabic HTML page with the
// screenshots, then printed to PDF by a headless Chrome or Edge.
//
//   node scripts/build-user-manual-pdf.mjs [path-to-chrome-or-edge]
//
// Handles the Markdown the manual uses: headings, paragraphs, bold, inline
// code, nested lists, tables, block quotes, code blocks, images and rules.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manualDir = join(root, 'docs', 'user-manual');
const source = readFileSync(join(manualDir, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
const output = join(manualDir, 'UNITECH-EHR-user-manual.pdf');

// ---- Markdown → HTML --------------------------------------------------------------
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = escape(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code dir="ltr">${escape(codes[Number(i)])}</code>`);
}
const indentOf = (line) => line.match(/^ */)[0].length;
const LIST = /^( *)(\d+\.|-) (.*)$/;

function blocks(lines) {
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.trim().startsWith('```')) {
      const body = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith('```'); i++) body.push(lines[i].trim());
      i++;
      html.push(`<pre dir="ltr"><code>${escape(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^---+$/.test(line.trim())) { html.push('<hr>'); i++; continue; }
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (line.startsWith('>')) {
      const quote = [];
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^> ?/, ''));
      html.push(`<blockquote>${blocks(quote)}</blockquote>`);
      continue;
    }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const [head, , ...body] = rows;
      // A header row of empty cells (| | |) is a key/value table: no header.
      const header = cells(head).some(Boolean)
        ? '<thead><tr>' + cells(head).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead>'
        : '';
      html.push(
        '<table>' + header + '<tbody>' +
        body.map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>',
      );
      continue;
    }
    const image = /^\s*!\[(.*)\]\((.*)\)\s*$/.exec(line);
    if (image) {
      html.push(`<figure><img src="${pathToFileURL(join(manualDir, image[2])).href}" alt=""><figcaption>${inline(image[1])}</figcaption></figure>`);
      i++;
      continue;
    }
    const item = LIST.exec(line);
    if (item) {
      const base = item[1].length;
      const ordered = /\d/.test(item[2]);
      const items = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]);
        if (!m || m[1].length !== base) break;
        const content = [m[3]];
        // Continuation: blank lines and lines indented deeper than the marker.
        for (i++; i < lines.length; i++) {
          const next = lines[i];
          if (next.trim() && indentOf(next) <= base) break;
          if (!next.trim() && !(lines[i + 1] && indentOf(lines[i + 1]) > base && lines[i + 1].trim())) break;
          content.push(next.slice(Math.min(indentOf(next), base + m[2].length + 1)));
        }
        const [first, ...rest] = content;
        items.push(`<li>${inline(first)}${rest.some((r) => r.trim()) ? blocks(rest) : ''}</li>`);
        while (i < lines.length && !lines[i].trim()) {
          const after = lines.slice(i).find((l) => l.trim());
          const m2 = after && LIST.exec(after);
          if (m2 && m2[1].length === base) i++;
          else break;
        }
      }
      html.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3} |>|\||```|---+$)/.test(lines[i]) && !LIST.exec(lines[i]) && !/^\s*!\[/.test(lines[i])) {
      paragraph.push(lines[i++].trim());
    }
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return html.join('\n');
}

const body = blocks(source.split('\n'));
const generated = new Date().toISOString().slice(0, 10);
const page = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>دليل المستخدم: UNITECH-EHR</title>
<style>
  @page { size: A4; margin: 18mm 16mm 20mm; @bottom-center { content: counter(page) " / " counter(pages); font: 9pt "Segoe UI", Tahoma, sans-serif; color: #6b7a90; } }
  html { font-family: "Segoe UI", Tahoma, "Arial", sans-serif; font-size: 10.5pt; color: #10233f; line-height: 1.65; }
  body { margin: 0; }
  .cover { height: 245mm; display: flex; flex-direction: column; justify-content: center; text-align: center; break-after: page; }
  .cover .brand { font-size: 30pt; font-weight: 700; color: #075fa9; letter-spacing: .5px; }
  .cover h1 { font-size: 22pt; margin: 18px 0 6px; border: 0; }
  .cover p { color: #4b5d76; margin: 4px 0; }
  .cover .note { margin-top: 40px; font-size: 9.5pt; color: #8a5a00; background: #fff7e6; padding: 10px 14px; border-radius: 8px; display: inline-block; }
  h1 { font-size: 18pt; color: #062653; border-bottom: 2px solid #075fa9; padding-bottom: 4px; }
  h2 { font-size: 14pt; color: #075fa9; margin-top: 22px; break-after: avoid; }
  h3 { font-size: 11.5pt; color: #0b3d75; margin-top: 14px; break-after: avoid; }
  hr { border: 0; break-after: page; }
  p, li { margin: 5px 0; }
  ul, ol { padding-inline-start: 22px; margin: 6px 0; }
  code { font-family: Consolas, "Courier New", monospace; font-size: 9pt; background: #eef3f9; padding: 1px 4px; border-radius: 4px; unicode-bidi: isolate; }
  pre { background: #0f1f36; color: #e6edf6; padding: 10px 12px; border-radius: 8px; font-size: 8.5pt; white-space: pre-wrap; text-align: left; }
  pre code { background: none; color: inherit; padding: 0; }
  blockquote { margin: 10px 0; padding: 8px 12px; background: #f1f6ff; border-inline-start: 4px solid #075fa9; border-radius: 6px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 9.5pt; break-inside: avoid; }
  th, td { border: 1px solid #d5e0ec; padding: 5px 7px; text-align: start; vertical-align: top; }
  th { background: #eaf2fb; }
  figure { margin: 10px auto 14px; text-align: center; break-inside: avoid; }
  figure img { max-width: 100%; max-height: 120mm; border: 1px solid #d5e0ec; border-radius: 6px; }
  figcaption { font-size: 9pt; color: #6b7a90; margin-top: 3px; }
</style>
</head>
<body>
<section class="cover">
  <div class="brand">UNITECH-EHR</div>
  <h1>دليل المستخدم</h1>
  <p>رحلة مريض كاملة خطوة بخطوة، مع الشاشات والحسابات المنفّذة</p>
  <p>المريض التدريبي: محمد سميح · زيارة عيادة الباطنية</p>
  <p>${generated}</p>
  <div class="note">مسودة أولى · بيانات وهمية من بيئة التدريب</div>
</section>
${body}
</body>
</html>`;

// ---- HTML → PDF -------------------------------------------------------------------
const candidates = [
  process.argv[2],
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const browser = candidates.find((p) => existsSync(p));
if (!browser) throw new Error('Chrome or Edge not found; pass its path as the first argument');
const work = mkdtempSync(join(tmpdir(), 'ehr-manual-'));
const htmlFile = join(work, 'manual.html');
writeFileSync(htmlFile, page);
// MANUAL_HTML=<path> also keeps the intermediate HTML, e.g. to preview it.
if (process.env.MANUAL_HTML) writeFileSync(process.env.MANUAL_HTML, page);
try {
  // A separate, throw-away profile: never touches the user's own browser session.
  execFileSync(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${join(work, 'profile')}`, '--allow-file-access-from-files',
    '--no-pdf-header-footer', `--print-to-pdf=${output}`, pathToFileURL(htmlFile).href,
  ], { stdio: 'ignore', timeout: 120_000 });
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (!existsSync(output)) throw new Error('PDF was not produced');
console.log(`Wrote ${output}`);
