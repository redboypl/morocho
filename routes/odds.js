const express = require('express');
const pool    = require('../db');

const router = express.Router();

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora
const SPORT        = 'soccer_fifa_world_cup';
const REGIONS      = 'eu';
const MARKETS      = 'h2h,totals,btts';

// Mapa de nombres en inglés (API) → español (frontend)
const NAME_MAP = {
  'Mexico':               'México',
  'South Africa':         'Sudáfrica',
  'South Korea':          'Corea del Sur',
  'Czech Republic':       'Chequia',
  'Bosnia & Herzegovina': 'Bosnia & Herz.',
  'USA':                  'EE.UU.',
  'Qatar':                'Catar',
  'Brazil':               'Brasil',
  'Haiti':                'Haití',
  'Scotland':             'Escocia',
  'Australia':            'Australia',
  'Turkey':               'Turquía',
  'Germany':              'Alemania',
  'Netherlands':          'Países Bajos',
  'Ivory Coast':          'C. de Marfil',
  'Sweden':               'Suecia',
  'Tunisia':              'Túnez',
  'Spain':                'España',
  'Cape Verde':           'Cabo Verde',
  'Belgium':              'Bélgica',
  'Egypt':                'Egipto',
  'Saudi Arabia':         'Arabia Saudita',
  'Iran':                 'Irán',
  'New Zealand':          'Nueva Zelanda',
  'France':               'Francia',
  'Senegal':              'Senegal',
  'Iraq':                 'Irak',
  'Argentina':            'Argentina',
  'Algeria':              'Argelia',
  'Austria':              'Austria',
  'Jordan':               'Jordania',
  'Portugal':             'Portugal',
  'DR Congo':             'RD Congo',
  'England':              'Inglaterra',
  'Croatia':              'Croacia',
  'Ghana':                'Ghana',
  'Panama':               'Panamá',
  'Uzbekistan':           'Uzbekistán',
  'Colombia':             'Colombia',
  'Canada':               'Canadá',
  'Switzerland':          'Suiza',
  'Morocco':              'Marruecos',
  'Ecuador':              'Ecuador',
  'Japan':                'Japón',
  'Norway':               'Noruega',
  'Uruguay':              'Uruguay',
  'Paraguay':             'Paraguay',
  'Peru':                 'Perú',
  'Serbia':               'Serbia',
  'Denmark':              'Dinamarca',
  'Poland':               'Polonia',
  'Ukraine':              'Ucrania',
  'Nigeria':              'Nigeria',
  'Cameroon':             'Camerún',
  'Ghana':                'Ghana',
  'Curaçao':              'Curazao',
  'Costa Rica':           'Costa Rica',
  'Honduras':             'Honduras',
  'Bolivia':              'Bolivia',
  'Chile':                'Chile',
  'Venezuela':            'Venezuela',
  'Romania':              'Rumania',
  'Hungary':              'Hungría',
  'Slovakia':             'Eslovaquia',
  'Slovenia':             'Eslovenia',
  'Finland':              'Finlandia',
  'Greece':               'Grecia',
  'Albania':              'Albania',
  'Kosovo':               'Kosovo',
  'Wales':                'Gales',
  'Northern Ireland':     'Irlanda del Norte',
  'Ireland':              'Irlanda',
  'Iceland':              'Islandia',
  'Kosovo':               'Kosovo',
  'Bahrain':              'Baréin',
  'Kuwait':               'Kuwait',
  'Oman':                 'Omán',
  'UAE':                  'Emiratos Árabes',
  'Indonesia':            'Indonesia',
  'Vietnam':              'Vietnam',
  'Thailand':             'Tailandia',
  'India':                'India',
};

function toSpanish(name) {
  return NAME_MAP[name] || name;
}

// ── GET /api/odds ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const cached = await pool.query(
      'SELECT * FROM odds_cache ORDER BY match_date, home'
    );

    const now        = Date.now();
    const lastFetch  = cached.rows[0]?.fetched_at
      ? new Date(cached.rows[0].fetched_at).getTime()
      : 0;
    const cacheStale = (now - lastFetch) > CACHE_TTL_MS;

    if (!cacheStale && cached.rows.length > 0) {
      return res.json({
        source:     'cache',
        fetched_at: cached.rows[0].fetched_at,
        odds:       formatOdds(cached.rows),
      });
    }

    if (!ODDS_API_KEY) {
      return res.json({
        source:     'cache_stale',
        fetched_at: cached.rows[0]?.fetched_at || null,
        odds:       formatOdds(cached.rows),
      });
    }

    const apiUrl = const apiUrl = `https://api.the-odds-api.com/v4/sports/${SPORT}/odds/?apiKey=${ODDS_API_KEY}&regions=${REGIONS}&markets=${MARKETS}&oddsFormat=decimal&dateFormat=iso`;
    const apiRes = await fetch(apiUrl);

    if (!apiRes.ok) {
      console.error('Odds API error:', apiRes.status);
      return res.json({
        source:     'cache_fallback',
        fetched_at: cached.rows[0]?.fetched_at || null,
        odds:       formatOdds(cached.rows),
      });
    }

    const games = await apiRes.json();
    console.log(`Odds API: ${games.length} partidos recibidos`);

    for (const game of games) {
      const homeEs    = toSpanish(game.home_team);
      const awayEs    = toSpanish(game.away_team);
      const matchKey  = buildMatchKey(homeEs, awayEs);
      const odds1x2   = extractH2H(game);
      const oddsGoals = extractTotals(game);
      const oddsBtts  = extractBTTS(game);

      await pool.query(
        `INSERT INTO odds_cache (match_key, home, away, match_date, odds_1x2, odds_goals, odds_btts, raw_data, fetched_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
         ON CONFLICT (match_key)
         DO UPDATE SET odds_1x2=$5, odds_goals=$6, odds_btts=$7, raw_data=$8, fetched_at=NOW(), updated_at=NOW()`,
        [
          matchKey,
          homeEs,
          awayEs,
          game.commence_time,
          JSON.stringify(odds1x2),
          JSON.stringify(oddsGoals),
          JSON.stringify(oddsBtts),
          JSON.stringify(game),
        ]
      );
    }

    const updated = await pool.query(
      'SELECT * FROM odds_cache ORDER BY match_date, home'
    );

    res.json({
      source:     'api_fresh',
      fetched_at: new Date().toISOString(),
      odds:       formatOdds(updated.rows),
    });

  } catch (err) {
    console.error('GET /api/odds error:', err);
    res.status(500).json({ error: 'Error al obtener cuotas' });
  }
});

// ── GET /api/odds/remaining ───────────────────────────────────────────────────
router.get('/remaining', async (req, res) => {
  if (!ODDS_API_KEY)
    return res.json({ remaining: null, message: 'Sin API key configurada' });
  try {
    const apiRes = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${ODDS_API_KEY}`);
    const remaining = apiRes.headers.get('x-requests-remaining');
    const used      = apiRes.headers.get('x-requests-used');
    res.json({ remaining: parseInt(remaining), used: parseInt(used) });
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar requests restantes' });
  }
});

// ── HELPERS ───────────────────────────────────────────────────────────────────
function buildMatchKey(home, away) {
  return `${home}_${away}`.toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e')
    .replace(/[íìï]/g, 'i').replace(/[óòö]/g, 'o')
    .replace(/[úùü]/g, 'u').replace(/ñ/g, 'n')
    .replace(/[^a-z0-9_&]/g, '');
}

function extractH2H(game) {
  // Tomar el promedio de todas las casas disponibles para mayor precisión
  const bookmakers = game.bookmakers || [];
  let homeTotal = 0, drawTotal = 0, awayTotal = 0, count = 0;

  for (const bk of bookmakers) {
    const market = bk.markets?.find(m => m.key === 'h2h');
    if (!market) continue;
    const homePrice = market.outcomes.find(o => o.name === game.home_team)?.price;
    const drawPrice = market.outcomes.find(o => o.name === 'Draw')?.price;
    const awayPrice = market.outcomes.find(o => o.name === game.away_team)?.price;
    if (homePrice && drawPrice && awayPrice) {
      homeTotal += homePrice; drawTotal += drawPrice; awayTotal += awayPrice;
      count++;
    }
  }

  if (count === 0) return null;
  return {
    home: parseFloat((homeTotal / count).toFixed(2)),
    draw: parseFloat((drawTotal / count).toFixed(2)),
    away: parseFloat((awayTotal / count).toFixed(2)),
  };
}

function extractTotals(game) {
  const bookmakers = game.bookmakers || [];
  let over25Total = 0, under25Total = 0, count = 0;

  for (const bk of bookmakers) {
    const market = bk.markets?.find(m => m.key === 'totals');
    if (!market) continue;
    const over  = market.outcomes.find(o => o.name === 'Over'  && o.point === 2.5);
    const under = market.outcomes.find(o => o.name === 'Under' && o.point === 2.5);
    if (over && under) {
      over25Total += over.price; under25Total += under.price;
      count++;
    }
  }

  if (count === 0) return null;
  return {
    over25:  parseFloat((over25Total / count).toFixed(2)),
    under25: parseFloat((under25Total / count).toFixed(2)),
    point:   2.5,
  };
}

function extractBTTS(game) {
  const bookmakers = game.bookmakers || [];
  let yesTotal = 0, noTotal = 0, count = 0;

  for (const bk of bookmakers) {
    const market = bk.markets?.find(m => m.key === 'btts');
    if (!market) continue;
    const yes = market.outcomes.find(o => o.name === 'Yes');
    const no  = market.outcomes.find(o => o.name === 'No');
    if (yes && no) {
      yesTotal += yes.price; noTotal += no.price;
      count++;
    }
  }

  if (count === 0) return null;
  return {
    yes: parseFloat((yesTotal / count).toFixed(2)),
    no:  parseFloat((noTotal / count).toFixed(2)),
  };
}

function formatOdds(rows) {
  const result = {};
  for (const row of rows) {
    result[row.match_key] = {
      home:       row.home,
      away:       row.away,
      match_date: row.match_date,
      fetched_at: row.fetched_at,
      '1x2':      row.odds_1x2,
      goals:      row.odds_goals,
      btts:       row.odds_btts,
    };
  }
  return result;
}

module.exports = router;
