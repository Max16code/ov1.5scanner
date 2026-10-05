import * as apiFootball from './providers/api-football';
import * as openfootball from './providers/openfootball';
import * as bzzoiro from './providers/bzzoiro';

export const PROVIDERS = [apiFootball, openfootball, bzzoiro];

export const LEAGUE_SELECTION = {
  'api-football': [39, 40, 41, 42, 43, 135, 140],
  'openfootball': ['eng-pl', 'eng-champ', 'ita-serie-a', 'esp-liga', 'de-1'],
  'bzzoiro': ['eng-pl', 'eng-champ', 'ita-serie-a', 'esp-liga', 'de-1', 'ucl', 'nl-eredivisie', 'pt-primeira'],
};

export function getActiveProviders() {
  const enabled = process.env.ENABLED_PROVIDERS
    ? process.env.ENABLED_PROVIDERS.split(',').map((s) => s.trim())
    : ['openfootball', 'bzzoiro'];

  return PROVIDERS.filter((p) => enabled.includes(p.name));
}
