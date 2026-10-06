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

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_DAYS_AHEAD = 28;

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

async function fetchInjuries(provider, fixtureId, homeId, awayId) {
  if (typeof provider.getTeamAvailability === 'function') {
    const home = await provider.getTeamAvailability(homeId);
    const away = await provider.getTeamAvailability(awayId);
    return { homeKeyOut: home.weightedOut, awayKeyOut: away.weightedOut };
  }
  const cached = getCachedInjuries(provider.name, fixtureId);
  const list = cached ?? (await provider.getInjuries(fixtureId));
  if (!cached) setCachedInjuries(provider.name, fixtureId, list);
  let homeKeyOut = 0, awayKeyOut = 0;
  for (const inj of list) {
    const type = (inj.player?.type ?? '').toLowerCase();
    const reason = (inj.player?.reason ?? '').toLowerCase();
    const isAbsence = type.includes('missing') || reason.includes('injur') || reason.includes('suspension');
    if (!isAbsence) continue;
    if (inj.team?.id === homeId) homeKeyOut++;
    else if (inj.team?.id === awayId) awayKeyOut++;
  }
  return { homeKeyOut, awayKeyOut };
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
  const seen = new Set();
  const uniqueFixtures = [];
  for (const fx of allFixtures) {
    const key = normalizeTeamName(fx.homeTeamName) + '|' + normalizeTeamName(fx.awayTeamName);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueFixtures.push(fx);
  }

  console.log('HOT40 DEBUG: unique fixtures:', uniqueFixtures.length);
  const scored = [];
  for (const fx of uniqueFixtures) {
    const provider = fx._provider;
    try {
      const home = await fetchTeamForm(provider, fx.homeTeamId);
      const away = await fetchTeamForm(provider, fx.awayTeamId);
      const injuries = await fetchInjuries(provider, fx.fixtureId, fx.homeTeamId, fx.awayTeamId);
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
