// fix-past-assets.js
// Usage: node fix-past-assets.js
const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();
const manifestPath = path.join(repoRoot, 'past-manifest.json');
const htmlPath = path.join(repoRoot, 'past.html');
const thumbDir = path.join(repoRoot, 'assets', 'past', 'thumb_named');
const fullDir = path.join(repoRoot, 'assets', 'past', 'full');

function listFiles(dir) {
  try {
    return fs.readdirSync(dir).map(n => path.join(dir, n));
  } catch (e) {
    return [];
  }
}

function basenameMap(files) {
  const map = new Map();
  for (const f of files) {
    const b = path.basename(f).replace(/\s+/g, ' ');
    map.set(b, f.replace(repoRoot + path.sep, '').replace(/\\/g,'/'));
  }
  return map;
}

const thumbs = basenameMap(listFiles(thumbDir));
const fulls = basenameMap(listFiles(fullDir));

// prefer thumb when available
function findAssetForFilename(filename) {
  filename = filename.replace(/^\.+/,'').split(/[?#]/)[0];
  const base = path.basename(filename);
  if (thumbs.has(base)) return thumbs.get(base);
  if (fulls.has(base)) return fulls.get(base);
  // try lower-case matching
  const lower = [...thumbs.keys()].find(k => k.toLowerCase() === base.toLowerCase());
  if (lower) return thumbs.get(lower);
  const lowerFull = [...fulls.keys()].find(k => k.toLowerCase() === base.toLowerCase());
  if (lowerFull) return fulls.get(lowerFull);
  return null;
}

function safeWrite(file, content) {
  fs.copyFileSync(file, file + '.bak');
  fs.writeFileSync(file, content, 'utf8');
}

// 1) Update manifest
if (!fs.existsSync(manifestPath)) {
  console.error('past-manifest.json not found at', manifestPath);
  process.exit(1);
}
const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
let manifest;
try {
  manifest = JSON.parse(manifestRaw);
} catch (e) {
  console.error('failed to parse past-manifest.json:', e.message);
  process.exit(1);
}
let manifestChanges = 0;
const unresolvedManifest = [];

if (Array.isArray(manifest.items)) {
  manifest.items.forEach(item => {
    if (!item || typeof item !== 'object') return;
    const src = item.src && String(item.src);
    // condition to consider 'broken': not starting with 'assets/'
    if (!src || !src.startsWith('assets/')) {
      // try thumb then full fields first if present and valid assets path
      const candidates = [];
      if (item.thumb && String(item.thumb).startsWith('assets/')) candidates.push(item.thumb);
      if (item.full && String(item.full).startsWith('assets/')) candidates.push(item.full);
      // try filename heuristics
      const filename = src ? path.basename(src) : null;
      if (filename) {
        const asset = findAssetForFilename(filename);
        if (asset) candidates.unshift(asset);
      }
      if (candidates.length > 0) {
        item.src = candidates[0];
        manifestChanges++;
      } else {
        unresolvedManifest.push(src || '(empty src)');
      }
    }
  });
} else {
  console.error('manifest.items is not an array');
  process.exit(1);
}

if (manifestChanges > 0) {
  safeWrite(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`manifest: updated ${manifestChanges} item.src values and wrote backup at past-manifest.json.bak`);
} else {
  console.log('manifest: no changes needed');
}
if (unresolvedManifest.length) {
  console.warn('manifest: unresolved items (no matching asset found) -- list:');
  console.warn(unresolvedManifest.join('\n'));
}

// 2) Update past.html
if (!fs.existsSync(htmlPath)) {
  console.error('past.html not found at', htmlPath);
  process.exit(1);
}
let htmlRaw = fs.readFileSync(htmlPath, 'utf8');
const htmlReplacements = [];
// match src= or href= attributes with quotes (single or double), allow whitespace
htmlRaw = htmlRaw.replace(/(src|href)\s*=\s*(['"])([^'">]+)\2/gi, (m, attr, q, val) => {
  // skip if already an assets path (good)
  if (val.startsWith('assets/')) return m;
  // skip external urls
  if (/^[a-z]+:\/\//i.test(val)) return m;
  // extract filename
  const filename = path.basename(val);
  const found = findAssetForFilename(filename);
  if (found) {
    htmlReplacements.push({ attr, from: val, to: found });
    return `${attr}=${q}${found}${q}`;
  }
  return m;
});

if (htmlReplacements.length > 0) {
  safeWrite(htmlPath, htmlRaw);
  console.log(`past.html: applied ${htmlReplacements.length} replacements and wrote backup at past.html.bak`);
  for (const r of htmlReplacements) {
    console.log(`  ${r.attr}: ${r.from} -> ${r.to}`);
  }
} else {
  console.log('past.html: no replacements needed');
}

console.log('done. Review backups (.bak) before committing.');
