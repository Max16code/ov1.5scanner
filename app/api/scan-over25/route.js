import { NextResponse } from 'next/server';
import { getActiveProviders, LEAGUE_SELECTION } from '@/lib/provider-index';
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
  const cached = getCachedTeamForm(provider.name, teamId);
  if (cached) return computeTeamStatsOver25(cached, teamId);
  const fresh = await provider.getTeamSeasonMatches(teamId);
  setCachedTeamForm(provider.name, teamId, fresh);
  return computeTeamStatsOver25(fresh, teamId);
}

async function fetchInjuries(provider, fixtureId, homeId, awayId) {
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

export async function POST(request) {
  let selectedLeagues = null;
  let bodyFrom = null, bodyTo = null;
  try {
    const body = await request.json();
    if (Array.isArray(body?.leagues) && body.leagues.length > 0) selectedLeagues = body.leagues;
    if (typeof body?.from === 'string') bodyFrom = body.from;
    if (typeof body?.to === 'string') bodyTo = body.to;
  } catch {}

  const { from, to } = sanitizeRange(bodyFrom, bodyTo);

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

  const scored = [];
  for (const fx of allFixtures) {
    const provider = fx._provider;
    try {
      const home = await fetchTeamForm(provider, fx.homeTeamId);
      const away = await fetchTeamForm(provider, fx.awayTeamId);
      const injuries = await fetchInjuries(provider, fx.fixtureId, fx.homeTeamId, fx.awayTeamId);
      const clean = { ...fx };
      delete clean._provider;
      scored.push({ ...scoreFixtureOver25(clean, home, away, injuries), provider: provider.name });
    } catch (e) {
      console.error(`${provider.name}: scoring failed:`, e.message);
    }
  }

  const top = scored
    .filter((s) => s.score >= 50)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return NextResponse.json({
    scannedAt: new Date().toISOString(),
    market: 'over25',
    dateRange: { from, to },
    leaguesScanned: selectedLeagues ?? 'all',
    totalFixtures: allFixtures.length,
    results: top,
  });
}
