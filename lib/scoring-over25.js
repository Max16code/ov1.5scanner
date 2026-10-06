// Over 2.5 goals scoring — separate module, does not touch Over 1.5 logic.
//
// Approach: Dixon-Coles style adjustment on top of Poisson.
// Key differences from Over 1.5:
//   1. Targets the tail of the goal distribution (3+ goals), so accuracy is inherently lower.
//   2. Applies a low-score correction for 0-0, 1-0, 0-1, 1-1 outcomes.
//   3. Uses league-specific Over 2.5 baselines.

// Compute per-team stats from match history.
// Each match is { goalsFor, goalsAgainst }.
export function computeTeamStatsOver25(matches, teamId) {
  const played = matches.length;
  if (played === 0) {
    return {
      teamId, matchesPlayed: 0,
      avgFor: 0, avgAgainst: 0,
      over25Rate: 0, bttsRate: 0, last5Over25Rate: 0,
    };
  }

  let goalsFor = 0, goalsAgainst = 0;
  let over25Count = 0, bttsCount = 0;

  for (const m of matches) {
    const f = m.goalsFor ?? 0;
    const a = m.goalsAgainst ?? 0;
    goalsFor += f;
    goalsAgainst += a;
    if (f + a >= 3) over25Count++;
    if (f >= 1 && a >= 1) bttsCount++;
  }

  const last5 = matches.slice(-5);
  const last5Over = last5.filter((m) => (m.goalsFor ?? 0) + (m.goalsAgainst ?? 0) >= 3).length;

  return {
    teamId, matchesPlayed: played,
    avgFor: goalsFor / played,
    avgAgainst: goalsAgainst / played,
    over25Rate: over25Count / played,
    bttsRate: bttsCount / played,
    last5Over25Rate: last5.length ? last5Over / last5.length : 0,
  };
}

// League-specific Over 2.5 baselines.
// homeGoals / awayGoals are average goals per game by venue.
// Values reflect recent 2024/25 style numbers.
const LEAGUE_BASELINE_25 = {
  'eng-pl':      { homeGoals: 1.62, awayGoals: 1.35, over25Base: 0.57 },
  'eng-champ':   { homeGoals: 1.40, awayGoals: 1.15, over25Base: 0.48 },
  'ita-serie-a': { homeGoals: 1.55, awayGoals: 1.25, over25Base: 0.54 },
  'esp-liga':    { homeGoals: 1.42, awayGoals: 1.15, over25Base: 0.47 },
  'de.1':        { homeGoals: 1.75, awayGoals: 1.45, over25Base: 0.62 },
  'fr.1':        { homeGoals: 1.55, awayGoals: 1.25, over25Base: 0.54 },
  'nl.1':        { homeGoals: 1.78, awayGoals: 1.40, over25Base: 0.60 },
  'pt.1':        { homeGoals: 1.40, awayGoals: 1.15, over25Base: 0.48 },
  // api-football numeric IDs
  39:  { homeGoals: 1.62, awayGoals: 1.35, over25Base: 0.57 },
  40:  { homeGoals: 1.40, awayGoals: 1.15, over25Base: 0.48 },
  41:  { homeGoals: 1.35, awayGoals: 1.10, over25Base: 0.45 },
  42:  { homeGoals: 1.30, awayGoals: 1.05, over25Base: 0.42 },
  43:  { homeGoals: 1.28, awayGoals: 1.05, over25Base: 0.42 },
  135: { homeGoals: 1.55, awayGoals: 1.25, over25Base: 0.54 },
  140: { homeGoals: 1.42, awayGoals: 1.15, over25Base: 0.47 },
};

const DEFAULT_BASELINE_25 = { homeGoals: 1.50, awayGoals: 1.20, over25Base: 0.50 };

function poissonPmf(k, lambda) {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / fact;
}

function shrink(raw, matchesPlayed, fullConfidenceAt = 30) {
  // For Over 2.5, samples are noisier — we shrink harder.
  const confidence = Math.min(1, matchesPlayed / fullConfidenceAt);
  return 1 + (raw - 1) * confidence;
}

// Dixon-Coles correction factor for low scores.
// rho is the correlation parameter, typically -0.1 to 0.1.
// We use rho = -0.05 as a mild correction toward draws at 1-1.
function dixonColesTau(x, y, homeXG, awayXG, rho = -0.05) {
  if (x === 0 && y === 0) return 1 - homeXG * awayXG * rho;
  if (x === 0 && y === 1) return 1 + homeXG * rho;
  if (x === 1 && y === 0) return 1 + awayXG * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

export function scoreFixtureOver25(fx, home, away, injuries) {
  const baseline = LEAGUE_BASELINE_25[fx.leagueId] || DEFAULT_BASELINE_25;
  const leagueAvgFor = (baseline.homeGoals + baseline.awayGoals) / 2;

  const homeAttackRaw  = home.avgFor     ? home.avgFor / leagueAvgFor     : 1.0;
  const homeDefWeakRaw = home.avgAgainst ? home.avgAgainst / leagueAvgFor : 1.0;
  const awayAttackRaw  = away.avgFor     ? away.avgFor / leagueAvgFor     : 1.0;
  const awayDefWeakRaw = away.avgAgainst ? away.avgAgainst / leagueAvgFor : 1.0;

  const homeAttack  = shrink(homeAttackRaw,  home.matchesPlayed);
  const homeDefWeak = shrink(homeDefWeakRaw, home.matchesPlayed);
  const awayAttack  = shrink(awayAttackRaw,  away.matchesPlayed);
  const awayDefWeak = shrink(awayDefWeakRaw, away.matchesPlayed);

  const rawHomeXG = homeAttack * awayDefWeak * baseline.homeGoals;
  const rawAwayXG = awayAttack * homeDefWeak * baseline.awayGoals;
  let homeXG = Math.min(rawHomeXG, 3.2);
  let awayXG = Math.min(rawAwayXG, 3.2);

  // Cap combined xG to a realistic maximum. Real football matches
  // average ~2.7 total goals; only the highest-scoring fixtures
  // exceed 3.5. Without this, two teams at the per-team cap (3.2+3.2=6.4)
  // produce Over 2.5 probabilities above 95%.
  const MAX_TOTAL_XG_25 = 3.6;
  const totalXG = homeXG + awayXG;
  if (totalXG > MAX_TOTAL_XG_25) {
    const scale = MAX_TOTAL_XG_25 / totalXG;
    homeXG = homeXG * scale;
    awayXG = awayXG * scale;
  }

  // Compute scoreline probabilities with Dixon-Coles correction.
  // We sum up P(0-0), P(0-1), P(1-0), P(1-1), P(2-0), P(0-2), P(2-1), P(1-2), P(2-2) —
  // everything with total < 3 — then take 1 minus that sum.
  let pUnder3 = 0;

  for (let h = 0; h <= 4; h++) {
    for (let a = 0; a <= 4; a++) {
      if (h + a >= 3) continue; // only care about totals under 3
      const p = poissonPmf(h, homeXG) * poissonPmf(a, awayXG) * dixonColesTau(h, a, homeXG, awayXG);
      pUnder3 += p;
    }
  }

  // Normalize: the tau adjustment slightly distorts probabilities. Rescale so they sum to 1.
  // A rough normalization since we're truncating at 4 goals per side.
  let totalMass = 0;
  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      const p = poissonPmf(h, homeXG) * poissonPmf(a, awayXG) * dixonColesTau(h, a, homeXG, awayXG);
      totalMass += p;
    }
  }
  const pOver25 = Math.max(0, Math.min(1, 1 - pUnder3 / totalMass));

  // Blend toward league Over 2.5 baseline if the sample is thin.
  // Since Over 2.5 is a "noisy" market, we apply additional baseline blending.
  const minPlayed = Math.min(home.matchesPlayed, away.matchesPlayed);
  const blendWeight = Math.min(1, minPlayed / 20); // 0..1
  const baselineRate = baseline.over25Base;
  const blendedProb = pOver25 * blendWeight + baselineRate * (1 - blendWeight);

  // Injury penalty — 1.5 percentage points per absence, slightly smaller than Over 1.5 since
  // a missing attacker affects 3+ goal games a bit less than it affects 2+ goal games.
  const injuryPenalty = (injuries.homeKeyOut + injuries.awayKeyOut) * 0.015;
  const MAX_O25_PROB = 0.75;
  const finalProb = Math.max(0, Math.min(MAX_O25_PROB, blendedProb - injuryPenalty));

  const reasons = [
    `xG ${homeXG.toFixed(2)} – ${awayXG.toFixed(2)}`,
    `Home O2.5 ${(Math.min(home.over25Rate, 0.70) * 100).toFixed(0)}% · Away ${(Math.min(away.over25Rate, 0.70) * 100).toFixed(0)}%`,
  ];
  if (home.bttsRate && away.bttsRate) {
    reasons.push(`BTTS ${(home.bttsRate * 100).toFixed(0)}/${(away.bttsRate * 100).toFixed(0)}%`);
  }
  if (injuryPenalty > 0) reasons.push(`−${(injuryPenalty * 100).toFixed(1)}% injury`);

  return {
    ...fx,
    score: Math.round(finalProb * 1000) / 10,
    probability: finalProb,
    market: 'over25',
    homeXG, awayXG,
    homeOver25Rate: home.over25Rate,
    awayOver25Rate: away.over25Rate,
    homeBtts: home.bttsRate,
    awayBtts: away.bttsRate,
    homeLast5: home.last5Over25Rate,
    awayLast5: away.last5Over25Rate,
    injuryPenalty,
    reasons,
  };
}
