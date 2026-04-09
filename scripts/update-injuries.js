#!/usr/bin/env node
// Fetches current Boca Juniors injury data from BeSoccer and updates injuries.json
// Runs as GitHub Action cron or manually: node scripts/update-injuries.js

const https = require('https');
const fs = require('fs');
const path = require('path');

const BESOCCER_URL = 'https://es.besoccer.com/equipo/lesionados-sancionados/ca-boca-juniors';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-AR,es;q=0.9',
  'Accept-Encoding': 'identity',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};

// Player surname → file/name/num mapping
const PLAYERS = {
  'marchesin':    { file: 'Agustin_Marchesin',   name: 'Agustín Marchesín',   num: 1  },
  'brey':         { file: 'Leandro_Brey',         name: 'Leandro Brey',        num: 12 },
  'garcia':       { file: 'Javier_Garcia',        name: 'Javier García',       num: 13 },
  'di lollo':     { file: 'Lautaro_Di_Lollo',     name: 'Lautaro Di Lollo',    num: 2  },
  'blanco':       { file: 'Lautaro_Blanco',       name: 'Lautaro Blanco',      num: 3  },
  'figal':        { file: 'Nicolas_Figal',        name: 'Nicolás Figal',       num: 4  },
  'battaglia':    { file: 'Rodrigo_Battaglia',    name: 'Rodrigo Battaglia',   num: 6  },
  'braida':       { file: 'Malcom_Braida',        name: 'Malcom Braida',       num: 27 },
  'weigandt':     { file: 'Marcelo_Weigandt',     name: 'Marcelo Weigandt',    num: 23 },
  'barinaga':     { file: 'Juan_Barinaga',        name: 'Juan Barinaga',       num: 24 },
  'pellegrino':   { file: 'Marco_Pellegrino',     name: 'Marco Pellegrino',    num: 26 },
  'ayrton costa': { file: 'Ayrton_Costa',         name: 'Ayrton Costa',        num: 32 },
  'gorosito':     { file: 'Dylan_Gorosito',       name: 'Dylan Gorosito',      num: 48 },
  'paredes':      { file: 'Leandro_Paredes',      name: 'Leandro Paredes',     num: 5  },
  'palacios':     { file: 'Carlos_Palacios',      name: 'Carlos Palacios',     num: 8  },
  'alarcon':      { file: 'Williams_Alarcon',      name: 'Williams Alarcón',    num: 15 },
  'delgado':      { file: 'Milton_Delgado',       name: 'Milton Delgado',      num: 18 },
  'martegani':    { file: 'Agustin_Martegani',    name: 'Agustín Martegani',   num: 19 },
  'velasco':      { file: 'Alan_Velasco',         name: 'Alan Velasco',        num: 20 },
  'herrera':      { file: 'Ander_Herrera',        name: 'Ander Herrera',       num: 21 },
  'zenon':        { file: 'Kevin_Zenon',          name: 'Kevin Zenón',         num: 22 },
  'ascacibar':    { file: 'Santiago_Ascacibar',   name: 'Santiago Ascacíbar',   num: 25 },
  'belmonte':     { file: 'Tomas_Belmonte',       name: 'Tomás Belmonte',      num: 30 },
  'aranda':       { file: 'Tomas_Aranda',         name: 'Tomás Aranda',        num: 36 },
  'rey domenech': { file: 'Camilo_Rey_Domenech',  name: 'Camilo Rey Domenech', num: 38 },
  'zeballos':     { file: 'Exequiel_Zeballos',    name: 'Exequiel Zeballos',   num: 7  },
  'gimenez':      { file: 'Milton_Gimenez',       name: 'Milton Giménez',      num: 9  },
  'cavani':       { file: 'Edinson_Cavani',       name: 'Edinson Cavani',      num: 10 },
  'janson':       { file: 'Lucas_Janson',         name: 'Lucas Janson',        num: 11 },
  'merentiel':    { file: 'Miguel_Merentiel',     name: 'Miguel Merentiel',    num: 16 },
  'bareiro':      { file: 'Adam_Bareiro',         name: 'Adam Bareiro',        num: 28 },
  'romero':       { file: 'Angel_Romero',         name: 'Ángel Romero',        num: 29 },
  'gelini':       { file: 'Gonzalo_Gelini',       name: 'Gonzalo Gelini',      num: 37 },
  'zufiaurre':    { file: 'Iker_Zufiaurre',      name: 'Iker Zufiaurre',      num: 41 },
  'payal':        { file: 'Juan_Cruz_Payal',     name: 'Juan Cruz Payal',     num: 46 },
  'ruiz':         { file: 'Joaquin_Ruiz',        name: 'Joaquín Ruiz',        num: 53 },
};

function norm(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function resolvePlayer(text) {
  const n = norm(text);
  for (const [key, val] of Object.entries(PLAYERS)) {
    if (n.includes(key)) return val;
  }
  return null;
}

function guessSeverity(injury) {
  if (/cirug|operaci|aquiles|cruzado|rotura|fractura|intervenci[oó]n/i.test(injury)) return 'high';
  if (/molestia|contusi|fatiga/i.test(injury)) return 'low';
  return 'medium';
}

function isSuspension(text) {
  return /tarjeta|sancion|sanci[oó]n|expulsi[oó]n|acumulaci[oó]n/i.test(text);
}

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const doFetch = (u, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      const mod = u.startsWith('https') ? https : require('http');
      mod.get(u, { headers: BROWSER_HEADERS }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return doFetch(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    };
    doFetch(url);
  });
}

function parseCurrentInjuries(html) {
  // BeSoccer structure:
  // - Current injuries: <ul class="item-list" data-date="9999">
  // - Historical: <ul class="item-list" data-date="2026-03"> (real dates)
  // Only parse the data-date="9999" section (current)

  const listMatch = html.match(/<ul[^>]*class="item-list"[^>]*data-date="9999"[^>]*>[\s\S]*?<\/ul>/i);
  if (!listMatch) {
    console.log('Could not find current injuries section');
    return [];
  }

  const currentSection = listMatch[0];
  const injuries = [];
  const seen = new Set();

  // Parse each item-box entry
  const entryRe = /<a[^>]*data-cy="injury"[^>]*>[\s\S]*?<div class="main-text">(.*?)<\/div>\s*<div class="sub-text1">(.*?)<\/div>\s*(?:<div class="sub-text2">(.*?)<\/div>)?/gi;
  let match;
  while ((match = entryRe.exec(currentSection)) !== null) {
    const name = match[1].trim();
    const injury = match[2].trim();
    const eta = (match[3] || '').trim() || 'Sin fecha';

    // Skip suspensions
    if (isSuspension(injury)) continue;

    const player = resolvePlayer(name);
    if (!player || seen.has(player.file)) continue;
    seen.add(player.file);

    injuries.push({
      file: player.file,
      name: player.name,
      num: player.num,
      injury,
      eta,
      sev: guessSeverity(injury)
    });
  }

  return injuries;
}

async function main() {
  console.log('Fetching BeSoccer injury page...');
  const html = await fetchPage(BESOCCER_URL);
  console.log(`Fetched ${(html.length / 1024).toFixed(0)} KB`);

  const injuries = parseCurrentInjuries(html);

  if (!injuries.length) {
    console.log('No current injuries found. Keeping existing injuries.json.');
    process.exit(0);
  }

  const output = {
    updated: new Date().toISOString().slice(0, 10),
    source: 'BeSoccer (automated)',
    injuries
  };

  const outPath = path.join(__dirname, '..', 'injuries.json');
  const prev = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
  const next = JSON.stringify(output, null, 2) + '\n';

  if (prev.trim() === next.trim()) {
    console.log('No changes detected.');
  } else {
    fs.writeFileSync(outPath, next);
    console.log(`Updated injuries.json: ${injuries.length} injuries`);
    injuries.forEach(i => console.log(`  - ${i.name}: ${i.injury} [${i.sev}] (${i.eta})`));
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  // Don't fail the workflow — keep existing injuries.json
  console.log('Keeping existing injuries.json unchanged.');
  process.exit(0);
});
