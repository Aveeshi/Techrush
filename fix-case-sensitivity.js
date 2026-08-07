/**
 * fix-case-sensitivity.js
 *
 * Scans your project for require(...) / import ... from '...' statements
 * that reference local files, checks the ACTUAL filename casing on disk,
 * and rewrites the require/import path to match exactly.
 *
 * This fixes the "works on Windows, breaks on Linux (Render/Heroku/etc)"
 * problem where require('../controllers/eventController') doesn't match
 * an actual file named EventController.js.
 *
 * USAGE:
 *   node fix-case-sensitivity.js         -> dry run, just reports mismatches
 *   node fix-case-sensitivity.js --fix   -> actually rewrites the files
 *
 * Run this from your project root (same folder as package.json).
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const APPLY_FIX = process.argv.includes('--fix');

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'public']);
const JS_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

let filesScanned = 0;
let mismatchesFound = 0;
let mismatchesFixed = 0;
const report = [];

// Regex to catch: require('./x'), require("../x"), from './x', from "../x"
const REQUIRE_RE = /require\(\s*(['"])(\.\.?\/[^'"]+)\1\s*\)/g;
const IMPORT_RE = /from\s+(['"])(\.\.?\/[^'"]+)\1/g;

function walk(dir, callback) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, callback);
    } else if (JS_EXTENSIONS.has(path.extname(entry.name))) {
      callback(full);
    }
  }
}

// Given a require path like '../controllers/eventController' relative to
// fromFile, find what the file ACTUALLY resolves to and return the real
// on-disk relative path (with correct case), or null if we can't resolve it.
function resolveActualCase(fromFile, relativePath) {
  const fromDir = path.dirname(fromFile);
  const targetNoExt = path.resolve(fromDir, relativePath);

  const dir = path.dirname(targetNoExt);
  const base = path.basename(targetNoExt);

  if (!fs.existsSync(dir)) return null;

  const candidates = fs.readdirSync(dir);

  // Try to find a matching file, case-insensitively, with common extensions
  const extensionsToTry = ['', '.js', '.jsx', '.ts', '.tsx', '.json'];
  let actualEntryName = null;

  for (const ext of extensionsToTry) {
    const wanted = (base + ext).toLowerCase();
    const match = candidates.find((c) => c.toLowerCase() === wanted);
    if (match) {
      actualEntryName = ext === '' ? match : match.replace(new RegExp(ext + '$', 'i'), '');
      break;
    }
  }

  // Also handle case where relativePath points at a directory with an index file
  if (!actualEntryName) {
    const asDir = path.join(dir, base);
    if (fs.existsSync(asDir) && fs.statSync(asDir).isDirectory()) {
      actualEntryName = base; // directory case already correct at this level
    }
  }

  if (!actualEntryName) return null;

  // Only report/fix if case actually differs
  if (actualEntryName === base) return null;

  // Rebuild the relative path with corrected case for just the final segment
  const segments = relativePath.split('/');
  segments[segments.length - 1] = actualEntryName;
  return segments.join('/');
}

function processFile(file) {
  filesScanned++;
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  function fixMatches(regex) {
    content = content.replace(regex, (fullMatch, quote, relPath) => {
      const corrected = resolveActualCase(file, relPath);
      if (corrected && corrected !== relPath) {
        mismatchesFound++;
        report.push({
          file: path.relative(ROOT, file),
          from: relPath,
          to: corrected,
        });
        if (APPLY_FIX) {
          mismatchesFixed++;
          changed = true;
          return fullMatch.replace(relPath, corrected);
        }
      }
      return fullMatch;
    });
  }

  fixMatches(REQUIRE_RE);
  fixMatches(IMPORT_RE);

  if (changed) {
    fs.writeFileSync(file, content, 'utf8');
  }
}

walk(ROOT, processFile);

console.log(`\nScanned ${filesScanned} files.\n`);

if (report.length === 0) {
  console.log('✅ No case-sensitivity mismatches found.');
} else {
  console.log(`⚠️  Found ${mismatchesFound} mismatch(es):\n`);
  for (const r of report) {
    console.log(`  ${r.file}\n    "${r.from}"  →  "${r.to}"\n`);
  }

  if (APPLY_FIX) {
    console.log(`✅ Fixed ${mismatchesFixed} require/import path(s) in place.`);
    console.log('   Review the diffs with `git diff`, then commit and push.');
  } else {
    console.log('This was a DRY RUN — no files were changed.');
    console.log('Run again with --fix to apply these corrections:\n');
    console.log('  node fix-case-sensitivity.js --fix\n');
  }
}
