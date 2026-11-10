import fs from 'fs';
const files = ['app/api/scan/route.js', 'app/api/scan-over25/route.js', 'app/api/hot40/route.js'];
const newFn = `function isSameTeam(a, b) {
  if (!a || !b) return false;
  const n1 = normalizeTeamName(a);
  const n2 = normalizeTeamName(b);
  if (n1 === n2) return true;
  if (n1.length > 4 && n2.length > 4 && (n1.includes(n2) || n2.includes(n1))) return true;
  
  // Token-based matching (e.g., "RC Keruno" vs "Deportivo La Coruna" share "coruna")
  const ignore = ['club', 'fc', 'real', 'sporting', 'athletic', 'racing', 'deportivo', 'cadiz'];
  const getWords = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\\s+/).filter(w => w.length > 3 && !ignore.includes(w));
  const w1 = getWords(a);
  const.w2 = getWords(b);
  if (w1.length > 0 && w2.length > 0) {
    if (w1.some(word => w2.includes(word))) return true;
  }
  return false;
}

function finalDedup(scored) {
  const providerRank = { 'openfootball': 0, 'bzzoiro': 1, 'api-football': 2 };
  const seen = [];
  for (const item of scored) {
    const existing = seen.find((x) => isSameTeam(x.homeTeamName, item.homeTeamName) && isSameTeam(x.awayTeamName, item.awayTeamName));
    
    if (existing) {
      const existingRank = providerRank[existing.provider] ?? 99;
      const newRank = providerRank[item.provider] ?? 99;
      if (newRank > existingRank && item.provider === 'bzzoiro') {
        existing.kickoff = item.kickoff;
      } else if (newRank < existingRank) {
        const idx = seen.indexOf(existing);
        seen[idx] = item;
      }
    } else {
      seen.push(item);
    }
  }
  return seen;
}`;

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let s = fs.readFileSync(file, 'utf8');
  const startIdx = s.indexOf('function finalDedup');
  if (startIdx === -1) {
    console.log(file + ' - could not find function');
    continue;
  }
  const endIdx = s.indexOf('}', s.indexOf('return Array.from(seen.values())', startIdx));
  if (endIdx === -1) {
    console.log(file + ' - could not find end');
    continue;
  }
  s = s.substring(0, startIdx) + newFn + s.substring(endIdx + 1);
  fs.writeFileSync(file, s);
  console.log(file + ' patched with token matching');
}
