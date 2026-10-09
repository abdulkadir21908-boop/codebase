/* Static sanity check: every `this.effects.X(` / `X.Y(` call in the game code
 * must resolve to a method that actually exists on the target class.
 * Catches silent damage (renamed methods) without a browser. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'src');
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.js')) files.push(p);
  }
})(root);

let problems = 0;
const short = (p) => relative(join(here, '..'), p).replace(/\\/g, '/');

/* ------------------------------------------------------------------ */
/* 1. every import of a local module must actually resolve             */
/* ------------------------------------------------------------------ */
const exportsOf = new Map();
const reExport = /export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
const reExportList = /export\s*\{([^}]*)\}/g;
const reExportDefault = /export\s+default\b/;

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(reExport)) names.add(m[1]);
  for (const m of src.matchAll(reExportList)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  if (reExportDefault.test(src)) names.add('default');
  exportsOf.set(resolve(f), names);
}

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/import\s+([^'"]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    const spec = m[2];
    if (!spec.startsWith('.')) continue;              // three / bare specifier
    const target = resolve(dirname(f), spec);
    if (!exportsOf.has(target)) {
      console.log(`  !! ${short(f)} imports ${spec}, which does not exist`);
      problems++;
      continue;
    }
    const clause = m[1];
    const names = [];
    const braced = clause.match(/\{([^}]*)\}/);
    if (braced) {
      for (const part of braced[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) names.push(name);
      }
    }
    const bare = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    if (bare && !bare.startsWith('*')) names.push('default');
    for (const n of names) {
      if (!exportsOf.get(target).has(n)) {
        console.log(`  !! ${short(f)} imports { ${n} } from ${spec}, which does not export it`);
        problems++;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 2. syntax check every module as a real ES module                   */
/* ------------------------------------------------------------------ */
{
  // node --check only treats a file as ESM by extension, so parse temporary
  // .mjs copies. This catches syntax damage without executing anything.
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync: wf, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'apexcheck-'));
  const parsed = [];
  for (const f of files) {
    const copy = join(dir, parsed.length + '.mjs');
    wf(copy, readFileSync(f, 'utf8'));
    parsed.push(copy);
  }
  const r = spawnSync(process.execPath,
    ['--check', ...parsed.map((_, i) => join(dir, i + '.mjs'))],
    { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) {
    const out = (r.stderr || '') + (r.stdout || '');
    for (const line of out.split('\n')) {
      if (/SyntaxError|^\s*\^/.test(line) || /Error:/.test(line)) {
        console.log('  !! syntax: ' + line.trim());
        problems++;
      }
    }
    if (!problems) console.log('  !! one or more modules failed to parse');
  }
}

/* ------------------------------------------------------------------ */
/* 3. every this.X.Y() call resolves to a real class method           */
/* ------------------------------------------------------------------ */

/** crude but effective: collect `name(` definitions at class level */
function methodsOf(file, className) {
  const src = readFileSync(file, 'utf8');
  const start = src.indexOf('class ' + className);
  if (start < 0) return null;
  const out = new Set();
  const re = /^\s{2}(?:static\s+|get\s+|async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return out;
}

const effects = methodsOf(join(root, 'fx/particles.js'), 'Effects');
const track = methodsOf(join(root, 'world/track.js'), 'Track');
const vehicle = methodsOf(join(root, 'car/vehicle.js'), 'Vehicle');
const sky = methodsOf(join(root, 'world/sky.js'), 'SkySystem');
const postfx = methodsOf(join(root, 'fx/postfx.js'), 'PostFX');
const hud = methodsOf(join(root, 'ui/hud.js'), 'HUD');

const checks = [
  { obj: 'effects', name: 'this.effects', cls: effects, file: join(root, 'main.js') },
  { obj: 'track', name: 'this.track', cls: track, file: join(root, 'main.js') },
  { obj: 'track', name: 't.', cls: track, file: join(root, 'car/ai.js') },
  { obj: 'vehicle', name: 'this.track', cls: track, file: join(root, 'car/vehicle.js') },
  { obj: 'post', name: 'this.post', cls: postfx, file: join(root, 'main.js') },
  { obj: 'sky', name: 'this.sky', cls: sky, file: join(root, 'main.js') },
  { obj: 'hud', name: 'this.hud', cls: hud, file: join(root, 'main.js') },
];

for (const c of checks) {
  if (!c.cls) { console.log('  !! could not read class for ' + c.obj); problems++; continue; }
  const src = readFileSync(c.file, 'utf8');
  const re = new RegExp(c.name.replace(/[.]/g, '\\.') + '\\.([A-Za-z_$][\\w$]*)\\s*\\(', 'g');
  let m;
  const seen = new Set();
  while ((m = re.exec(src))) {
    const fn = m[1];
    if (seen.has(fn)) continue;
    seen.add(fn);
    if (!c.cls.has(fn)) {
      console.log(`  !! ${short(c.file)} calls ${c.name}.${fn}() which does not exist on ${c.obj}`);
      problems++;
    }
  }
}

/* ------------------------------------------------------------------ */
/* 4. this.<method>() called inside the Game class exists               */
/* ------------------------------------------------------------------ */
{
  const src = readFileSync(join(root, 'main.js'), 'utf8');
  const start = src.indexOf('class Game');
  const body = start >= 0 ? src.slice(start) : src;

  const defined = new Set();
  // methods, getters, setters, static members
  for (const m of body.matchAll(/^\s{2}(?:static\s+|get\s+|set\s+|async\s+)?\*?\s*([A-Za-z_$][\w$]*)\s*\(/gm)) {
    defined.add(m[1]);
  }
  // instance fields and arrow-function properties, at any indent inside the class
  for (const m of body.matchAll(/^\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\(|async|[^=])/gm)) defined.add(m[1]);
  // plain assignments to this.x anywhere in the class body
  for (const m of body.matchAll(/\bthis\.([A-Za-z_$][\w$]*)\s*(?:=|\+\+|--|\+=|-=)/g)) defined.add(m[1]);

  const seenCalls = new Set();
  for (const m of body.matchAll(/\bthis\.([A-Za-z_$][\w$]*)\s*\(/g)) {
    const fn = m[1];
    if (seenCalls.has(fn)) continue;
    seenCalls.add(fn);
    if (!defined.has(fn)) {
      console.log(`  !! main.js calls this.${fn}() but Game defines no such member`);
      problems++;
    }
  }
}

/* ------------------------------------------------------------------ */
/* 5. every getElementById() id exists in index.html                   */
/* ------------------------------------------------------------------ */
const html = readFileSync(join(root, '..', 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/getElementById\('([^']+)'\)/g)) {
    if (!ids.has(m[1])) { console.log(`  !! ${short(f)} looks up #${m[1]} which is not in index.html`); problems++; }
  }
}

console.log(problems ? `\n${problems} problem(s) found` : '\nno problems found');
process.exit(problems ? 1 : 0);