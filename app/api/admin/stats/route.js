import { NextResponse } from 'next/server';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });

export const runtime = 'nodejs';

export async function GET() {
  try {
    const stats = await sql`
      SELECT 
        league,
        TO_CHAR(DATE_TRUNC('week', resolved_at), 'YYYY-MM-DD') AS week_start,
        COUNT(*) AS count,
        COUNT(*) FILTER (WHERE outcome = 'hit') AS hits,
        COUNT(*) FILTER (WHERE outcome = 'miss') AS misses,
        ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'hit') / NULLIF(COUNT(*) FILTER (WHERE outcome IN ('hit','miss')), 0), 1) AS hit_rate
      FROM picks
      WHERE outcome IN ('hit', 'miss')
      GROUP BY league, week_start
      ORDER BY week_start DESC, hit_rate DESC
    `;
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Admin stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
