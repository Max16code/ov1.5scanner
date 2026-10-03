const HOST = process.env.API_FOOTBALL_HOST || 'v3.football.api-sports.io';
const KEY = process.env.API_FOOTBALL_KEY;
const SEASON = parseInt(process.env.API_FOOTBALL_SEASON || '2025', 10);

async function apiGet(path, params) {
  if (!KEY) throw new Error('API_FOOTBALL_KEY not set');

  const url = new URL(`https://${HOST}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    headers: { 'x-apisports-key': KEY },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`API-Football ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();

  if (json.errors && Object.keys(json.errors).length > 0) {
    throw new Error(`API-Football error: ${JSON.stringify(json.errors)}`);
  }

  return json.response || [];
}

export const name = 'api-football';

// What this provider can cover
export const leagues = [
  { id: 39,  name: 'Premier League',   country: 'England' },
  { id: 40,  name: 'Championship',     country: 'England' },
  { id: 41,  name: 'League One',       country: 'England' },
  { id: 42,  name: 'League Two',       country: 'England' },
  { id: 43,  name: 'National League',  country: 'England' },
  { id: 140, name: 'La Liga',          country: 'Spain' },
  { id: 78,  name: 'Bundesliga',       country: 'Germany' },
  { id: 135, name: 'Serie A',          country: 'Italy' },
  { id: 61,  name: 'Ligue 1',          country: 'France' },
];

export async function getFixtures({ leagueIds, from, to }) {
  const out = [];

  for (const leagueId of leagueIds) {
    try {
      const raw = await apiGet('/fixtures', {
        league: leagueId,
        from,
        to,
        season: SEASON,
      });

      for (const f of raw) {
        out.push({
          provider: name,
          fixtureId: String(f.fixture.id),
          kickoff: f.fixture.date,
          leagueId: String(leagueId),
          leagueName: leagues.find((l) => l.id === leagueId)?.name || `League ${leagueId}`,
          homeTeamId: String(f.teams.home.id),
          homeTeamName: f.teams.home.name,
          awayTeamId: String(f.teams.away.id),
          awayTeamName: f.teams.away.name,
        });
      }
    } catch (e) {
      console.error(`api-football: league ${leagueId} failed:`, e.message);
    }
  }

  return out;
}

export async function getTeamSeasonMatches(teamId) {
  return apiGet('/fixtures', { team: teamId, season: SEASON, status: 'FT' });
}

export async function getInjuries(fixtureId) {
  try {
    return await apiGet('/injuries', { fixture: fixtureId });
  } catch (e) {
    console.error(`api-football: injuries ${fixtureId} failed:`, e.message);
    return [];
  }
}
