import { NextResponse } from 'next/server';
import { getActiveProviders, LEAGUE_SELECTION } from '@/lib/provider-index';
import { computeTeamStats, scoreFixture } from '@/lib/scoring';
import { computeTeamStatsOver25, scoreFixtureOver25 } from '@/lib/scoring-over25';
import {
  getCachedTeamForm,
  setCachedTeamForm,
  getCachedInjuries,
  setCachedInjuries,
} from '@/lib/cache';
// WIRE_INJURIES_V1 — team matcher + BSD team list for openfootball fixtures
import { buildBsdIndex, findBsdTeamId } from '@/lib/team-matcher';
import * as bzzoiroModule from '@/lib/providers/bzzoiro';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_DAYS_AHEAD = 14;

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function sanitizeRange(bodyFrom, bodyTo) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + MAX_DAYS_AHEAD);

  let from = bodyFrom ? new Date(bodyFrom) : today;
  let to = bodyTo ? new Date(bodyTo) : maxDate;

  if (isNaN(from.getTime())) from = today;
  if (isNaN(to.getTime())) to = maxDate;
  if (from < today) from = today;
  if (to > maxDate) to = maxDate;
  if (from > to) from = to;

  return { from: ymd(from), to: ymd(to) };
}

async function fetchTeamForm(provider, teamId) {
  if (typeof provider.getTeamStats === 'function') {
    const stats = await provider.getTeamStats(teamId);
    if (stats) return stats;
  }
  const cached = getCachedTeamForm(provider.name, teamId);
  if (cached) return computeTeamStats(cached, teamId);
  const fresh = await provider.getTeamSeasonMatches(teamId);
  setCachedTeamForm(provider.name, teamId, fresh);
  return computeTeamStats(fresh, teamId);
}

async function fetchInjuries(provider, fixtureId, homeId, awayId, homeName, awayName, bsdIndex) {
  if (typeof provider.getTeamAvailability === 'function') {
    const home = await provider.getTeamAvailability(homeId);
    const away = await provider.getTeamAvailability(awayId);
    return { homeKeyOut: home.weightedOut, awayKeyOut: away.weightedOut };
  }

  if (bsdIndex && typeof bzzoiroModule.getTeamAvailability === 'function') {
    let homeKeyOut = 0, awayKeyOut = 0;
    try {
      const homeBsd = homeName ? findBsdTeamId(homeName, bsdIndex) : null;
      if (homeBsd) {
        const stats = await bzzoiroModule.getTeamAvailability('bsd|' + homeBsd.id);
        homeKeyOut = stats.weightedOut || 0;
      }
      const awayBsd = awayName ? findBsdTeamId(awayName, bsdIndex) : null;
      if (awayBsd) {
        const stats = await bzzoiroModule.getTeamAvailability('bsd|' + awayBsd.id);
        awayKeyOut = stats.weightedOut || 0;
      }
    } catch (e) {
      console.error('injury lookup failed:', e.message);
    }
    return { homeKeyOut, awayKeyOut };
  }

  return { homeKeyOut: 0, awayKeyOut: 0 };
}

function normalizeTeamName(name) {
  return String(name)
    .toLowerCase()
    .replace(/\b(fc|afc|sc|ac|cf|united|utd|city|town)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

export async function POST(request) {
  let selectedLeagues = null;
  let bodyFrom = null, bodyTo = null;
  let market = 'over15';
  try {
    const body = await request.json();
    if (Array.isArray(body?.leagues) && body.leagues.length > 0) selectedLeagues = body.leagues;
    if (typeof body?.from === 'string') bodyFrom = body.from;
    if (typeof body?.to === 'string') bodyTo = body.to;
    if (body?.market === 'over25') market = 'over25';
  } catch {}

  const { from, to } = sanitizeRange(bodyFrom, bodyTo);

  // HOT40 scans every league — clear the filter if the pill key was sent
  if (selectedLeagues && selectedLeagues.includes('hot40')) {
    selectedLeagues = null;
  }

  const providers = getActiveProviders();

  const allFixtures = [];
  for (const provider of providers) {
    let leagueIds = LEAGUE_SELECTION[provider.name] || [];
    if (selectedLeagues) leagueIds = leagueIds.filter((id) => selectedLeagues.includes(id));
    if (leagueIds.length === 0) continue;
    try {
      const fixtures = await provider.getFixtures({ leagueIds, from, to });
      allFixtures.push(...fixtures.map((f) => ({ ...f, _provider: provider })));
    } catch (e) {
      console.error(`${provider.name}: getFixtures failed:`, e.message);
    }
  }

  console.log('HOT40 DEBUG: fixtures fetched:', allFixtures.length);
  // PREFER_OPENFOOTBALL: sort so openfootball fixtures are deduped first.
  const providerRank = { 'openfootball': 0, 'bzzoiro': 1, 'api-football': 2 };
  allFixtures.sort((a, b) =>
    (providerRank[a._provider?.name] ?? 99) - (providerRank[b._provider?.name] ?? 99)
  );

  const seen = new Set();
  const uniqueFixtures = [];
  for (const fx of allFixtures) {
    const key = normalizeTeamName(fx.homeTeamName) + '|' + normalizeTeamName(fx.awayTeamName);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueFixtures.push(fx);
  }

  console.log('HOT40 DEBUG: unique fixtures:', uniqueFixtures.length);
  // WIRE_INJURIES_V1 — fetch BSD team list once, build the name lookup index
  let bsdIndex = null;
  try {
    const bsdTeams = await bzzoiroModule.getBsdTeamList();
    bsdIndex = buildBsdIndex(bsdTeams);
    console.log('injury index built with', bsdTeams.length, 'teams');
  } catch (e) {
    console.error('failed to build BSD team index:', e.message);
  }

  const scored = [];
  for (const fx of uniqueFixtures) {
    const provider = fx._provider;
    try {
      const home = await fetchTeamForm(provider, fx.homeTeamId);
      const away = await fetchTeamForm(provider, fx.awayTeamId);
      const injuries = await fetchInjuries(provider, fx.fixtureId, fx.homeTeamId, fx.awayTeamId, fx.homeTeamName, fx.awayTeamName, bsdIndex);
      const clean = { ...fx };
      delete clean._provider;

      const result15 = scoreFixture(clean, home, away, injuries);
      const result25 = scoreFixtureOver25(clean, home, away, injuries);

      scored.push({
        ...result15,
        scoreOver15: result15.score,
        scoreOver25: result25.score,
        provider: provider.name,
      });
    } catch (e) {
      console.error(`${provider.name}: scoring failed:`, e.message);
    }
  }

  console.log('HOT40 DEBUG: scored:', scored.length);
  console.log('HOT40 DEBUG: sample scores:', scored.slice(0, 3).map(function(x){return x.scoreOver15 + '/' + x.scoreOver25;}));
  const isOver25 = market === 'over25';
  const threshold = isOver25 ? 45 : 55;
  const scoreKey = isOver25 ? 'scoreOver25' : 'scoreOver15';

  const candidates = scored
    .filter(function(x) { return x[scoreKey] >= threshold; })
    .map(function(x) {
      return Object.assign({}, x, {
        market: isOver25 ? '2.5' : '1.5',
        displayScore: x[scoreKey],
        score: x[scoreKey],
      });
    })
    .sort(function(a, b) { return b.displayScore - a.displayScore; });

  console.log('HOT40 DEBUG: candidates after threshold:', candidates.length);
  const top = candidates
    .sort((a, b) => b.displayScore - a.displayScore)
    .slice(0, 40);

  return NextResponse.json({
    scannedAt: new Date().toISOString(),
    dateRange: { from, to },
    market: isOver25 ? '2.5' : '1.5',
    totalFixtures: uniqueFixtures.length,
    results: top,
  });
}
