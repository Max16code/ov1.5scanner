import { NextResponse } from 'next/server';
import { getActiveProviders, LEAGUE_SELECTION } from '@/lib/provider-index';
import { computeTeamStats, scoreFixture } from '@/lib/scoring';
import {
  getCachedTeamForm,
  setCachedTeamForm,
  getCachedInjuries,
  setCachedInjuries,
} from '@/lib/cache';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function fetchTeamForm(provider, teamId) {
  const cached = getCachedTeamForm(provider.name, teamId);
  if (cached) return computeTeamStats(cached, teamId);
  const fresh = await provider.getTeamSeasonMatches(teamId);
  setCachedTeamForm(provider.name, teamId, fresh);
  return computeTeamStats(fresh, teamId);
}

async function fetchInjuries(provider, fixtureId, homeId, awayId) {
  const cached = getCachedInjuries(provider.name, fixtureId);
  const list = cached ?? (await provider.getInjuries(fixtureId));
  if (!cached) setCachedInjuries(provider.name, fixtureId, list);
  let homeKeyOut = 0;
  let awayKeyOut = 0;
  for (const inj of list) {
    const type = (inj.player?.type ?? '').toLowerCase();
    const reason = (inj.player?.reason ?? '').toLowerCase();
    const isAbsence =
      type.includes('missing') ||
      reason.includes('injur') ||
      reason.includes('suspension');
    if (!isAbsence) continue;
    if (inj.team?.id === homeId) homeKeyOut++;
    else if (inj.team?.id === awayId) awayKeyOut++;
  }
  return { homeKeyOut, awayKeyOut };
}

export async function POST(request) {
  let selectedLeagues = null;
  try {
    const body = await request.json();
    if (Array.isArray(body?.leagues) && body.leagues.length > 0) {
      selectedLeagues = body.leagues;
    }
  } catch {
    // no body, scan everything
  }

  const providers = getActiveProviders();
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10);

  const allFixtures = [];

  for (const provider of providers) {
    let leagueIds = LEAGUE_SELECTION[provider.name] || [];

    if (selectedLeagues) {
      leagueIds = leagueIds.filter((id) => selectedLeagues.includes(id));
    }

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
      const injuries = await fetchInjuries(
        provider,
        fx.fixtureId,
        fx.homeTeamId,
        fx.awayTeamId
      );
      const clean = { ...fx };
      delete clean._provider;
      scored.push({
        ...scoreFixture(clean, home, away, injuries),
        provider: provider.name,
      });
    } catch (e) {
      console.error(
        `${provider.name}: scoring ${fx.homeTeamName} vs ${fx.awayTeamName} failed:`,
        e.message
      );
    }
  }

  const top = scored
    .filter((s) => s.score >= 55)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return NextResponse.json({
    scannedAt: new Date().toISOString(),
    providersUsed: providers.map((p) => p.name),
    leaguesScanned: selectedLeagues ?? 'all',
    totalFixtures: allFixtures.length,
    results: top,
  });
}
