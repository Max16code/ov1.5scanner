'use client';

import { useState } from 'react';

const LEAGUES = [
  { key: 'eng-pl', label: 'Premier League', imgSrc: '/logos/pl.svg', bg: 'linear-gradient(135deg, rgba(168,85,247,0.65), rgba(88,28,135,0.55))', border: 'rgba(216,180,254,0.5)', shadow: '0 4px 24px rgba(168,85,247,0.35)', text: '#fff' },
  { key: 'eng-champ', label: 'Championship', imgSrc: '/logos/champ.webp', bg: 'linear-gradient(135deg, rgba(212,175,55,0.75), rgba(133,100,20,0.6))', border: 'rgba(212,175,55,0.6)', shadow: '0 4px 24px rgba(212,175,55,0.4)', text: '#fff' },
  { key: 'ita-serie-a', label: 'Serie A', imgSrc: '/logos/seriea.webp', bg: 'linear-gradient(135deg, rgba(59,130,246,0.65), rgba(30,64,175,0.55))', border: 'rgba(147,197,253,0.5)', shadow: '0 4px 24px rgba(59,130,246,0.35)', text: '#fff' },
  { key: 'esp-liga', label: 'La Liga', imgSrc: '/logos/laliga.webp', bg: 'linear-gradient(135deg, rgba(255,75,68,0.75), rgba(127,29,29,0.6))', border: 'rgba(255,75,68,0.6)', shadow: '0 4px 24px rgba(255,75,68,0.4)', text: '#fff' },
  { key: 'de-1', label: 'Bundesliga', imgSrc: '/logos/bundesliga.svg', bg: 'linear-gradient(135deg, rgba(210,5,21,0.75), rgba(142,9,2,0.6))', border: 'rgba(210,5,21,0.6)', shadow: '0 4px 24px rgba(210,5,21,0.4)', text: '#fff' },
  { key: 'ucl', label: 'Champions League', imgSrc: '/logos/ucl.png', bg: 'linear-gradient(135deg, rgba(14,30,91,0.8), rgba(5,15,45,0.7))', border: 'rgba(120,160,255,0.5)', shadow: '0 4px 24px rgba(14,30,91,0.5)', text: '#fff' },
  { key: 'nl-eredivisie', label: 'Eredivisie', imgSrc: '/logos/eredivisie.png', bg: 'linear-gradient(135deg, rgba(255,107,0,0.75), rgba(180,60,0,0.6))', border: 'rgba(255,140,60,0.6)', shadow: '0 4px 24px rgba(255,107,0,0.4)', text: '#fff' },
  { key: 'pt-primeira', label: 'Primeira Liga', imgSrc: '/logos/primeira.webp', bg: 'linear-gradient(135deg, rgba(209,10,17,0.75), rgba(120,5,10,0.6))', border: 'rgba(209,10,17,0.6)', shadow: '0 4px 24px rgba(209,10,17,0.4)', text: '#fff' },
];

const MAX_DAYS = 28;

function ymd(date) {
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function todayStr() {
  return ymd(new Date());
}

function maxDateStr() {
  const d = new Date();
  d.setDate(d.getDate() + MAX_DAYS);
  return ymd(d);
}

function Spinner() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: '28px',
        height: '28px',
        border: '3px solid rgba(255,255,255,0.15)',
        borderTopColor: 'rgba(255,255,255,0.9)',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }}
    />
  );
}

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [market, setMarket] = useState('over15');
  const [fromDate, setFromDate] = useState(todayStr());
  const [toDate, setToDate] = useState(maxDateStr());

  async function runScan(leagues, selectedMarket = market) {
    setLoading(true);
    setActive(leagues ? leagues.join(',') : 'all');
    setError(null);
    try {
      const endpoint = selectedMarket === 'over25' ? '/api/scan-over25' : '/api/scan';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagues, from: fromDate, to: toDate }),
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

  function switchMarket(newMarket) {
    if (newMarket === market) return;
    setMarket(newMarket);
    if (data) runScan(null, newMarket);
  }

  function onFromChange(value) {
    setFromDate(value);
    if (value > toDate) setToDate(value);
  }

  function onToChange(value) {
    setToDate(value);
    if (value < fromDate) setFromDate(value);
  }

  function resetRange() {
    setFromDate(todayStr());
    setToDate(maxDateStr());
  }

  const isOver15 = market === 'over15';
  const label = isOver15 ? '1.5' : '2.5';

  return (
    <main style={{ minHeight: '100vh', background: '#000', color: '#fff', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'fixed', inset: 0, zIndex: -10, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '-10%', left: '-10%', width: '40rem', height: '40rem', borderRadius: '9999px', background: 'rgba(16,185,129,0.1)', filter: 'blur(120px)' }} />
        <div style={{ position: 'absolute', top: '20%', right: '-15%', width: '35rem', height: '35rem', borderRadius: '9999px', background: 'rgba(168,85,247,0.1)', filter: 'blur(120px)' }} />
        <div style={{ position: 'absolute', bottom: '-10%', left: '20%', width: '40rem', height: '40rem', borderRadius: '9999px', background: 'rgba(59,130,246,0.1)', filter: 'blur(120px)' }} />
      </div>

      <div style={{ maxWidth: '72rem', margin: '0 auto', padding: '1rem', position: 'relative' }}>
        <header style={{ marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>Over {label} Scanner</h1>
          {data && (
            <p style={{ fontSize: '0.875rem', color: '#9ca3af', marginTop: '0.125rem' }}>
              {data.totalFixtures} fixtures · {new Date(data.scannedAt).toLocaleTimeString()}
              {data.dateRange && ` · ${data.dateRange.from} → ${data.dateRange.to}`}
            </p>
          )}
        </header>

        <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '9999px', padding: '0.25rem', marginBottom: '1.25rem' }}>
          <button onClick={() => switchMarket('over15')} disabled={loading} style={{ padding: '0.375rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, borderRadius: '9999px', border: 'none', cursor: 'pointer', background: isOver15 ? 'linear-gradient(135deg, rgba(16,185,129,0.95), rgba(5,150,105,0.85))' : 'transparent', color: isOver15 ? '#fff' : '#9ca3af', boxShadow: isOver15 ? '0 4px 24px rgba(16,185,129,0.5)' : 'none' }}>
            Over 1.5
          </button>
          <button onClick={() => switchMarket('over25')} disabled={loading} style={{ padding: '0.375rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, borderRadius: '9999px', border: 'none', cursor: 'pointer', background: !isOver15 ? 'linear-gradient(135deg, rgba(249,115,22,0.95), rgba(220,38,38,0.85))' : 'transparent', color: !isOver15 ? '#fff' : '#9ca3af', boxShadow: !isOver15 ? '0 4px 24px rgba(249,115,22,0.5)' : 'none' }}>
            Over 2.5
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '9999px', padding: '0.375rem 0.5rem 0.375rem 1rem' }}>
            <span style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 500 }}>From</span>
            <input type="date" value={fromDate} min={todayStr()} max={maxDateStr()} onChange={(e) => onFromChange(e.target.value)} style={{ background: 'transparent', color: '#fff', border: 'none', outline: 'none', fontSize: '0.875rem', colorScheme: 'dark' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '9999px', padding: '0.375rem 0.5rem 0.375rem 1rem' }}>
            <span style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 500 }}>To</span>
            <input type="date" value={toDate} min={fromDate || todayStr()} max={maxDateStr()} onChange={(e) => onToChange(e.target.value)} style={{ background: 'transparent', color: '#fff', border: 'none', outline: 'none', fontSize: '0.875rem', colorScheme: 'dark' }} />
          </div>
          <button onClick={resetRange} disabled={loading} style={{ padding: '0.375rem 0.875rem', fontSize: '0.75rem', fontWeight: 500, borderRadius: '9999px', background: 'transparent', color: '#9ca3af', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}>
            Reset
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <button onClick={() => runScan(null)} disabled={loading} style={{ padding: '0.625rem 1.5rem', borderRadius: '9999px', fontSize: '0.875rem', fontWeight: 600, color: '#fff', border: '1px solid rgba(110,231,183,0.5)', cursor: 'pointer', background: 'linear-gradient(135deg, rgba(16,185,129,0.75), rgba(4,120,87,0.6))', boxShadow: '0 4px 24px rgba(16,185,129,0.35)' }}>
            {loading && active === 'all' ? 'Scanning…' : '▶ SCAN ALL'}
          </button>

          {LEAGUES.map((lg) => (
            <button
              key={lg.key}
              onClick={() => runScan([lg.key])}
              disabled={loading}
              style={{
                padding: '0.5rem 1.25rem 0.5rem 0.75rem',
                borderRadius: '9999px',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: lg.text,
                border: '1px solid ' + lg.border,
                cursor: loading ? 'not-allowed' : 'pointer',
                background: lg.bg,
                boxShadow: lg.shadow,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                lineHeight: 1,
              }}
            >
              <img
                src={lg.imgSrc}
                alt=""
                style={{
                  width: '22px',
                  height: '22px',
                  objectFit: 'contain',
                  background: 'rgba(255,255,255,0.92)',
                  borderRadius: '5px',
                  padding: '2px',
                  flexShrink: 0,
                }}
              />
              {loading && active === lg.key ? 'Scanning…' : lg.label}
            </button>
          ))}
        </div>

        {error && (
          <div style={{ padding: '1rem', background: 'rgba(127,29,29,0.5)', border: '1px solid rgba(127,29,29,0.5)', color: '#fca5a5', borderRadius: '1rem', marginBottom: '1rem', fontSize: '0.875rem' }}>{error}</div>
        )}

        {loading && (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 1rem', gap: '1rem' }}>
    <Spinner />
    <p style={{ color: '#9ca3af', fontSize: '0.875rem', fontWeight: 500 }}>Computing…</p>
    <p style={{ color: '#4b5563', fontSize: '0.75rem' }}>Analysing fixtures, form and expected goals</p>
  </div>
)}

{!loading && data && data.results.length === 0 && (
          <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>No fixtures met the threshold in this date range.</p>
        )}

        {!loading && data && data.results.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.875rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left' }}>
                  <th style={{ padding: '0.5rem', color: '#6b7280', fontWeight: 500, width: '2rem' }}>#</th>
                  <th style={{ padding: '0.5rem', color: '#6b7280', fontWeight: 500 }}>Match</th>
                  <th style={{ padding: '0.5rem', color: '#6b7280', fontWeight: 500 }}>League</th>
                  <th style={{ padding: '0.5rem', color: '#6b7280', fontWeight: 500 }}>Date</th>
                  <th style={{ padding: '0.5rem', color: '#6b7280', fontWeight: 500, textAlign: 'right' }}>{label} %</th>
                  <th style={{ padding: '0.5rem', color: '#6b7280', fontWeight: 500 }}>Why</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((r, i) => (
                  <tr key={r.fixtureId} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.75rem 0.5rem', color: '#6b7280', fontSize: '0.75rem' }}>{i + 1}</td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <div style={{ fontWeight: 500 }}>{r.homeTeamName}</div>
                      <div style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '0.125rem' }}>vs {r.awayTeamName}</div>
                      <div style={{ color: '#6b7280', fontSize: '0.6875rem', marginTop: '0.25rem' }}>{r.leagueName} · {new Date(r.kickoff).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', color: '#9ca3af' }}>{r.leagueName}</td>
                    <td style={{ padding: '0.75rem 0.5rem', color: '#9ca3af', whiteSpace: 'nowrap' }}>{new Date(r.kickoff).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}><span style={{ fontWeight: 'bold' }}>{r.score}%</span></td>
                    <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.75rem', color: '#9ca3af' }}>{r.reasons.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}