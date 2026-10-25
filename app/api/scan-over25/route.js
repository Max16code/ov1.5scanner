import { NextResponse } from 'next/server';
import { getActiveProviders, LEAGUE_SELECTION } from '@/lib/provider-index';
import { computeTeamStatsOver25, scoreFixtureOver25 } from '@/lib/scoring-over25';
import {
  getCachedTeamForm,
  setCachedTeamForm,
  getCachedInjuries,
  setCachedInjuries,
} from '@/lib/cache';
import { findBsdTeamId, mergeMatchHistory, normalizeTeamName } from '@/lib/team-matcher';
import * as bzzoiroModule from '@/lib/providers/bzzoiro';
import { logPicks } from '@/lib/db';

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

async function fetchTeamForm(provider, teamId, teamName, bsdIndex) {
  if (typeof provider.getTeamStats === 'function') {
    const stats = await provider.getTeamStats(teamId);
    if (stats) return stats;
  }

  const cached = getCachedTeamForm(provider.name, teamId);
  let baseMatches;
  if (cached) {
    baseMatches = cached;
  } else {
    baseMatches = await provider.getTeamSeasonMatches(teamId);
    setCachedTeamForm(provider.name, teamId, baseMatches);
  }

  if (bsdIndex && teamName && typeof bzzoiroModule.getRecentMatches === 'function') {
    const bsdTeam = findBsdTeamId(teamName, bsdIndex);
    if (bsdTeam) {
      try {
        const recent = await bzzoiroModule.getRecentMatches(bsdTeam.id, 60);
        const merged = mergeMatchHistory(baseMatches, recent);
        return computeTeamStatsOver25(merged, teamId);
      } catch (e) {
        console.error('BSD enrichment failed for', teamName, ':', e.message);
      }
    }
  }

  return computeTeamStatsOver25(baseMatches, teamId);
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

function finalDedup(scored) {
  const providerRank = { 'openfootball': 0, 'bzzoiro': 1, 'api-football': 2 };
  const seen = new Map();
  for (const item of scored) {
    const key = normalizeTeamName(item.homeTeamName) + '|' + normalizeTeamName(item.awayTeamName);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, item);
      continue;
    }
    const existingRank = providerRank[existing.provider] ?? 99;
    const newRank = providerRank[item.provider] ?? 99;
    if (newRank < existingRank) {
      seen.set(key, item);
    }
  }
  return Array.from(seen.values());
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
      console.error(provider.name + ': getFixtures failed:', e.message);
    }
  }

  let bsdIndex = new Map();
  for (const fx of allFixtures) {
    if (fx._provider.name === 'bzzoiro') {
      const homeKey = normalizeTeamName(fx.homeTeamName);
      const awayKey = normalizeTeamName(fx.awayTeamName);
      if (homeKey && !bsdIndex.has(homeKey)) {
        bsdIndex.set(homeKey, { id: String(fx.homeTeamId).replace('bsd|', ''), name: fx.homeTeamName });
      }
      if (awayKey && !bsdIndex.has(awayKey)) {
        bsdIndex.set(awayKey, { id: String(fx.awayTeamId).replace('bsd|', ''), name: fx.awayTeamName });
      }
    }
  }
  console.log('bsdIndex built from fixtures with', bsdIndex.size, 'teams');

  const scored = [];

  for (const fx of allFixtures) {
    const provider = fx._provider;
    try {
      const home = await fetchTeamForm(provider, fx.homeTeamId, fx.homeTeamName, bsdIndex);
      const away = await fetchTeamForm(provider, fx.awayTeamId, fx.awayTeamName, bsdIndex);
      const injuries = await fetchInjuries(provider, fx.fixtureId, fx.homeTeamId, fx.awayTeamId, fx.homeTeamName, fx.awayTeamName, bsdIndex);
      const clean = { ...fx };
      delete clean._provider;
      const scoredResult = scoreFixtureOver25(clean, home, away, injuries);
      scored.push({ ...scoredResult, provider: provider.name });
    } catch (e) {
      console.error(provider.name + ': scoring failed:', e.message);
    }
  }

  const providerRank = { 'openfootball': 0, 'bzzoiro': 1, 'api-football': 2 };
  const sortedByProvider = scored.slice().sort((a, b) =>
    (providerRank[a.provider] ?? 99) - (providerRank[b.provider] ?? 99)
  );
  const deduped = finalDedup(sortedByProvider);

  const top = deduped
    .filter((s) => s.score >= 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  try {
    const trackResult = await logPicks(top, 'over25');
    console.log('scan tracked:', trackResult.inserted, 'inserted,', trackResult.skipped, 'skipped');
  } catch (e) {
    console.error('scan tracking failed:', e.message);
  }

  return NextResponse.json({
    scannedAt: new Date().toISOString(),
    dateRange: { from, to },
    leaguesScanned: selectedLeagues ?? 'all',
    totalFixtures: allFixtures.length,
    results: top,
  });
}
