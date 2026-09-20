-- ORGANIZATOR — Cola mínima de reminders para Web Push (R-8.2-A)
-- Ejecutar una sola vez en el SQL editor de Neon (https://console.neon.tech)
-- antes de usar /api/push/schedule-reminder.
--
-- IMPORTANTE (alcance deliberado, ver informe de R-8.1/R-8.2-A): esta tabla
-- NUNCA guarda tasks/events completos ni nada más allá de lo que la propia
-- notificación necesita mostrar. `title`/`body` se calculan en el cliente
-- (reutilizando la misma lógica que ya usa showReminderNotification/
-- reminderNotificationBody) en el momento de programar el envío — el
-- servidor nunca reconstruye esos textos a partir de tasks/events, porque
-- nunca los recibe.
--
-- `reminder_id` es el id del reminder LOCAL (IndexedDB, ver Fase 1 de
-- RECORDATORIOS en organizator.html) — nunca se reinventa un id nuevo del
-- lado servidor. Como ese id solo es único DENTRO del navegador de un
-- usuario (no hay garantía de unicidad global entre usuarios distintos),
-- el ownership real y la unicidad de fila los da el PAR (user_id,
-- reminder_id) — ver el UNIQUE de abajo — nunca reminder_id a secas.
--
-- `qstash_message_id` es el identificador que devuelve QStash al publicar
-- el mensaje programado (ver /v2/publish, R-8.1-C): es lo único que hace
-- falta guardar para poder cancelar (DELETE /v2/messages/{id}) o para
-- saber que ya existe una programación en curso para este reminder.

CREATE TABLE IF NOT EXISTS push_reminders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_id TEXT NOT NULL,
  remind_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'triggered' | 'cancelled' — mismos 3 estados que el modelo local (Fase 1)
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  qstash_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, reminder_id)
);

CREATE INDEX IF NOT EXISTS push_reminders_user_id_idx ON push_reminders(user_id);
CREATE INDEX IF NOT EXISTS push_reminders_status_idx ON push_reminders(status);
