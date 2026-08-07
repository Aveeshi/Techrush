/**
 * fix-case-sensitivity-v2.js
 *
 * The previous version compared requires against your DISK filenames.
 * That's unreliable on Windows, because Windows can silently show you
 * a filename that doesn't match what git actually has tracked (exactly
 * what happened with eventController.js vs Eventcontroller.js).
 *
 * This version uses `git ls-files` as the source of truth -- that's
 * EXACTLY what Render/Linux will see when it clones your repo. Then it
 * rewrites every require()/import path in your project to match git's
 * real tracked casing, in one pass, across the whole project.
 *
 * USAGE:
 *   node fix-case-sensitivity-v2.js         -> dry run, reports mismatches
 *   node fix-case-sensitivity-v2.js --fix   -> rewrites require/import paths
 *
 * Run this from your project root (same folder as package.json / .git).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.cwd();
const APPLY_FIX = process.argv.includes('--fix');
const JS_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

// 1. Get every file git actually tracks -- this is the ground truth.
let trackedFiles;
try {
  trackedFiles = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
} catch (e) {
  console.error('Failed to run `git ls-files`. Are you in a git repo root?');
  process.exit(1);
}

// Build a lookup: lowercase full path -> real tracked path (correct case)
const trackedLookup = new Map();
for (const f of trackedFiles) {
  trackedLookup.set(f.toLowerCase(), f);
}

// 2. Walk only tracked JS/TS files (no point checking untracked/build output)
const filesToScan = trackedFiles.filter((f) => JS_EXTENSIONS.has(path.extname(f)));

const REQUIRE_RE = /require\(\s*(['"])(\.\.?\/[^'"]+)\1\s*\)/g;
const IMPORT_RE = /from\s+(['"])(\.\.?\/[^'"]+)\1/g;

let mismatchesFound = 0;
let mismatchesFixed = 0;
const report = [];

function resolveAgainstGit(fromFileRelPath, requirePath) {
  const fromDirAbs = path.dirname(path.resolve(ROOT, fromFileRelPath));
  const targetAbsNoExt = path.resolve(fromDirAbs, requirePath);
  const targetRelNoExt = path.relative(ROOT, targetAbsNoExt).split(path.sep).join('/');

  const extensionsToTry = ['', '.js', '.jsx', '.ts', '.tsx', '.json'];
  for (const ext of extensionsToTry) {
    const candidate = (targetRelNoExt + ext).toLowerCase();
    if (trackedLookup.has(candidate)) {
      const realPath = trackedLookup.get(candidate); // correct case, with extension
      const realNoExt = ext ? realPath.slice(0, realPath.length - ext.length) : realPath;
      // Rebuild the require string preserving how many levels were used,
      // just correcting the final filename segment's case.
      const segments = requirePath.split('/');
      const realSegments = realNoExt.split('/');
      segments[segments.length - 1] = realSegments[realSegments.length - 1];
      return segments.join('/');
    }
  }
  return null; // not found among tracked files -- could be a real missing file
}

for (const relFile of filesToScan) {
  const absFile = path.join(ROOT, relFile);
  let content = fs.readFileSync(absFile, 'utf8');
  let changed = false;

  function fixMatches(regex) {
    content = content.replace(regex, (fullMatch, quote, relPath) => {
      const corrected = resolveAgainstGit(relFile, relPath);
      if (corrected && corrected !== relPath) {
        mismatchesFound++;
        report.push({ file: relFile, from: relPath, to: corrected });
        if (APPLY_FIX) {
          mismatchesFixed++;
          changed = true;
          return fullMatch.replace(relPath, corrected);
        }
      } else if (corrected === null) {
        // Path doesn't resolve to any tracked file at all -- flag separately
        report.push({ file: relFile, from: relPath, to: null, missing: true });
      }
      return fullMatch;
    });
  }

  fixMatches(REQUIRE_RE);
  fixMatches(IMPORT_RE);

  if (changed) {
    fs.writeFileSync(absFile, content, 'utf8');
  }
}

console.log(`\nChecked ${filesToScan.length} tracked JS/TS files against ${trackedFiles.length} git-tracked files.\n`);

const caseMismatches = report.filter((r) => !r.missing);
const missingRefs = report.filter((r) => r.missing);

if (caseMismatches.length === 0) {
  console.log('No case-sensitivity mismatches found against git-tracked files.');
} else {
  console.log(`Found ${mismatchesFound} case mismatch(es):\n`);
  for (const r of caseMismatches) {
    console.log(`  ${r.file}\n    "${r.from}"  ->  "${r.to}"\n`);
  }
  if (APPLY_FIX) {
    console.log(`Fixed ${mismatchesFixed} require/import path(s).`);
    console.log('   Run `git diff` to review, then commit and push.');
  } else {
    console.log('DRY RUN -- nothing changed. Re-run with --fix to apply:\n');
    console.log('  node fix-case-sensitivity-v2.js --fix\n');
  }
}

if (missingRefs.length > 0) {
  console.log(`\n${missingRefs.length} require path(s) don't match ANY tracked file (not just a case issue -- may be genuinely missing/uncommitted):\n`);
  for (const r of missingRefs) {
    console.log(`  ${r.file}\n    "${r.from}"  -> no matching file in git\n`);
  }
  console.log('For these, check if the file exists locally but was never `git add`ed (possibly blocked by .gitignore).');
}
