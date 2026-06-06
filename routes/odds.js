const express = require('express');
const pool    = require('../db');

const router = express.Router();

const ODDS_API_KEY    = process.env.ODDS_API_KEY;
const CACHE_TTL_MS    = 60 * 60 * 1000; // 1 hora en milisegundos
const SPORT           = 'soccer_fifa_world_cup';
const REGIONS         = 'eu';            // cuotas europeas (decimales)
const MARKETS         = 'h2h,totals,btts'; // 1X2, goles +/-, ambos anotan

// ── GET /api/odds ─ Devuelve cuotas cacheadas (y refresca si hace falta) ─────
router.get('/', async (req, res) => {
  try {
    // 1. Leer cache de Supabase
    const cached = await pool.query(
      'SELECT * FROM odds_cache ORDER BY match_date, home'
    );

    // 2. Ver si el cache es reciente (menos de 1 hora)
    const now        = Date.now();
    const lastFetch  = cached.rows[0]?.fetched_at
      ? new Date(cached.rows[0].fetched_at).getTime()
      : 0;
    const cacheStale = (now - lastFetch) > CACHE_TTL_MS;

    if (!cacheStale && cached.rows.length > 0) {
      // Cache fresco → devolver sin llamar a la API externa
      return res.json({
        source:     'cache',
        fetched_at: cached.rows[0].fetched_at,
        odds:       formatOdds(cached.rows),
      });
    }

    // 3. Cache viejo o vacío → llamar a The Odds API
    if (!ODDS_API_KEY) {
      // Sin API key devolvemos lo que hay en cache aunque esté viejo
      return res.json({
        source:     'cache_stale',
        fetched_at: cached.rows[0]?.fetched_at || null,
        odds:       formatOdds(cached.rows),
      });
    }

    const apiUrl = `https://api.the-odds-api.com/v4/sports/${SPORT}/odds/?apiKey=${ODDS_API_KEY}&regions=${REGIONS}&markets=${MARKETS}&oddsFormat=decimal&dateFormat=iso`;
    const apiRes = await fetch(apiUrl);

    if (!apiRes.ok) {
      // Si la API falla devolvemos el cache que tengamos
      console.error('Odds API error:', apiRes.status, await apiRes.text());
      return res.json({
        source:     'cache_fallback',
        fetched_at: cached.rows[0]?.fetched_at || null,
        odds:       formatOdds(cached.rows),
      });
    }

    const games = await apiRes.json();
    console.log(`Odds API: ${games.length} partidos recibidos`);

    // 4. Procesar y guardar en Supabase
    for (const game of games) {
      const matchKey  = buildMatchKey(game.home_team, game.away_team);
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
          game.home_team,
          game.away_team,
          game.commence_time,
          JSON.stringify(odds1x2),
          JSON.stringify(oddsGoals),
          JSON.stringify(oddsBtts),
          JSON.stringify(game),
        ]
      );
    }

    // 5. Releer el cache actualizado
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

// ── GET /api/odds/remaining ─ Cuántos requests quedan en la API ──────────────
router.get('/remaining', async (req, res) => {
  if (!ODDS_API_KEY)
    return res.json({ remaining: null, message: 'Sin API key configurada' });

  try {
    const apiRes = await fetch(
      `https://api.the-odds-api.com/v4/sports/?apiKey=${ODDS_API_KEY}`
    );
    const remaining = apiRes.headers.get('x-requests-remaining');
    const used      = apiRes.headers.get('x-requests-used');
    res.json({ remaining: parseInt(remaining), used: parseInt(used) });
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar requests restantes' });
  }
});

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════

function buildMatchKey(home, away) {
  return `${home}_${away}`.toLowerCase().replace(/\s+/g, '_');
}

function extractH2H(game) {
  const market = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h');
  if (!market) return null;
  const outcomes = market.outcomes;
  return {
    home: outcomes.find(o => o.name === game.home_team)?.price,
    draw: outcomes.find(o => o.name === 'Draw')?.price,
    away: outcomes.find(o => o.name === game.away_team)?.price,
  };
}

function extractTotals(game) {
  const market = game.bookmakers?.[0]?.markets?.find(m => m.key === 'totals');
  if (!market) return null;
  const outcomes = market.outcomes;
  // Busca la línea de 2.5 goles, la más común
  const over  = outcomes.find(o => o.name === 'Over'  && o.point === 2.5);
  const under = outcomes.find(o => o.name === 'Under' && o.point === 2.5);
  return {
    over25:  over?.price,
    under25: under?.price,
    point:   2.5,
  };
}

function extractBTTS(game) {
  const market = game.bookmakers?.[0]?.markets?.find(m => m.key === 'btts');
  if (!market) return null;
  const outcomes = market.outcomes;
  return {
    yes: outcomes.find(o => o.name === 'Yes')?.price,
    no:  outcomes.find(o => o.name === 'No')?.price,
  };
}

function formatOdds(rows) {
  // Convierte las filas de DB en un objeto { matchKey: { ...cuotas } }
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
