/**
 * ORGANIZATOR — Cliente de base de datos (Neon Postgres)
 *
 * Envuelve la conexión a Neon en una única función `getSql()` que
 * reutiliza la misma instancia entre invocaciones de una misma función
 * serverless. Lee `DATABASE_URL` de las variables de entorno de Vercel
 * (nunca hay credenciales en el código).
 */

const { neon } = require('@neondatabase/serverless');

let sql = null;

function getSql() {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('Falta la variable de entorno DATABASE_URL en Vercel');
    }
    sql = neon(url);
  }
  return sql;
}

module.exports = { getSql };
