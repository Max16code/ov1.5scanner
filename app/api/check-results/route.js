import { NextResponse } from 'next/server';
import { getPendingPicks, resolvePick } from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 60;

const HOST = 'https://sports.bzzoiro.com';

async function fetchEventResult(fixtureId, homeTeam, awayTeam, kickoffDate) {
  let cleanId = String(fixtureId);
  let isOpenFootball = false;

  if (cleanId.startsWith('of|')) {
    isOpenFootball = true;
  } else {
    cleanId = cleanId.replace(/^bsd\|/, '');
  }

  // Direct BSD lookup
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
    } catch (e) {}
  }

  // Fallback for OpenFootball IDs: search BSD by date and team names
  const dateStr = kickoffDate.toISOString().slice(0, 10);
  try {
    const res = await fetch(`${HOST}/api/v2/events/?date_from=${dateStr}&date_to=${dateStr}&limit=200`, {
      headers: { Authorization: `Token ${process.env.BZZOIRO_API_KEY}` },
      next: { revalidate: 0 },
    });
    if (res.ok) {
      const json = await res.json();
      const events = json.results || [];
      const match = events.find(e => 
        (e.home_team.includes(homeTeam.split(' ')[0]) || homeTeam.includes(e.home_team.split(' ')[0])) &&
        (e.away_team.includes(awayTeam.split(' ')[0]) || awayTeam.includes(e.away_team.split(' ')[0]))
      );
      if (match && match.status === 'finished') return match;
    }
  } catch (e) {}

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
      const home = event.home_score;
      const away = event.away_score;

      if (!event || home === null || away === null || event.status !== 'finished') {
        pendingStill++;
        continue;
      }

      const total = home + away;
      const outcome = total >= 2 ? 'hit' : 'miss';
      await resolvePick(pick.id, outcome, `${home}-${away}`);
      resolved++;
    } catch (e) {
      console.error(`check-results failed for pick ${pick.id}:`, e.message);
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
