// api/auth/recover.js
//
// No requiere sesión (es precisamente para cuando no puedes iniciar sesión),
// pero exige el código de recuperación de ESA cuenta concreta.
//
// Dos garantías de seguridad importantes, además del hash del código:
//
// 1) No revela si el usuario existe: tanto si el usuario no existe como si
//    existe pero el código está mal, se responde exactamente el mismo
//    mensaje y código HTTP. Además, cuando el usuario no existe, se hace
//    igualmente una comparación de contraseña "de mentira" (contra un
//    hash falso) para que el tiempo de respuesta no delate la diferencia.
//
// 2) El código de recuperación es de un solo uso: en cuanto se usa para
//    restablecer la contraseña, se genera uno NUEVO y se invalida el
//    anterior. El nuevo código se devuelve una vez en la respuesta para
//    que la app se lo vuelva a mostrar al usuario, igual que en el registro.

const { kv } = require('../../lib/kv');
const { randomHex, genRecoveryCode, hashPassword, verifyPassword } = require('../../lib/auth');

// Hash/salt fijos, no correspondientes a ningún código real, solo para que
// la rama "el usuario no existe" tarde aproximadamente lo mismo que la rama
// "el usuario existe pero el código no coincide".
const DUMMY_SALT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const DUMMY_HASH = hashPassword('__no_such_account__', DUMMY_SALT);

const GENERIC_ERROR = 'Usuario o código de recuperación incorrectos.';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  try {
    const { username, code, newPassword } = req.body || {};
    const usernameLower = (username || '').trim().toLowerCase();
    const cleanCode = (code || '').trim().toUpperCase();

    if (!usernameLower || !cleanCode || !newPassword) {
      res.status(400).json({ error: 'Rellena todos los campos.' });
      return;
    }
    if ((newPassword || '').length < 6) {
      res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
      return;
    }

    const id = await kv.get('idx:username:' + usernameLower);
    const user = id ? await kv.get('user:' + id) : null;

    if (!user) {
      // Cuenta inexistente: verificación "de mentira" para igualar el tiempo
      // de respuesta con el caso de cuenta real + código incorrecto.
      verifyPassword(cleanCode, DUMMY_SALT, DUMMY_HASH);
      res.status(401).json({ error: GENERIC_ERROR });
      return;
    }

    if (!verifyPassword(cleanCode, user.recoverySalt, user.recoveryCodeHash)) {
      res.status(401).json({ error: GENERIC_ERROR });
      return;
    }

    // Código correcto: cambia la contraseña...
    user.passwordSalt = randomHex(16);
    user.passwordHash = hashPassword(newPassword, user.passwordSalt);

    // ...y rota el código de recuperación, para que el que se acaba de usar
    // quede invalidado y no pueda reutilizarse.
    const newRecoveryCode = genRecoveryCode();
    user.recoverySalt = randomHex(16);
    user.recoveryCodeHash = hashPassword(newRecoveryCode, user.recoverySalt);

    await kv.set('user:' + user.id, user);

    res.status(200).json({ ok: true, recoveryCode: newRecoveryCode });
  } catch (e) {
    console.error('recover error', e);
    res.status(500).json({ error: 'No se ha podido restablecer la contraseña.' });
  }
};
