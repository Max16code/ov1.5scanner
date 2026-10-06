import fs from 'fs';
const p = 'app/page.jsx';
let s = fs.readFileSync(p, 'utf8');

if (s.includes('BEST TIME TO SCAN')) {
  console.log('already present');
  process.exit(0);
}

const h1Line = "          <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>Over {label} Scanner</h1>";

if (s.indexOf(h1Line) === -1) {
  console.log('ERROR: h1 line not found in file');
  process.exit(1);
}

const warning = [
  h1Line,
  "          <div style={{ marginTop: '0.75rem', padding: '0.625rem 0.875rem', background: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.25)', borderRadius: '0.75rem', fontSize: '0.75rem', color: '#fbbf24', lineHeight: 1.5, maxWidth: '42rem' }}>",
  "            <strong style={{ color: '#fcd34d' }}>BEST TIME TO SCAN:</strong> within 24 hours of kickoff. Injury data is a live snapshot, for fixtures further out the injury component is directional, not precise.",
  "          </div>"
].join('\n');

s = s.replace(h1Line, warning);
fs.writeFileSync(p, s);
console.log('warning inserted');
