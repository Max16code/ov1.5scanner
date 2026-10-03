const fs = require('fs');
const path = require('path');

const root = process.cwd();
const standaloneDir = path.join(root, '.next', 'standalone');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`Skipping missing source: ${src}`);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Copy .next/static into .next/standalone/.next/static
copyDir(
  path.join(root, '.next', 'static'),
  path.join(standaloneDir, '.next', 'static')
);

// Copy public into .next/standalone/public
copyDir(
  path.join(root, 'public'),
  path.join(standaloneDir, 'public')
);

console.log('Standalone static assets copied.');
