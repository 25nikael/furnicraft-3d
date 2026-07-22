'use strict';
/**
 * Copies ../public into ./www.
 *
 * Capacitor requires a webDir to exist even when `server.url` is set (it is the
 * fallback bundle shipped inside the APK). Keeping it a copy rather than a
 * symlink means `npx cap sync` behaves the same on every OS, and it leaves the
 * door open to switching to a fully bundled build later — see MOBILE.md.
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'public');
const dest = path.join(__dirname, 'www');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(src)) {
  console.error('Cannot find ' + src + ' — run this from the mobile/ folder of the repo.');
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
copyDir(src, dest);

let count = 0;
(function walk(p) {
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(p, e.name)); else count++;
  }
})(dest);
console.log('Copied ' + count + ' files from public/ to mobile/www/');
