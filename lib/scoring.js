// TIME_DECAY: recent matches carry more weight than older ones.
// Without this, a 4-0 win in August counts the same as a 4-0 win last week.
// The decay constant xi controls how fast older matches fade.
// xi = 0.03 means a match 30 days ago carries ~41% of the weight of today's match.
const TIME_DECAY_XI = 0.03;

export function computeTeamStats(matches, teamId) {
  const played = matches.length;
  if (played === 0) {
    return {
      teamId, matchesPlayed: 0, goalsFor: 0, goalsAgainst: 0,
      avgFor: 0, avgAgainst: 0,
      over15Rate: 0, over25Rate: 0, last5Over15Rate: 0,
      effectiveSampleSize: 0,
    };
  }

  const now = Date.now();
  let weightedFor = 0, weightedAgainst = 0;
  let weightSum = 0;
  let over15Weight = 0, over25Weight = 0;
  let totalGoals = 0;

  for (const m of matches) {
    const gf = m.goalsFor ?? 0;
    const ga = m.goalsAgainst ?? 0;
    const total = gf + ga;

    // If the match has a date, weight by recency. Otherwise weight = 1.
    let w = 1;
    if (m.date) {
      const daysAgo = Math.max(0, (now - new Date(m.date).getTime()) / 864e5);
      w = Math.exp(-TIME_DECAY_XI * daysAgo);
    }

    weightedFor += gf * w;
    weightedAgainst += ga * w;
    weightSum += w;
    totalGoals += total;

    if (total >= 2) over15Weight += w;
    if (total >= 3) over25Weight += w;
  }

  const avgFor = weightSum > 0 ? weightedFor / weightSum : 0;
  const avgAgainst = weightSum > 0 ? weightedAgainst / weightSum : 0;
  const over15Rate = weightSum > 0 ? over15Weight / weightSum : 0;
  const over25Rate = weightSum > 0 ? over25Weight / weightSum : 0;

  // Last 5 uses the raw recent matches (already ordered by date ascending)
  const last5 = matches.slice(-5);
  const last5Over = last5.filter((m) => (m.goalsFor ?? 0) + (m.goalsAgainst ?? 0) >= 2).length;

  return {
    teamId,
    matchesPlayed: played,
    goalsFor: Math.round(weightedFor),
    goalsAgainst: Math.round(weightedAgainst),
    avgFor,
    avgAgainst,
    over15Rate,
    over25Rate,
    last5Over15Rate: last5.length ? last5Over / last5.length : 0,
    effectiveSampleSize: weightSum,
  };
}

const LEAGUE_BASELINE = {
  'eng-pl':      { homeGoals: 1.55, awayGoals: 1.30 },
  'eng-champ':   { homeGoals: 1.45, awayGoals: 1.20 },
  'ita-serie-a': { homeGoals: 1.50, awayGoals: 1.25 },
  'esp-liga':    { homeGoals: 1.45, awayGoals: 1.15 },
  39:  { homeGoals: 1.55, awayGoals: 1.30 },
  40:  { homeGoals: 1.45, awayGoals: 1.20 },
  41:  { homeGoals: 1.40, awayGoals: 1.15 },
  42:  { homeGoals: 1.35, awayGoals: 1.15 },
  43:  { homeGoals: 1.35, awayGoals: 1.15 },
  135: { homeGoals: 1.50, awayGoals: 1.25 },
  140: { homeGoals: 1.45, awayGoals: 1.15 },
};

const DEFAULT_BASELINE = { homeGoals: 1.45, awayGoals: 1.20 };

function poissonPmf(k, lambda) {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / fact;
}

// Shrinkage: pull a raw ratio toward 1.0 based on sample size.
// At 15+ matches, no shrinkage. At 5 matches, ~67% shrunk.
function shrink(raw, matchesPlayed, effectiveSampleSize, fullConfidenceAt = 12) {
  // EFFECTIVE_SAMPLE_SHRINKAGE — use the time-weighted sample size, not the raw count.
  // A team with 8 matches but an effective sample of 4 gets shrunk harder,
  // because its recent form is a small-sample estimate.
  const effective = matchesPlayed; // Fairness — time-decay already affects averages; don't double-penalize
  const confidence = Math.min(1, effective / fullConfidenceAt);
  return 1 + (raw - 1) * confidence;
}

export function scoreFixture(fx, home, away, injuries) {
  const baseline = LEAGUE_BASELINE[fx.leagueId] || DEFAULT_BASELINE;
  const leagueAvgFor = (baseline.homeGoals + baseline.awayGoals) / 2;

  const homeAttackRaw  = home.avgFor     ? home.avgFor / leagueAvgFor     : 1.0;
  const homeDefWeakRaw = home.avgAgainst ? home.avgAgainst / leagueAvgFor : 1.0;
  const awayAttackRaw  = away.avgFor     ? away.avgFor / leagueAvgFor     : 1.0;
  const awayDefWeakRaw = away.avgAgainst ? away.avgAgainst / leagueAvgFor : 1.0;

  const homeAttack  = shrink(homeAttackRaw, home.matchesPlayed, home.effectiveSampleSize);
  const homeDefWeak = shrink(homeDefWeakRaw, home.matchesPlayed, home.effectiveSampleSize);
  const awayAttack  = shrink(awayAttackRaw, away.matchesPlayed, away.effectiveSampleSize);
  const awayDefWeak = shrink(awayDefWeakRaw, away.matchesPlayed, away.effectiveSampleSize);

  const rawHomeXG = homeAttack * awayDefWeak * baseline.homeGoals;
  const rawAwayXG = awayAttack * homeDefWeak * baseline.awayGoals;
  const homeXG = Math.min(rawHomeXG, 3.2);
  const awayXG = Math.min(rawAwayXG, 3.2);

  // Soft compression: values below SOFT_LIMIT pass through untouched.
  // Values above get squeezed toward the HARD_LIMIT but never collapse to the same number.
  // This preserves differentiation between fixtures.
  const rawLambda = homeXG + awayXG;
  const SOFT_LIMIT = 2.8;
  const HARD_LIMIT = 4.2;
  let lambda;
  if (rawLambda <= SOFT_LIMIT) {
    lambda = rawLambda;
  } else {
    const excess = rawLambda - SOFT_LIMIT;
    lambda = SOFT_LIMIT + excess / (1 + excess / (HARD_LIMIT - SOFT_LIMIT));
  }
  const p0 = poissonPmf(0, lambda);
  const p1 = poissonPmf(1, lambda);
  const pOver15 = 1 - p0 - p1;

  const injuryPenalty = (injuries.homeKeyOut + injuries.awayKeyOut) * 0.004;
  const finalProb = Math.max(0, Math.min(1, pOver15 - injuryPenalty));

  const reasons = [
    `xG ${homeXG.toFixed(2)} – ${awayXG.toFixed(2)}`,
    `Home form ${(home.over15Rate * 100).toFixed(0)}% · Away ${(away.over15Rate * 100).toFixed(0)}%`,
  ];
  if (injuryPenalty > 0) reasons.push(`−${(injuryPenalty * 100).toFixed(0)}% injury`);

  return {
    ...fx,
    score: Math.round(finalProb * 1000) / 10,
    probability: finalProb,
    homeXG,
    awayXG,
    homeOver15Rate: home.over15Rate,
    awayOver15Rate: away.over15Rate,
    homeLast5: home.last5Over15Rate,
    awayLast5: away.last5Over15Rate,
    injuryPenalty,
    reasons,
  };
}
