import fs from 'fs';
const files = ['app/api/hot40/route.js', 'app/api/scan/route.js', 'app/api/scan-over25/route.js'];
for (const file of files) {
  let s = fs.readFileSync(file, 'utf8');
  const oldLoopStart = s.indexOf('  const scored = [];');
  const oldLoopEnd = s.indexOf('  const providerRank =');

  if (oldLoopStart > -1 && oldLoopEnd > -1) {
    const newBlock = `  const formCache = new Map();
  const injuryCache = new Map();

  async function getTeamFormCached(provider, teamId, teamName) {
    const key = provider.name + '|' + teamId;
    if (formCache.has(key) === false) {
      formCache.set(key, fetchTeamForm(provider, teamId, teamName, bsdIndex));
    }
    return formCache.get(key);
  }

  async function getInjuriesCached(provider, fixtureId, homeId, awayId, homeName, awayName) {
    const key = provider.name + '|' + fixtureId;
    if (injuryCache.has(key) === false) {
      injuryCache.set(key, fetchInjuries(provider, fixtureId, homeId, awayId, homeName, awayName, bsdIndex));
    }
    return injuryCache.get(key);
  }

  const scored = [];
  const promises = allFixtures.map(async (fx) => {
    const provider = fx._provider;
    try {
      const [home, away, injuries] = await Promise.all([
        getTeamFormCached(provider, fx.homeTeamId, fx.homeTeamName),
        getTeamFormCached(provider, fx.awayTeamId, fx.awayTeamName),
        getInjuriesCached(provider, fx.fixtureId, fx.homeTeamId, fx.awayTeamId, fx.homeTeamName, fx.awayTeamName)
      ]);
      const clean = { ...fx };
      delete clean._provider;
      return { ...scoreFixture(clean, home, away, injuries), provider: provider.name };
    } catch (e) {
      console.error(provider.name + ': scoring failed:', e.message);
      return null;
    }
  });

  const results = await Promise.all(promises);
  for (const res of results) {
    if (res) scored.push(res);
  }

`;
    s = s.substring(0, oldLoopStart) + newBlock + s.substring(oldLoopEnd);
    fs.writeFileSync(file, s);
    console.log(file + ' optimized');
  } else {
    console.log('Could not find loop in ' + file);
  }
}
