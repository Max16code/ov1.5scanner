const HOST = 'https://sports.bzzoiro.com';
const KEY = process.env.BZZOIRO_API_KEY;

async function apiGet(path) {
  if (!KEY) throw new Error('BZZOIRO_API_KEY not set');
  const res = await fetch(`${HOST}${path}`, {
    headers: { Authorization: `Token ${KEY}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`BSD ${res.status}: ${await res.text()}`);
  return res.json();
}

export const name = 'bzzoiro';

export const LEAGUE_MAP = {
  'eng-pl':        1,
  'eng-champ':     12,
  'ita-serie-a':   4,
  'esp-liga':      3,
  'de-1':          5,
  'ucl':           7,
  'nl-eredivisie': 10,
  'pt-primeira':   2,
  'fr-1':          6,
  'eng-l1':        86,
  'eng-l2':        87,
  'sco-prem':      13,
};

function leagueNameFromCode(code) {
  const map = {
    'eng-pl': 'Premier League',
    'eng-champ': 'Championship',
    'ita-serie-a': 'Serie A',
    'esp-liga': 'La Liga',
    'de-1': 'Bundesliga',
    'ucl': 'Champions League',
    'nl-eredivisie': 'Eredivisie',
    'pt-primeira': 'Primeira Liga',
    'fr-1': 'Ligue 1',
    'eng-l1': 'League One',
    'eng-l2': 'League Two',
    'sco-prem': 'Scottish Premiership',
  };
  return map[code] || code;
}

function bareId(teamId) {
  return String(teamId).replace(/^bsd\|/, '');
}

export async function getFixtures({ leagueIds, from, to }) {
  const out = [];

  for (const code of leagueIds) {
    const bsdId = LEAGUE_MAP[code];
    if (!bsdId) continue;

    try {
      const json = await apiGet(`/api/v2/events/?league_id=${bsdId}&date_from=${from}&date_to=${to}&limit=200`);
      const events = json.results || [];

      for (const e of events) {
        if (e.status !== 'notstarted') continue;

        out.push({
          provider: name,
          fixtureId: `bsd|${e.id}`,
          kickoff: e.event_date,
          leagueId: code,
          leagueName: leagueNameFromCode(code),
          homeTeamId: `bsd|${e.home_team_id}`,
          homeTeamName: e.home_team,
          awayTeamId: `bsd|${e.away_team_id}`,
          awayTeamName: e.away_team,
          h2hAvgGoals: e.head_to_head?.avg_total_goals ?? null,
          h2hTotalMatches: e.head_to_head?.total_matches ?? null,
        });
      }
    } catch (err) {
      console.error(`bzzoiro: league ${code} (${bsdId}) failed:`, err.message);
    }
  }

  return out;
}

export async function getTeamSeasonMatches(teamId) {
  try {
    const json = await apiGet(`/api/v2/teams/${bareId(teamId)}/form/?last=20`);

    const matches = json.recent_matches || json.matches_detail || [];

    if (Array.isArray(matches) && matches.length > 0) {
      return matches.map((m) => ({
        goalsFor: m.team_id === parseInt(bareId(teamId), 10) ? m.home_score : m.away_score,
        goalsAgainst: m.team_id === parseInt(bareId(teamId), 10) ? m.away_score : m.home_score,
      }));
    }

    const overall = json.overall || {};
    const played = overall.matches || 0;
    const goalsFor = overall.goals_for || 0;
    const goalsAgainst = overall.goals_against || 0;
    if (played === 0) return [];

    const perMatchFor = goalsFor / played;
    const perMatchAgainst = goalsAgainst / played;
    const synth = [];
    for (let i = 0; i < played; i++) {
      synth.push({
        goalsFor: Math.round(perMatchFor),
        goalsAgainst: Math.round(perMatchAgainst),
      });
    }
    return synth;
  } catch (err) {
    console.error(`bzzoiro: form for ${teamId} failed:`, err.message);
    return [];
  }
}

export async function getInjuries() {
  return [];
}

// Compute Over 1.5 / Over 2.5 rates from BSD's aggregate form data.
// BSD's /teams/{id}/form/ endpoint doesn't return per-match history —
// it returns averaged stats. We derive the rates via Poisson.
export async function getTeamStats(teamId) {
  try {
    const json = await apiGet(`/api/v2/teams/${bareId(teamId)}/form/?last=20`);
    const o = json.overall || {};
    const played = o.matches || 0;
    if (played === 0) return null;

    const goalsFor = o.goals_for || 0;
    const goalsAgainst = o.goals_against || 0;
    const avgFor = goalsFor / played;
    const avgAgainst = goalsAgainst / played;

    // Combined expected total goals per match for this team
    const lambda = avgFor + avgAgainst;

    // Poisson-derived rates
    const over15Rate = 1 - Math.exp(-lambda) * (1 + lambda);
    const MAX_TEAM_O25 = 0.70;
    const over25Rate = Math.min(1 - Math.exp(-lambda) * (1 + lambda + (lambda * lambda) / 2), MAX_TEAM_O25);

    // Recent form string (e.g. "DWDLWDLLWW") — parse last 5 for trend
    const formStr = String(o.form || "").slice(-5);
    const wins = (formStr.match(/W/g) || []).length;
    const draws = (formStr.match(/D/g) || []).length;
    const recentPointsRate = (wins * 3 + draws) / (5 * 3);

    return {
      teamId,
      matchesPlayed: played,
      goalsFor,
      goalsAgainst,
      avgFor,
      avgAgainst,
      over15Rate,
      over25Rate,
      last5Over15Rate: over15Rate,
      recentPointsRate,
    };
  } catch (err) {
    console.error(`bzzoiro: getTeamStats for ${teamId} failed:`, err.message);
    return null;
  }
}

// Fetch a team's full squad and compute a weighted "how much does this
// team miss?" number for the Over 1.5 model.
//
// Weight by position: forwards matter most (they score), defenders least
// (they prevent the opposition, which is a smaller signal for total goals).
export async function getTeamAvailability(teamId) {
  try {
    const json = await apiGet(`/api/v2/teams/${bareId(teamId)}/squad/`);
    const players = json.players || [];
    if (players.length === 0) return { weightedOut: 0, absences: [] };

    let weightedOut = 0;
    const absences = [];

    for (const p of players) {
      if (p.availability === 'available') continue;

      const weight =
        p.position === 'F' ? 2.0 :
        p.position === 'M' ? 1.2 :
        p.position === 'G' ? 1.0 :
        p.position === 'D' ? 0.8 : 1.0;

      weightedOut += weight;
      absences.push({
        name: p.short_name || p.name,
        position: p.position,
        reason: p.injury_type || 'Unavailable',
      });
    }

    return { weightedOut: Math.round(weightedOut * 10) / 10, absences };
  } catch (err) {
    console.error(`bzzoiro: getTeamAvailability for ${teamId} failed:`, err.message);
    return { weightedOut: 0, absences: [] };
  }
}


// Fetch BSD team list for name matching (used to enrich openfootball fixtures).
// Filtered by country to keep the index small. Cached 7 days.
import { getCachedBsdTeams, setCachedBsdTeams } from '../cache.js';

export async function getBsdTeamList() {
  const cached = getCachedBsdTeams();
  if (cached && cached.length > 0) return cached;

  const wantedCountries = new Set(['GB', 'IT', 'ES', 'DE', 'FR', 'NL', 'PT']);
  const all = [];
  let offset = 0;
  const pageSize = 500;

  try {
    for (let i = 0; i < 25; i++) {
      const json = await apiGet(`/api/v2/teams/?limit=${pageSize}&offset=${offset}`);
      const results = json.results || [];
      if (results.length === 0) break;
      for (const t of results) {
        if (t.name && t.country_code && wantedCountries.has(t.country_code)) {
          all.push({ id: t.id, name: t.name, country: t.country_code });
        }
      }
      if (!json.next) break;
      offset += pageSize;
    }
    setCachedBsdTeams(all);
    console.log('bzzoiro: cached', all.length, 'relevant teams');
    return all;
  } catch (err) {
    console.error('bzzoiro: failed to fetch team list:', err.message);
    return [];
  }
}
