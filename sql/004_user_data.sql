-- ORGANIZATOR — Datos de la app por usuario (SYNC, paso 2)
-- Ejecutar una sola vez en el SQL editor de Neon (https://console.neon.tech)
-- antes de usar /api/data.
--
-- Una fila = el valor COMPLETO de una clave de window.storage de un
-- usuario (p. ej. todas sus tareas en 'tasks'), el mismo JSON que hoy se
-- guarda en IndexedDB. El PAR (user_id, key) es la clave primaria: cada
-- usuario tiene como máximo una fila por clave, y el índice de la PK (que
-- empieza por user_id) sirve también para leer todas las claves de un
-- usuario sin necesitar otro índice.
--
-- `key` solo admite las claves que se sincronizan entre dispositivos. A
-- propósito NO incluye 'reminderNotificationLedger': es un registro local
-- de cada dispositivo (qué avisos ya mostró ESE dispositivo) y nunca se
-- sube al servidor. Si en el futuro se añade otra clave sincronizada, hay
-- que ampliar esta lista con ALTER TABLE (y la lista blanca de
-- lib/user-data.js a la vez).
--
-- `rev` es un contador por fila que el servidor incrementa en cada
-- escritura (empieza en 1). El cliente envía el `rev` que conocía
-- (baseRev) y la escritura solo se aplica si sigue coincidiendo — así
-- dos dispositivos nunca se pisan sin enterarse (ver api/data.js). Se usa
-- un contador en vez de la hora del cliente para no depender de relojes
-- desajustados entre dispositivos.
--
-- ON DELETE CASCADE: si se borra una cuenta de `users`, sus datos se
-- borran con ella (mismo criterio que push_subscriptions/push_reminders).

CREATE TABLE IF NOT EXISTS user_data (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  rev BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key),
  CONSTRAINT user_data_key_check CHECK (key IN (
    'tasks',
    'events',
    'customSchedules',
    'eventCategories',
    'reminders',
    'settingsPrefs',
    'settingsIA'
  )),
  CONSTRAINT user_data_rev_check CHECK (rev > 0)
);
