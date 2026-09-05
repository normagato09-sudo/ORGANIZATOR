-- ORGANIZATOR — Tabla de usuarios
-- Ejecutar una sola vez en el SQL editor de Neon (https://console.neon.tech)
-- antes de usar /api/auth/register.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
