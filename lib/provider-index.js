import * as apiFootball from './providers/api-football';
import * as openfootball from './providers/openfootball';
import * as bzzoiro from './providers/bzzoiro';

export const PROVIDERS = [apiFootball, openfootball, bzzoiro];

export const LEAGUE_SELECTION = {
  'openfootball': ['eng-pl', 'eng-champ', 'ita-serie-a', 'esp-liga', 'de-1'],
  'bzzoiro': ['ucl', 'nl-eredivisie', 'pt-primeira', 'fr-1'],
  'api-football': [],
};

export function getActiveProviders() {
  const enabled = process.env.ENABLED_PROVIDERS
    ? process.env.ENABLED_PROVIDERS.split(',').map((s) => s.trim())
    : ['openfootball', 'bzzoiro'];

  return PROVIDERS.filter((p) => enabled.includes(p.name));
}
