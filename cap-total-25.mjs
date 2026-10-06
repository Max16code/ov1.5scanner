import fs from 'fs';
const p = 'lib/scoring-over25.js';
let s = fs.readFileSync(p, 'utf8');

if (s.includes('MAX_TOTAL_XG_25')) {
  console.log('already capped');
  process.exit(0);
}

const oldBlock = `  const homeXG = Math.min(rawHomeXG, 3.2);
  const awayXG = Math.min(rawAwayXG, 3.2);`;

const newBlock = `  let homeXG = Math.min(rawHomeXG, 3.2);
  let awayXG = Math.min(rawAwayXG, 3.2);

  // Cap combined xG to a realistic maximum. Real football matches
  // average ~2.7 total goals; only the highest-scoring fixtures
  // exceed 3.5. Without this, two teams at the per-team cap (3.2+3.2=6.4)
  // produce Over 2.5 probabilities above 95%.
  const MAX_TOTAL_XG_25 = 3.6;
  const totalXG = homeXG + awayXG;
  if (totalXG > MAX_TOTAL_XG_25) {
    const scale = MAX_TOTAL_XG_25 / totalXG;
    homeXG = homeXG * scale;
    awayXG = awayXG * scale;
  }`;

if (!s.includes(oldBlock)) {
  console.log('ERROR: xG block not found — checking variants');
  process.exit(1);
}

s = s.replace(oldBlock, newBlock);
fs.writeFileSync(p, s);
console.log('combined xG capped at 3.6');
