import fs from 'fs';
const p = 'lib/provider-index.js';
let s = fs.readFileSync(p, 'utf8');

const regex = /'bzzoiro':\s*\[[^\]]*\]/;
if (!regex.test(s)) {
  console.log('ERROR: bzzoiro array not found');
  process.exit(1);
}

s = s.replace(regex, "'bzzoiro': ['eng-pl', 'eng-champ', 'ita-serie-a', 'esp-liga', 'de-1', 'ucl', 'nl-eredivisie', 'pt-primeira', 'fr-1']");
fs.writeFileSync(p, s);
console.log('provider index updated');
