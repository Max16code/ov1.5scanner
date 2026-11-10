'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function AdminDashboard() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/stats')
      .then(res => res.json())
      .then(d => {
        if (Array.isArray(d)) setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <main style={{ minHeight: '100vh', background: '#000', color: '#fff', padding: '2rem' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>Admin Dashboard</h1>
            <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Weekly performance by league</p>
          </div>
          <Link href="/" style={{ background: '#333', color: '#fff', padding: '0.5rem 1rem', borderRadius: '0.5rem', textDecoration: 'none', fontSize: '0.875rem' }}>
            ← Back to App
          </Link>
        </header>

        {loading ? (
          <p style={{ color: '#9ca3af' }}>Loading stats...</p>
        ) : data.length === 0 ? (
          <p style={{ color: '#9ca3af' }}>No resolved picks yet. Wait for matches to finish.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.875rem', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #333', color: '#9ca3af' }}>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Week Starting</th>
                  <th style={{ padding: '0.75rem 0.5rem' }}>League</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Picks</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Hits</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Misses</th>
                  <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Hit Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '0.75rem 0.5rem', color: '#9ca3af' }}>{row.week_start}</td>
                    <td style={{ padding: '0.75rem 0.5rem', fontWeight: 500 }}>{row.league}</td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>{row.total_picks}</td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', color: '#10b981' }}>{row.hits}</td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', color: '#ef4444' }}>{row.misses}</td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontWeight: 'bold' }}>{row.hit_rate}%</td>
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
