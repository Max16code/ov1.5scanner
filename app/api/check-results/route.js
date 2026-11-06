import { NextResponse } from 'next/server';
import { getPendingPicks, resolvePick } from '@/lib/db';
import { normalizeTeamName } from '@/lib/team-matcher';
import { LEAGUE_MAP } from '@/lib/providers/bzzoiro';

export const runtime = 'nodejs';
export const maxDuration = 60;

const HOST = 'https://sports.bzzoiro.com';

async function fetchEventResult(fixtureId, homeTeam, awayTeam, kickoffDate) {
  let cleanId = String(fixtureId);
  let isOpenFootball = false;
  let leagueCode = null;

  if (cleanId.startsWith('of|')) {
    isOpenFootball = true;
    const parts = cleanId.split('|');
    leagueCode = parts[1];
  } else {
    cleanId = cleanId.replace(/^bsd\|/, '');
  }

  if (!isOpenFootball) {
    try {
      const res = await fetch(`${HOST}/api/v2/events/${cleanId}/`, {
        headers: { Authorization: `Token ${process.env.BZZOIRO_API_KEY}` },
        next: { revalidate: 0 },
      });
      if (res.ok) {
        const json = await res.json();
        if (json.status === 'finished') return json;
      }
    } catch (e) {
      console.error('Direct fetch failed:', e.message);
    }
  }

  // Search a 3-day window to account for timezone shifts
  const prevDateStr = new Date(kickoffDate.getTime() - 864e5).toISOString().slice(0, 10);
  const nextDateStr = new Date(kickoffDate.getTime() + 864e5).toISOString().slice(0, 10);
  const bsdLeagueId = LEAGUE_MAP[leagueCode];

  let url = `${HOST}/api/v2/events/?date_from=${prevDateStr}&date_to=${nextDateStr}&limit=300`;
  if (bsdLeagueId) {
    url += `&league_id=${bsdLeagueId}`;
  }

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Token ${process.env.BZZOIRO_API_KEY}` },
      next: { revalidate: 0 },
    });

    if (res.ok) {
      const json = await res.json();
      const events = json.results || [];
      
      const normHome = normalizeTeamName(homeTeam);
      const normAway = normalizeTeamName(awayTeam);
      
      const match = events.find(e => {
        const eHome = normalizeTeamName(e.home_team);
        const eAway = normalizeTeamName(e.away_team);
        const homeMatch = eHome.includes(normHome) || normHome.includes(eHome);
        const awayMatch = eAway.includes(normAway) || normAway.includes(eAway);
        return homeMatch && awayMatch;
      });

      if (match) return match;
    }
  } catch (e) {
    console.error('Fallback fetch failed:', e.message);
  }

  return null;
}

export async function GET(request) {
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pending = await getPendingPicks();
  let resolved = 0, pendingStill = 0, errors = 0;

  for (const pick of pending) {
    try {
      const event = await fetchEventResult(pick.fixture_id, pick.home_team, pick.away_team, pick.kickoff);
      
      if (!event || event.home_score === null || event.away_score === null || event.status !== 'finished') {
        pendingStill++;
        continue;
      }

      const total = event.home_score + event.away_score;
      const outcome = total >= 2 ? 'hit' : 'miss';
      await resolvePick(pick.id, outcome, `${event.home_score}-${event.away_score}`);
      resolved++;
    } catch (e) {
      console.error('Error processing pick:', e.message);
      errors++;
    }
  }

  return NextResponse.json({
    ok: true,
    checked: pending.length,
    resolved,
    pendingStill,
    errors,
  });
}
