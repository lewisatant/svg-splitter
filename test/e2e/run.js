'use strict';

// End-to-end driver: builds the bundle, runs each fixture through After
// Effects 2026 (AppleScript DoScriptFile), renders ground truth in headless
// Chrome, and pixel-compares the two.
//
// Usage: node test/e2e/run.js [fixture-name ...] [--keep-ae]
// One-time setup: enable Preferences > Scripting & Expressions >
// "Allow Scripts to Write Files and Access Network" in AE, and approve the
// macOS Automation prompt on first run.

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default || require('pixelmatch');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');
const AE_APP = 'Adobe After Effects 2026';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Per-fixture comparison policy.
// pixelBudgetPct: max % of pixels allowed to differ (antialiasing wiggle).
// skipPixel: structural check only (documented intentional divergence).
const POLICY = {
  'default': { pixelBudgetPct: 1.0 },
  'shadow-blur.svg': { pixelBudgetPct: 6.0, note: 'blur/softness calibration tolerance' },
  'gradients.svg': { pixelBudgetPct: 3.0, note: 'gradient interpolation differences' },
  'mask-alpha.svg': { skipPixel: true, note: 'masks intentionally imported unmasked' },
  'text-real.svg': { skipPixel: true, note: 'font rasterization not comparable' },
  'opacity-blend.svg': { pixelBudgetPct: 8.0, note: 'group-opacity flattening overlap differences' },
};

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' });
}

function build() {
  execFileSync('node', [path.join(ROOT, 'build.js')], { stdio: 'inherit' });
}

function listFixtures(filter) {
  const all = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.svg')).sort();
  if (filter.length === 0) return all;
  return all.filter((f) => filter.some((q) => f.includes(q)));
}

function generateHarness(fixture, splitMode) {
  const template = fs.readFileSync(path.join(__dirname, 'harness-template.jsx'), 'utf8');
  const base = fixture.replace(/\.svg$/, '');
  const subs = {
    __LIB_PATH__: path.join(ROOT, 'dist', 'svg-splitter-lib.jsx'),
    __FIXTURE_PATH__: path.join(FIXTURES, fixture),
    __LOG_PATH__: path.join(OUT, base + '.log'),
    __OUT_PNG__: path.join(OUT, base + '.ae.png'),
    __COMP_NAME__: 'e2e-' + base,
    __SPLIT_MODE__: splitMode,
  };
  let out = template;
  for (const [key, value] of Object.entries(subs)) {
    out = out.split(key).join(value);
  }
  const harnessPath = path.join(OUT, base + '.harness.jsx');
  fs.writeFileSync(harnessPath, out);
  return { harnessPath, logPath: subs.__LOG_PATH__, aePng: subs.__OUT_PNG__ };
}

function runInAE(harnessPath) {
  const script = `tell application "${AE_APP}" to DoScriptFile (POSIX file "${harnessPath}" as alias)`;
  execFileSync('osascript', ['-e', script], { stdio: 'pipe', timeout: 180000 });
}

function ensureAERunning() {
  const running = sh('pgrep -f "After Effects 2026" || true').trim().length > 0;
  if (!running) {
    console.log('launching After Effects…');
    sh(`open -a "${AE_APP}"`);
  }
  // wait for the app to accept AppleEvents
  const deadline = Date.now() + 120000;
  for (;;) {
    try {
      execFileSync('osascript', ['-e', `tell application "${AE_APP}" to activate`], {
        stdio: 'pipe', timeout: 15000,
      });
      return;
    } catch (e) {
      if (Date.now() > deadline) throw new Error('After Effects did not become scriptable: ' + e.message);
      execSync('sleep 3');
    }
  }
}

function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file) && fs.statSync(file).size > 0) {
      // give the writer a moment to finish
      execSync('sleep 1');
      return true;
    }
    execSync('sleep 0.5');
  }
  return false;
}

function chromeGroundTruth(fixture) {
  const base = fixture.replace(/\.svg$/, '');
  const svgText = fs.readFileSync(path.join(FIXTURES, fixture), 'utf8');
  const wMatch = /width="([\d.]+)"/.exec(svgText);
  const hMatch = /height="([\d.]+)"/.exec(svgText);
  const w = Math.ceil(parseFloat(wMatch[1]));
  const h = Math.ceil(parseFloat(hMatch[1]));
  const html = `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:#fff}svg{display:block}</style></head><body>${svgText}</body></html>`;
  const htmlPath = path.join(OUT, base + '.html');
  fs.writeFileSync(htmlPath, html);
  const png = path.join(OUT, base + '.chrome.png');
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--force-device-scale-factor=1',
    '--default-background-color=FFFFFFFF',
    `--screenshot=${png}`, `--window-size=${w},${h}`,
    `file://${htmlPath}`,
  ], { stdio: 'pipe', timeout: 60000 });
  return { png, w, h };
}

function compare(aePngPath, chromePngPath, base) {
  const a = PNG.sync.read(fs.readFileSync(aePngPath));
  const b = PNG.sync.read(fs.readFileSync(chromePngPath));
  if (a.width !== b.width || a.height !== b.height) {
    return { error: `size mismatch: AE ${a.width}x${a.height} vs Chrome ${b.width}x${b.height}` };
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const differing = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    threshold: 0.12,
    includeAA: false,
  });
  const diffPath = path.join(OUT, base + '.diff.png');
  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  return { differing, total: a.width * a.height, pct: (differing / (a.width * a.height)) * 100, diffPath };
}

async function main() {
  const args = process.argv.slice(2);
  const keepAE = args.includes('--keep-ae');
  const filter = args.filter((a) => !a.startsWith('--'));

  fs.mkdirSync(OUT, { recursive: true });
  build();
  const fixtures = listFixtures(filter);
  if (fixtures.length === 0) {
    console.error('no fixtures matched');
    process.exit(1);
  }

  ensureAERunning();

  const results = [];
  for (const fixture of fixtures) {
    const base = fixture.replace(/\.svg$/, '');
    const policy = POLICY[fixture] || POLICY.default;
    process.stdout.write(`\n=== ${fixture} ===\n`);

    // stale outputs
    for (const suffix of ['.log', '.ae.png', '.diff.png']) {
      const p = path.join(OUT, base + suffix);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    const { harnessPath, logPath, aePng } = generateHarness(fixture, 'toplevel');
    let record = { fixture, status: 'unknown' };
    try {
      runInAE(harnessPath);
      if (!waitForFile(logPath, 90000)) throw new Error('harness log never appeared (AE hung?)');
      const log = fs.readFileSync(logPath, 'utf8').replace(/\r\n?/g, '\n');
      const warnings = log.split('\n').filter((l) => l.startsWith('WARN '));
      const errorLine = log.split('\n').find((l) => l.startsWith('ERROR '));
      console.log(log.trim().split('\n').map((l) => '  AE: ' + l).join('\n'));
      if (errorLine) throw new Error(errorLine);
      record.warnings = warnings.length;

      if (!waitForFile(aePng, 60000)) throw new Error('AE PNG never appeared (saveFrameToPng)');

      const truth = chromeGroundTruth(fixture);
      if (policy.skipPixel) {
        record.status = 'structural-ok';
        console.log(`  pixel compare skipped: ${policy.note}`);
      } else {
        const cmp = compare(aePng, truth.png, base);
        if (cmp.error) throw new Error(cmp.error);
        record.pct = cmp.pct;
        const pass = cmp.pct <= policy.pixelBudgetPct;
        record.status = pass ? 'pass' : 'FAIL';
        console.log(`  diff: ${cmp.differing}/${cmp.total} px (${cmp.pct.toFixed(2)}%) budget ${policy.pixelBudgetPct}% -> ${record.status}`);
        if (!pass) console.log(`  artifacts: ${aePng} ${truth.png} ${cmp.diffPath}`);
      }
    } catch (e) {
      record.status = 'ERROR';
      record.error = e.message.slice(0, 400);
      console.log('  ' + record.error);
    }
    results.push(record);
  }

  if (!keepAE) {
    console.log('\n(leaving AE running; pass --keep-ae is default behavior — quit manually or via quit-ae)');
  }

  console.log('\n=== summary ===');
  for (const r of results) {
    console.log(`  ${r.status.padEnd(14)} ${r.fixture}${r.pct !== undefined ? ' ' + r.pct.toFixed(2) + '%' : ''}${r.error ? ' — ' + r.error : ''}`);
  }
  const bad = results.filter((r) => r.status === 'FAIL' || r.status === 'ERROR');
  process.exit(bad.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
