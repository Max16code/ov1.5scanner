import fs from 'fs';
const p = 'app/api/hot30/route.js';
let s = fs.readFileSync(p, 'utf8');

if (s.includes("selectedLeagues = null; // HOT30")) {
  console.log('already fixed');
  process.exit(0);
}

const anchor = "const { from, to } = sanitizeRange(bodyFrom, bodyTo);\n  const providers = getActiveProviders();";

if (!s.includes(anchor)) {
  console.log('ERROR: anchor not found');
  process.exit(1);
}

const fix = "const { from, to } = sanitizeRange(bodyFrom, bodyTo);\n\n  // HOT30 scans every league — clear the filter if the pill key was sent\n  if (selectedLeagues && selectedLeagues.includes('hot30')) {\n    selectedLeagues = null;\n  }\n\n  const providers = getActiveProviders();";

s = s.replace(anchor, fix);
fs.writeFileSync(p, s);
console.log('hot30 fix applied');
