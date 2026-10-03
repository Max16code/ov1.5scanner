let db = null;
let initialized = false;

function tryInitDB() {
  if (initialized) return db;
  initialized = true;

  try {
    // Use require() so Next.js doesn't try to bundle better-sqlite3 at build time
    const Database = eval('require')('better-sqlite3');
    const path = eval('require')('path');

    db = new Database(path.join(process.cwd(), 'cache.db'));
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS team_form (
        provider TEXT NOT NULL,
        team_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (provider, team_id)
      );
      CREATE TABLE IF NOT EXISTS fixture_injuries (
        provider TEXT NOT NULL,
        fixture_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (provider, fixture_id)
      );
    `);
    console.log('cache: SQLite initialized');
  } catch (e) {
    console.warn('cache: SQLite unavailable, running without cache');
    db = false;
  }

  return db;
}

const DAY = 864e5;

export function getCachedTeamForm(provider, teamId) {
  const d = tryInitDB();
  if (!d) return null;
  try {
    const row = d.prepare('SELECT payload, fetched_at FROM team_form WHERE provider = ? AND team_id = ?').get(provider, String(teamId));
    if (!row || Date.now() - row.fetched_at > DAY) return null;
    return JSON.parse(row.payload);
  } catch (e) {
    return null;
  }
}

export function setCachedTeamForm(provider, teamId, data) {
  const d = tryInitDB();
  if (!d) return;
  try {
    d.prepare('INSERT OR REPLACE INTO team_form (provider, team_id, payload, fetched_at) VALUES (?, ?, ?, ?)')
      .run(provider, String(teamId), JSON.stringify(data), Date.now());
  } catch (e) {}
}

export function getCachedInjuries(provider, fixtureId) {
  const d = tryInitDB();
  if (!d) return null;
  try {
    const row = d.prepare('SELECT payload, fetched_at FROM fixture_injuries WHERE provider = ? AND fixture_id = ?').get(provider, String(fixtureId));
    if (!row || Date.now() - row.fetched_at > DAY / 4) return null;
    return JSON.parse(row.payload);
  } catch (e) {
    return null;
  }
}

export function setCachedInjuries(provider, fixtureId, data) {
  const d = tryInitDB();
  if (!d) return;
  try {
    d.prepare('INSERT OR REPLACE INTO fixture_injuries (provider, fixture_id, payload, fetched_at) VALUES (?, ?, ?, ?)')
      .run(provider, String(fixtureId), JSON.stringify(data), Date.now());
  } catch (e) {}
}
