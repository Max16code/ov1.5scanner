import fs from 'fs';
const p = 'app/page.jsx';
let s = fs.readFileSync(p, 'utf8');

if (s.includes("lg.key !== 'hot30'")) {
  console.log('already filtered');
  process.exit(0);
}

const oldMap = '{LEAGUES.map((lg) => (';
const newMap = "{LEAGUES.filter((lg) => lg.key !== 'hot30' || market === 'over15').map((lg) => (";

if (!s.includes(oldMap)) {
  console.log('ERROR: LEAGUES.map call not found');
  process.exit(1);
}

s = s.replace(oldMap, newMap);
fs.writeFileSync(p, s);
console.log('hot30 pill now hidden in Over 2.5 mode');
