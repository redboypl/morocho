const express    = require('express');
const pool       = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Todas las rutas requieren autenticación
router.use(authMiddleware);

// ── GET /api/bets ─ Obtener todas las apuestas del usuario logueado ───────────
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM bets WHERE user_id = $1 ORDER BY match_date, match_time',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET bets error:', err);
    res.status(500).json({ error: 'Error al obtener apuestas' });
  }
});

// ── POST /api/bets ─ Crear o actualizar una apuesta ──────────────────────────
router.post('/', async (req, res) => {
  const { match_id, home, away, match_date, match_time, venue, grupo, bet_type, amount, prediction } = req.body;

  if (!match_id || !bet_type)
    return res.status(400).json({ error: 'match_id y bet_type son requeridos' });

  try {
    // UPSERT: si ya existe esa apuesta para ese partido y tipo, la actualiza
    const result = await pool.query(
      `INSERT INTO bets (user_id, match_id, home, away, match_date, match_time, venue, grupo, bet_type, amount, prediction, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
       ON CONFLICT (user_id, match_id, bet_type)
       DO UPDATE SET amount = EXCLUDED.amount, prediction = EXCLUDED.prediction, updated_at = NOW()
       RETURNING *`,
      [req.user.id, match_id, home, away, match_date, match_time, venue, grupo, bet_type, amount || null, prediction || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST bets error:', err);
    res.status(500).json({ error: 'Error al guardar apuesta' });
  }
});

// ── DELETE /api/bets/:id ─ Eliminar una apuesta ───────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM bets WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Apuesta no encontrada' });

    res.json({ message: 'Apuesta eliminada' });
  } catch (err) {
    console.error('DELETE bets error:', err);
    res.status(500).json({ error: 'Error al eliminar apuesta' });
  }
});

module.exports = router;
