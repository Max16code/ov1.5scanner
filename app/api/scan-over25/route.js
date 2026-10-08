import { NextResponse } from 'next/server';
import { getActiveProviders, LEAGUE_SELECTION } from '@/lib/provider-index';
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
  const cached = getCachedTeamForm(provider.name, teamId);
  if (cached) return computeTeamStatsOver25(cached, teamId);
  const fresh = await provider.getTeamSeasonMatches(teamId);
  setCachedTeamForm(provider.name, teamId, fresh);
  return computeTeamStatsOver25(fresh, teamId);
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

function dedupeFixtures(scored) {
  const seen = new Map();
  const out = [];
  for (const s of scored) {
    const home = normalizeTeamName(s.homeTeamName);
    const away = normalizeTeamName(s.awayTeamName);
    const key = home + '|' + away;
    const existing = seen.get(key);
    if (existing) {
      // Prefer the BSD entry (has injury info) over openfootball
      if (s.provider === 'bzzoiro' && existing.provider !== 'bzzoiro') {
        const idx = out.indexOf(existing);
        out[idx] = s;
        seen.set(key, s);
      }
      continue;
    }
    seen.set(key, s);
    out.push(s);
  }
  return out;
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
  for (const fx of allFixtures) {
    const provider = fx._provider;
    try {
      const home = await fetchTeamForm(provider, fx.homeTeamId);
      const away = await fetchTeamForm(provider, fx.awayTeamId);
      const injuries = await fetchInjuries(provider, fx.fixtureId, fx.homeTeamId, fx.awayTeamId, fx.homeTeamName, fx.awayTeamName, bsdIndex);
      const clean = { ...fx };
      delete clean._provider;
      scored.push({ ...scoreFixtureOver25(clean, home, away, injuries), provider: provider.name });
    } catch (e) {
      console.error(`${provider.name}: scoring failed:`, e.message);
    }
  }

  // PREFER_OPENFOOTBALL: sort so openfootball is processed first.
  // The dedup keeps the first-seen entry, so openfootball wins for shared leagues.
  const providerRank = { 'openfootball': 0, 'bzzoiro': 1, 'api-football': 2 };
  const sortedByProvider = scored.slice().sort((a, b) =>
    (providerRank[a.provider] ?? 99) - (providerRank[b.provider] ?? 99)
  );
  const deduped = dedupeFixtures(sortedByProvider);

  const top = deduped
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
