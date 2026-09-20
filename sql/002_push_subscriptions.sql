-- ORGANIZATOR — Suscripciones Web Push (R-8.2-A)
-- Ejecutar una sola vez en el SQL editor de Neon (https://console.neon.tech)
-- antes de usar /api/push/subscribe.
--
-- Una fila = una PushSubscription real del navegador (endpoint + claves de
-- cifrado), asociada al usuario autenticado que la registró. `endpoint` es
-- único porque el propio servicio de push del navegador (FCM, Mozilla
-- autopush, etc.) ya garantiza que identifica una única suscripción real;
-- reutilizarlo en un INSERT ... ON CONFLICT permite volver a asociarla al
-- usuario actual si el navegador la renueva o si cambia la sesión activa
-- en ese dispositivo, sin duplicar filas.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON push_subscriptions(user_id);
