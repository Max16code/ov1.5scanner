import * as apiFootball from './providers/api-football';
import * as openfootball from './providers/openfootball';

export const PROVIDERS = [
  apiFootball,
  openfootball,
];

export const LEAGUE_SELECTION = {
  'api-football': [39, 40, 41, 42, 43, 135, 140],
  'openfootball': ['eng-pl', 'eng-champ', 'ita-serie-a', 'esp-liga', 'de-1'],
};

// Leagues shown in the UI. Each has:
//  - key: the ID used to select the league
//  - provider: which provider serves it
//  - label: display name for the button
export const UI_LEAGUES = [
  { key: 'eng-pl',      provider: 'openfootball', label: 'Premier League' },
  { key: 'eng-champ',   provider: 'openfootball', label: 'Championship' },
  { key: 'ita-serie-a', provider: 'openfootball', label: 'Serie A' },
  { key: 'esp-liga',    provider: 'openfootball', label: 'La Liga' },
];

export function getActiveProviders() {
  const enabled = process.env.ENABLED_PROVIDERS
    ? process.env.ENABLED_PROVIDERS.split(',').map((s) => s.trim())
    : PROVIDERS.map((p) => p.name);

  return PROVIDERS.filter((p) => enabled.includes(p.name));
}
