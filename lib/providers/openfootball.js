export const name = 'openfootball';

const REPO_RAW = 'https://raw.githubusercontent.com/openfootball/football.json/master';

const LEAGUE_FILES = {
  'eng-pl':    { name: 'Premier League', files: ['2025-26/en.1.json', '2026-27/en.1.json'] },
  'eng-champ': { name: 'Championship',   files: ['2025-26/en.2.json', '2026-27/en.2.json'] },
  'de-1':        { name: 'Bundesliga', files: ['2025-26/de.1.json', '2026-27/de.1.json'] },
  'ita-serie-a': { name: 'Serie A', files: ['2025-26/it.1.json', '2026-27/it.1.json'] },
  'esp-liga': { name: 'La Liga', files: ['2025-26/es.1.json', '2026-27/es.1.json'] },
};

export const leagues = Object.entries(LEAGUE_FILES).map(([id, v]) => ({
  id, name: v.name, country: 'England',
}));

let _cache = null;

async function loadAllMatches() {
  if (_cache) return _cache;
  const all = [];

  for (const [leagueId, meta] of Object.entries(LEAGUE_FILES)) {
    for (const file of meta.files) {
      try {
        const res = await fetch(`${REPO_RAW}/${file}`, { next: { revalidate: 3600 } });
        if (!res.ok) {
          console.error(`openfootball: ${file} -> ${res.status}`);
          continue;
        }
        const data = await res.json();
        for (const m of (data.matches || [])) {
          all.push({
            leagueId, leagueName: meta.name, date: m.date,
            homeTeam: m.team1, awayTeam: m.team2,
            homeScore: m.score?.ft?.[0] ?? null,
            awayScore: m.score?.ft?.[1] ?? null,
          });
        }
      } catch (e) {
        console.error(`openfootball: ${file} failed:`, e.message);
      }
    }
  }

  _cache = all;
  return all;
}

function makeTeamId(leagueId, teamName) { return `${leagueId}|${teamName}`; }
function parseTeamId(teamId) {
  const idx = teamId.indexOf('|');
  if (idx === -1) return { leagueId: null, teamName: teamId };
  return { leagueId: teamId.slice(0, idx), teamName: teamId.slice(idx + 1) };
}

export async function getFixtures({ leagueIds, from, to }) {
  const all = await loadAllMatches();
  const fromD = new Date(from), toD = new Date(to);

  return all
    .filter((m) => m.homeScore === null && m.awayScore === null)
    .filter((m) => leagueIds.includes(m.leagueId))
    .filter((m) => { const d = new Date(m.date); return d >= fromD && d <= toD; })
    .map((m) => ({
      provider: name,
      fixtureId: `of|${m.leagueId}|${m.date}|${m.homeTeam}|${m.awayTeam}`,
      kickoff: new Date(m.date).toISOString(),
      leagueId: m.leagueId,
      leagueName: m.leagueName,
      homeTeamId: makeTeamId(m.leagueId, m.homeTeam),
      homeTeamName: m.homeTeam,
      awayTeamId: makeTeamId(m.leagueId, m.awayTeam),
      awayTeamName: m.awayTeam,
    }));
}

export async function getTeamSeasonMatches(teamId) {
  const all = await loadAllMatches();
  const { leagueId, teamName } = parseTeamId(teamId);

  return all
    .filter((m) => m.leagueId === leagueId)
    .filter((m) => (m.homeTeam === teamName || m.awayTeam === teamName) && m.homeScore !== null)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((m) => ({
      goalsFor: m.homeTeam === teamName ? m.homeScore : m.awayScore,
      goalsAgainst: m.homeTeam === teamName ? m.awayScore : m.homeScore,
    }));
}

export async function getInjuries() { return []; }
