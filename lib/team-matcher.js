const STRIP_WORDS = ['fc','afc','sc','ac','cf','as','ss','ssc','cd','rc','ud','sd','rcd','ca','club','de','futbol','calcio','futebol','the'];

export function normalizeTeamName(name) {
  let s = String(name).toLowerCase()
    .replace(/[\u00C0-\u024F]/g, (ch) => ch.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return s.split(' ').filter((w) => !STRIP_WORDS.includes(w)).join('');
}

const ALIASES = {
  'internazionale': 'inter', 'internazionalemilano': 'inter', 'intermilan': 'inter',
  'acmilan': 'milan', 'acmilano': 'milan',
  'asroma': 'roma', 'sslazio': 'lazio', 'sscnapoli': 'napoli',
  'acffiorentina': 'fiorentina', 'atalantabc': 'atalanta',
  'atleticomadrid': 'atletico', 'atleticodemadrid': 'atletico',
  'athleticbilbao': 'athletic', 'realmadridcf': 'realmadrid',
  'fcbarcelona': 'barcelona', 'barca': 'barcelona',
  'realsociedadfc': 'realsociedad', 'villarrealcf': 'villarreal',
  'realbetis': 'betis', 'sevillafc': 'sevilla', 'valenciacf': 'valencia',
  'mancity': 'manchestercity', 'manutd': 'manchesterunited',
  'tottenhamhotspur': 'tottenham', 'westhamunited': 'westham',
  'wolverhampton': 'wolves', 'brightonhovealbion': 'brighton',
  'newcastleunited': 'newcastle', 'afcbournemouth': 'bournemouth',
  'leicestercity': 'leicester', 'southamptonfc': 'southampton',
  'evertonfc': 'everton', 'fulhamfc': 'fulham', 'arsenalfc': 'arsenal',
  'astonvillafc': 'astonvilla', 'brentfordfc': 'brentford',
  'chelseafc': 'chelsea', 'liverpoolfc': 'liverpool',
  'bayernmunchen': 'bayernmunich', 'fcbayern': 'bayernmunich',
  'borussiadortmund': 'dortmund', 'bayerleverkusen': 'leverkusen',
  'eintrachtfrankfurt': 'frankfurt', 'borussiamonchengladbach': 'monchengladbach',
  'vflwolfsburg': 'wolfsburg', 'werderbremen': 'bremen', 'svwerderbremen': 'bremen',
  'scfreiburg': 'freiburg', 'fsvmainz05': 'mainz', 'fcaugsburg': 'augsburg',
  'vfbstuttgart': 'stuttgart', 'fcunionberlin': 'unionberlin',
  'vflbochum': 'bochum', 'fcheidenheim': 'heidenheim',
  'fcsanktpauli': 'stpauli',
};

function fuzzyScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const minLen = Math.min(a.length, b.length);
  if (minLen >= 5) {
    let prefixLen = 0;
    for (let i = 0; i < minLen; i++) { if (a[i] === b[i]) prefixLen++; else break; }
    if (prefixLen >= 5 && prefixLen / Math.max(a.length, b.length) >= 0.5) return 0.9;
  }
  if (b.length >= 5 && a.includes(b)) return 0.85;
  if (a.length >= 5 && b.includes(a)) return 0.85;
  return 0;
}

export function buildBsdIndex(bsdTeams) {
  const index = new Map();
  for (const team of bsdTeams) {
    const key = normalizeTeamName(team.name);
    if (key && !index.has(key)) index.set(key, team);
  }
  return index;
}

export function findBsdTeamId(openfootballName, bsdIndex) {
  const normalized = normalizeTeamName(openfootballName);
  if (!normalized) return null;
  if (bsdIndex.has(normalized)) return bsdIndex.get(normalized);
  const aliasTarget = ALIASES[normalized];
  if (aliasTarget && bsdIndex.has(aliasTarget)) return bsdIndex.get(aliasTarget);
  let best = null, bestScore = 0;
  for (const [key, team] of bsdIndex.entries()) {
    const score = fuzzyScore(normalized, key);
    if (score > bestScore && score >= 0.85) { bestScore = score; best = team; }
  }
  return best;
}
