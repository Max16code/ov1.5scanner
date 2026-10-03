'use client';

import { useState } from 'react';

const LEAGUES = [
  { key: 'eng-pl',      label: 'Premier League' },
  { key: 'eng-champ',   label: 'Championship' },
  { key: 'ita-serie-a', label: 'Serie A' },
  { key: 'esp-liga',    label: 'La Liga' },
];

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  async function runScan(leagues) {
    setLoading(true);
    setActive(leagues ? leagues.join(',') : 'all');
    setError(null);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagues }),
      });
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setActive(null);
    }
  }

  return (
    <main className="max-w-6xl mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Over 1.5 Scanner</h1>
        {data && (
          <p className="text-sm text-gray-500">
            Scanned {data.totalFixtures} fixtures ·{' '}
            {new Date(data.scannedAt).toLocaleTimeString()} ·{' '}
            {Array.isArray(data.leaguesScanned)
              ? data.leaguesScanned.join(', ')
              : 'all leagues'}
          </p>
        )}
      </header>

      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => runScan(null)}
          disabled={loading}
          className="px-4 py-2 bg-black text-white rounded-lg font-semibold disabled:opacity-50"
        >
          {loading && active === 'all' ? 'Scanning…' : '▶ SCAN ALL'}
        </button>

        {LEAGUES.map((lg) => (
          <button
            key={lg.key}
            onClick={() => runScan([lg.key])}
            disabled={loading}
            className="px-4 py-2 bg-gray-800 text-white rounded-lg font-medium disabled:opacity-50 hover:bg-gray-700"
          >
            {loading && active === lg.key ? 'Scanning…' : lg.label}
          </button>
        ))}
      </div>

      {error && <div className="p-4 bg-red-50 text-red-700 rounded mb-4">{error}</div>}

      {data && data.results.length === 0 && (
        <p className="text-gray-500">No fixtures met the threshold.</p>
      )}

      {data && data.results.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left border-b">
              <tr>
                <th className="py-2">#</th>
                <th>Match</th>
                <th>League</th>
                <th>Date</th>
                <th className="text-right">Over 1.5 %</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r, i) => (
                <tr key={r.fixtureId} className="border-b hover:bg-gray-50">
                  <td className="py-2">{i + 1}</td>
                  <td className="font-medium">{r.homeTeamName} vs {r.awayTeamName}</td>
                  <td className="text-gray-500">{r.leagueName}</td>
                  <td className="text-gray-500">
                    {new Date(r.kickoff).toLocaleDateString()}
                  </td>
                  <td className="text-right font-bold">{r.score}%</td>
                  <td className="text-xs text-gray-600">{r.reasons.join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}