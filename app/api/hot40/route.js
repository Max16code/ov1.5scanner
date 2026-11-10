import { NextResponse } from 'next/server';
import { getActiveProviders, LEAGUE_SELECTION } from '@/lib/provider-index';
import { computeTeamStats, scoreFixture } from '@/lib/scoring';
import { getCachedTeamForm, setCachedTeamForm, getCachedInjuries, setCachedInjuries } from '@/lib/cache';
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
        return computeTeamStats(merged, teamId);
      } catch (e) {
        console.error('BSD enrichment failed for', teamName, ':', e.message);
      }
    }
  }

  return computeTeamStats(baseMatches, teamId);
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

function isSameTeam(a, b) {
  if (!a || !b) return false;
  const n1 = normalizeTeamName(a);
  const n2 = normalizeTeamName(b);
  if (n1 === n2) return true;
  if (n1.length > 4 && n2.length > 4 && (n1.includes(n2) || n2.includes(n1))) return true;
  
  const ignore = ['club', 'fc', 'real', 'sporting', 'athletic', 'racing', 'deportivo', 'cadiz'];
  const getWords = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !ignore.includes(w));
  const w1 = getWords(a);
  const w2 = getWords(b);
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

  if (selectedLeagues && selectedLeagues.includes('hot40')) {
    selectedLeagues = null;
  }

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
      if (homeKey && bsdIndex.has(homeKey) === false) {
        bsdIndex.set(homeKey, { id: String(fx.homeTeamId).replace('bsd|', ''), name: fx.homeTeamName });
      }
      if (awayKey && bsdIndex.has(awayKey) === false) {
        bsdIndex.set(awayKey, { id: String(fx.awayTeamId).replace('bsd|', ''), name: fx.awayTeamName });
      }
    }
  }

  const formCache = new Map();
  const injuryCache = new Map();

  async function getTeamFormCached(provider, teamId, teamName) {
    const key = provider.name + '|' + teamId;
    if (formCache.has(key) === false) {
      formCache.set(key, fetchTeamForm(provider, teamId, teamName, bsdIndex));
    }
    return formCache.get(key);
  }

  async function getInjuriesCached(provider, fixtureId, homeId, awayId, homeName, awayName) {
    const key = provider.name + '|' + fixtureId;
    if (injuryCache.has(key) === false) {
      injuryCache.set(key, fetchInjuries(provider, fixtureId, homeId, awayId, homeName, awayName, bsdIndex));
    }
    return injuryCache.get(key);
  }

  const scored = [];
  const promises = allFixtures.map(async (fx) => {
    const provider = fx._provider;
    try {
      const [home, away, injuries] = await Promise.all([
        getTeamFormCached(provider, fx.homeTeamId, fx.homeTeamName),
        getTeamFormCached(provider, fx.awayTeamId, fx.awayTeamName),
        getInjuriesCached(provider, fx.fixtureId, fx.homeTeamId, fx.awayTeamId, fx.homeTeamName, fx.awayTeamName)
      ]);
      const clean = { ...fx };
      delete clean._provider;
      return { ...scoreFixture(clean, home, away, injuries), provider: provider.name };
    } catch (e) {
      console.error(provider.name + ': scoring failed:', e.message);
      return null;
    }
  });

  const results = await Promise.all(promises);
  for (const res of results) {
    if (res) scored.push(res);
  }

  const providerRank = { 'openfootball': 0, 'bzzoiro': 1, 'api-football': 2 };
  const sortedByProvider = scored.slice().sort((a, b) =>
    (providerRank[a.provider] ?? 99) - (providerRank[b.provider] ?? 99)
  );
  const deduped = finalDedup(sortedByProvider);

  const top = deduped
    .filter((s) => s.score >= 55)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40);

  try {
    const trackResult = await logPicks(top, 'over15');
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
