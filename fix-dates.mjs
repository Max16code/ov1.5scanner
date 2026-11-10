import fs from 'fs';

const files = [
  'app/api/scan/route.js',
  'app/api/scan-over25/route.js',
  'app/api/hot40/route.js',
];

for (const file of files) {
  let s = fs.readFileSync(file, 'utf8');

  const oldFn = /function finalDedup\(scored\) \{+\[.\s\\S]*?\n\}/;

  const newFn = `function finalDedup(scored) {
  const providerRank = { 'openfootball': 0, 'bzzoiro': 1, 'api-football': 2 };
  const seen = new Map();
  for (const item of scored) {
    const key = normalizeTeamName(item.homeTeamName) + '|' + normalizeTeamName(item.awayTeamName);
    const existing = seen.get(key);
    if (existing === undefined) {
      seen.set(key, item);
      continue;
    }
    const existingRank = providerRank[existing.provider] ?? 99;
    const newRank = providerRank[item.provider] ?? 99;
    
    // If BSD has the match, we keep the OpenFootball stats but update the date to BSD's accurate date
    if (newRank > existingRank && item.provider === 'bzzoiro') {
      existing.kickoff = item.kickoff;
    } else if (newRank < existingRank) {
      seen.set(key, item);
    }
  }
  return Array.from(seen.values());
}`;

  if (oldFn.test(s)) {
    s = s.replace(oldFn, newFn);
    fs.writeFileSync(file, s);
    console.log(file + ' patched for accurate dates');
  } else {
    console.log('Could not find finalDedup in ' + file);
  }
}
