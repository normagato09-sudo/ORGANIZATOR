-- ORGANIZATOR — Claves de estudio en user_data (app de exámenes, paso 1)
-- Ejecutar una sola vez en el SQL editor de Neon (https://console.neon.tech)
-- DESPUÉS de 004_user_data.sql y ANTES de desplegar el código que
-- sincroniza estas claves.
--
-- Amplía la lista de claves sincronizadas con las tres nuevas listas:
--   'subjects'      asignaturas (nombre y color)
--   'exams'         exámenes y entregas
--   'studySessions' sesiones del plan de estudio
-- Solo cambia la restricción CHECK: no toca ninguna fila existente. Va en
-- una transacción para que la tabla nunca se quede sin la restricción.
-- Debe coincidir con la lista blanca de lib/user-data.js (KEY_SHAPES).

BEGIN;

ALTER TABLE user_data DROP CONSTRAINT IF EXISTS user_data_key_check;

ALTER TABLE user_data ADD CONSTRAINT user_data_key_check CHECK (key IN (
  'tasks',
  'events',
  'customSchedules',
  'eventCategories',
  'reminders',
  'settingsPrefs',
  'settingsIA',
  'subjects',
  'exams',
  'studySessions'
));

COMMIT;
