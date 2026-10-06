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

  // Clamp to [today, today + 28 days]
  if (from < today) from = today;
  if (to > maxDate) to = maxDate;
  if (from > to) from = to;

  return { from: ymd(from), to: ymd(to) };
}

async function fetchTeamForm(provider, teamId) {
  if (typeof provider.getTeamStats === "function") {
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
  if (typeof provider.getTeamAvailability === "function") {
    const home = await provider.getTeamAvailability(homeId);
    const away = await provider.getTeamAvailability(awayId);
    return { homeKeyOut: home.weightedOut, awayKeyOut: away.weightedOut };
  }
  const cached = getCachedInjuries(provider.name, fixtureId);
  const list = cached ?? (await provider.getInjuries(fixtureId));
  if (cached === null) setCachedInjuries(provider.name, fixtureId, list);
  let homeKeyOut = 0;
  let awayKeyOut = 0;
  for (const inj of list) {
    const type = (inj.player?.type ?? "").toLowerCase();
    const reason = (inj.player?.reason ?? "").toLowerCase();
    const isAbsence = type.includes("missing") || reason.includes("injur") || reason.includes("suspension");
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

  const scored = [];
  for (const fx of allFixtures) {
    const provider = fx._provider;
    try {
      const home = await fetchTeamForm(provider, fx.homeTeamId);
      const away = await fetchTeamForm(provider, fx.awayTeamId);
      const injuries = await fetchInjuries(provider, fx.fixtureId, fx.homeTeamId, fx.awayTeamId);
      const clean = { ...fx };
      delete clean._provider;
      scored.push({ ...scoreFixture(clean, home, away, injuries), provider: provider.name });
    } catch (e) {
      console.error(`${provider.name}: scoring failed:`, e.message);
    }
  }

  const deduped = dedupeFixtures(scored);

  const top = deduped
    .filter((s) => s.score >= 55)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return NextResponse.json({
    scannedAt: new Date().toISOString(),
    dateRange: { from, to },
    leaguesScanned: selectedLeagues ?? 'all',
    totalFixtures: allFixtures.length,
    results: top,
  });
}
