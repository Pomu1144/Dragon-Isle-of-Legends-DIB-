import { readFileSync } from 'node:fs';
import { setData } from '../src/core/data';
setData(
  JSON.parse(readFileSync('public/assets/data/gamedata.json', 'utf8')),
  JSON.parse(readFileSync('public/assets/data/maps.json', 'utf8')),
);
