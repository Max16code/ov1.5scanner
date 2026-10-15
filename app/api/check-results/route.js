import { NextResponse } from 'next/server';
import { getPendingPicks, resolvePick } from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 60;

const HOST = 'https://sports.bzzoiro.com';

async function fetchEventResult(fixtureId) {
  // fixtureId format: 'bsd|215227'
  const clean = String(fixtureId).replace(/^bsd\|/, '');
  const res = await fetch(`${HOST}/api/v2/events/${clean}/`, {
    headers: { Authorization: `Token ${process.env.BZZOIRO_API_KEY}` },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`BSD ${res.status}`);
  const json = await res.json();
  return json;
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
      const event = await fetchEventResult(pick.fixture_id);
      const home = event.home_score;
      const away = event.away_score;

      if (home === null || away === null || event.status !== 'finished') {
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
