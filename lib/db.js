import postgres from 'postgres';

let _sql = null;

export function getDb() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  _sql = postgres(url, { ssl: 'require', max: 3 });
  return _sql;
}

// THREE_SLOT_PER_DAY — only 3 scan slots accepted per day.
// AM: 00:00–11:59 · PM: 12:00–17:59 · EVE: 18:00–23:59
// Multiple scans inside the same window collapse to one slot (duplicates skipped).
function currentSlot() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const hour = now.getHours();
  const part = hour < 12 ? 'AM' : hour < 18 ? 'PM' : 'EVE';
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${part}`;
}

export async function logPicks(picks, market = 'over15') {

  if (!picks || picks.length === 0) return { inserted: 0, skipped: 0, slot: null };

  const slot = currentSlot();
  const db = getDb();
  let inserted = 0, skipped = 0;

  for (const p of picks) {
    try {
      const result = await db`
        INSERT INTO picks (
          fixture_id, home_team, away_team, league, kickoff,
          probability, market, scanned_slot
        )
        VALUES (
          ${p.fixtureId}, ${p.homeTeamName}, ${p.awayTeamName}, ${p.leagueName},
          ${p.kickoff}, ${p.score}, ${market}, ${slot}
        )
        ON CONFLICT (fixture_id, market, scanned_slot) DO NOTHING
        RETURNING id
      `;
      if (result.length > 0) inserted++;
      else skipped++;
    } catch (e) {
      console.error('logPicks insert failed:', e.message);
      skipped++;
    }
  }

  console.log('logPicks slot:', slot);
  return { inserted, skipped, slot };
}

export async function getPendingPicks() {
  const db = getDb();
  return db`
    SELECT id, fixture_id, home_team, away_team, league, kickoff, probability, market
    FROM picks
    WHERE outcome = 'pending' AND kickoff < NOW()
    ORDER BY kickoff ASC
    LIMIT 200
  `;
}

export async function resolvePick(id, outcome, finalScore) {
  const db = getDb();
  await db`
    UPDATE picks
    SET outcome = ${outcome},
        final_score = ${finalScore},
        resolved_at = NOW()
    WHERE id = ${id}
  `;
}
