import { getActiveProviders, LEAGUE_SELECTION } from './provider-index';
import { computeTeamStats, scoreFixture } from './scoring';
import { getCachedTeamForm, setCachedTeamForm, getCachedInjuries, setCachedInjuries } from './cache';

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
  return String(name).toLowerCase()
    .replace(/\b(fc|afc|sc|ac|cf|united|utd|city|town)\b/g, '')
    .replace(/[^a-z0-9]/g, '').trim();
}

export async function runHot40Scan({ from, to, limit = 40 } = {}) {
  const range = sanitizeRange(from, to);
  const providers = getActiveProviders();

  const allFixtures = [];
  for (const provider of providers) {
    const leagueIds = LEAGUE_SELECTION[provider.name] || [];
    if (leagueIds.length === 0) continue;
    try {
      const fixtures = await provider.getFixtures({ leagueIds, from: range.from, to: range.to });
      allFixtures.push(...fixtures.map((f) => ({ ...f, _provider: provider })));
    } catch (e) {
      console.error(`${provider.name}: getFixtures failed:`, e.message);
    }
  }

  const seen = new Set();
  const uniqueFixtures = [];
  for (const fx of allFixtures) {
    const key = normalizeTeamName(fx.homeTeamName) + '|' + normalizeTeamName(fx.awayTeamName);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueFixtures.push(fx);
  }

  const scored = [];
  for (const fx of uniqueFixtures) {
    const provider = fx._provider;
    try {
      const home = await fetchTeamForm(provider, fx.homeTeamId);
      const away = await fetchTeamForm(provider, fx.awayTeamId);
      const injuries = await fetchInjuries(provider, fx.fixtureId, fx.homeTeamId, fx.awayTeamId);
      const clean = { ...fx };
      delete clean._provider;
      scored.push({
        ...scoreFixture(clean, home, away, injuries),
        provider: provider.name,
      });
    } catch (e) {
      console.error(`${provider.name}: scoring failed:`, e.message);
    }
  }

  return scored
    .filter((x) => x.score >= 55)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function formatHot40AsHtml(picks, scanDate) {
  const rows = picks.map((p, i) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;color:#666;">${i + 1}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">
        <strong>${p.homeTeamName}</strong> vs <strong>${p.awayTeamName}</strong><br>
        <span style="color:#888;font-size:12px;">${p.leagueName} · ${new Date(p.kickoff).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
      </td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;color:#10b981;">${p.score}%</td>
    </tr>
  `).join('');

  return `
    <div style="font-family:-apple-system,sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#fff;">
      <h1 style="font-size:22px;margin:0 0 4px;">🔥 HOT40 — Over 1.5 Picks</h1>
      <p style="color:#888;font-size:13px;margin:0 0 20px;">Scanned ${scanDate} · Top 40 fixtures by probability</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px;color:#666;font-weight:500;border-bottom:2px solid #eee;">#</th>
            <th style="text-align:left;padding:8px;color:#666;font-weight:500;border-bottom:2px solid #eee;">Match</th>
            <th style="text-align:right;padding:8px;color:#666;font-weight:500;border-bottom:2px solid #eee;">O1.5 %</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#aaa;font-size:12px;margin-top:24px;">Best time to use the model is within 24 hours of kickoff. Injury data is a live snapshot.</p>
    </div>
  `;
}
