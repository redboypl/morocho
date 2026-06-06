-- =====================================================
-- EJECUTA ESTE SQL EN SUPABASE:
-- Supabase → tu proyecto → SQL Editor → New query → pegar esto → Run
-- =====================================================

-- Tabla de usuarios
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,          -- bcrypt hash, nunca texto plano
  username    TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de apuestas
CREATE TABLE IF NOT EXISTS bets (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id    TEXT NOT NULL,          -- ej: "A_Mexico_Sudafrica_11jun"
  home        TEXT NOT NULL,
  away        TEXT NOT NULL,
  match_date  TEXT NOT NULL,
  match_time  TEXT NOT NULL,
  venue       TEXT NOT NULL,
  grupo       TEXT NOT NULL,
  bet_type    TEXT NOT NULL,          -- ej: "1X2", "Goles +/-", etc.
  amount      NUMERIC(10,2),          -- monto apostado
  prediction  TEXT,                   -- ej: "2-1", "Más de 2.5", etc.
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, match_id, bet_type) -- un usuario no puede repetir mismo tipo en mismo partido
);

-- Índices para consultas rápidas
CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets(user_id);
CREATE INDEX IF NOT EXISTS idx_bets_match_id ON bets(match_id);
