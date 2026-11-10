import fs from 'fs';
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
async function run() {
  const query = "SELECT CASE WHEN probability >= 80 THEN '80+' WHEN probability >= 75 THEN '75-79' WHEN probability >= 70 THEN '70-74' ELSE 'below70' END AS band, COUNT(*) as total, COUNT(*) FILTER (WHERE outcome = 'hit') as hits FROM picks WHERE outcome IN ('hit', 'miss') GROUP BY band";
  const stats = await sql.unsafe(query);
  let offsets = { '80+': 0, '75-79': 0, '70-74': 0, 'below70': 0 };
  stats.forEach(row => {
    if (row.total >= 10) {
      const actual = parseFloat(row.hits) / parseFloat(row.total);
      let expected = 0.85;
      if (row.band === '75-79') expected = 0.77;
      if (row.band === '70-74') expected = 0.72;
      if (row.band === 'below70') expected = 0.65;
      let diff = actual - expected;
      if (diff > 0.05) diff = 0.05;
      if (diff < -0.05) diff = -0.05;
      offsets[row.band] = parseFloat(diff.toFixed(3));
    }
  });
  const p = 'lib/scoring.js';
  let s = fs.readFileSync(p, 'utf8');
  const anchor = 'const finalProb = Math.max(0, Math.min(1, pOver15 - injuryPenalty));';
  const oldRegex = /\/\/ CALIBRATION LAYER[\s\S]*?const finalCalibratedProb = Math\.max\(0, Math\.min\(1, calibratedProb\)\);/;
  const newBlock = "\n  // CALIBRATION LAYER (Dynamically Recalculated)\n" +
    "  let calibratedProb = finalProb;\n" +
    "  if (finalProb >= 0.80) {\n" +
    "    calibratedProb += " + offsets['80+'] + ";\n" +
    "  } else if (finalProb >= 0.75 && finalProb < 0.80) {\n" +
    "    calibratedProb += " + offsets['75-79'] + ";\n" +
    "  } else if (finalProb >= 0.70 && finalProb < 0.75) {\n" +
    "    calibratedProb += " + offsets['70-74'] + ";\n" +
    "  } else {\n" +
    "    calibratedProb += " + offsets['below70'] + ";\n" +
    "  }\n" +
    "  const finalCalibratedProb = Math.max(0, Math.min(1, calibratedProb));\n";
  if (oldRegex.test(s)) { s = s.replace(oldRegex, newBlock); } else if (s.indexOf(anchor) > -1) { s = s.replace(anchor, anchor + '\n' + newBlock); } else { console.log('Error: Could not find anchor'); process.exit(1); }
  fs.writeFileSync(p, s);
  console.log('--- SUCCESS ---');
  console.log('80%+ offset:', offsets['80+']);
  console.log('75-79% offset:', offsets['75-79']);
  console.log('70-74% offset:', offsets['70-74']);
  console.log('Below 70% offset:', offsets['below70']);
  console.log('lib/scoring.js calibrated automatically');
  await sql.end();
}
run();
