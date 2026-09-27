/**
 * ORGANIZATOR — Tests de SYNC paso 4 (js/sync-merge.js, fusión a tres bandas)
 *
 * Suite Node pura: require() del módulo real tal cual está en disco.
 * Escenario de fondo en todos los casos: el mismo usuario edita en dos
 * dispositivos ("móvil" = local, "PC" = remote) partiendo de la misma
 * versión común (base) — y el móvil, al guardar, descubre que el PC ya
 * guardó antes.
 *
 * Incluye una prueba aleatoria (semilla fija, reproducible) que genera
 * cientos de combinaciones de altas/ediciones/borrados en ambos lados y
 * comprueba las reglas sobre cada resultado.
 *
 * Uso:  node js/test-sync-merge.js
 * Sale con código 0 si todo pasa, 1 si algo falla.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SyncMerge = require('./sync-merge.js');
const { threeWayMerge: merge, deepEqual } = SyncMerge;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n${title}`); }
const ids = (list) => list.map(x => x.id);
const byId = (list, id) => list.find(x => x.id === id);

const T = (id, title, extra) => Object.assign({ id, title, done: false }, extra || {});
const BASE = [T('a', 'Comprar pan'), T('b', 'Estudiar biología'), T('c', 'Llamar a mamá')];

section('A) Atajos y pureza');
{
  const local = [T('a', 'Comprar pan'), T('b', 'Estudiar biología', { done: true }), T('c', 'Llamar a mamá')];
  check('A1. solo cambió local -> el resultado es exactamente local', deepEqual(merge(BASE, local, BASE), local));
  const reordered = [BASE[2], BASE[0], BASE[1]];
  check('A2. solo cambió local (reordenar) -> se respeta su orden', deepEqual(ids(merge(BASE, reordered, BASE)), ['c', 'a', 'b']));
  const remote = [...BASE, T('d', 'Desde el PC')];
  check('A3. solo cambió remote -> el resultado es exactamente remote', deepEqual(merge(BASE, BASE, remote), remote));
  check('A4. local y remote iguales -> ese mismo valor', deepEqual(merge(BASE, remote, remote), remote));

  const snapshot = JSON.stringify([BASE, local, remote]);
  const out = merge(BASE, local, remote);
  check('A5. nunca modifica sus argumentos', JSON.stringify([BASE, local, remote]) === snapshot);
  check('A6. devuelve un valor nuevo (no la misma referencia que ningún argumento)', out !== local && out !== remote && out !== BASE);
  out[0].title = 'mutado';
  check('A7. modificar el resultado no afecta a los argumentos', remote[0].title === 'Comprar pan' && local[0].title === 'Comprar pan');
}

section('B) Listas por id');
{
  const local = [...BASE, T('m1', 'Desde el móvil')];
  const remote = [...BASE, T('p1', 'Desde el PC')];
  const out = merge(BASE, local, remote);
  check('B1. altas en ambos lados -> se conservan las dos', !!byId(out, 'm1') && !!byId(out, 'p1') && out.length === 5);
  check('B2. orden: el de remote y las altas locales al final', deepEqual(ids(out), ['a', 'b', 'c', 'p1', 'm1']));
}
{
  const local = [T('a', 'Comprar pan integral'), BASE[1], BASE[2]];
  const remote = [BASE[0], T('b', 'Estudiar biología', { done: true }), BASE[2]];
  const out = merge(BASE, local, remote);
  check('B3. ediciones en elementos distintos -> se aplican las dos', byId(out, 'a').title === 'Comprar pan integral' && byId(out, 'b').done === true);
}
{
  const local = [T('a', 'Título del móvil'), BASE[1], BASE[2]];
  const remote = [T('a', 'Título del PC'), BASE[1], BASE[2]];
  check('B4. mismo elemento editado en ambos -> gana local', byId(merge(BASE, local, remote), 'a').title === 'Título del móvil');
}
{
  const remoteAdd = [...BASE, T('p1', 'Desde el PC')];
  const out = merge(BASE, [BASE[0], BASE[2]], remoteAdd);
  check('B5. borrado local (remote sin tocarlo) -> se borra, y el alta remota se conserva', !byId(out, 'b') && !!byId(out, 'p1'));
  const out2 = merge(BASE, [BASE[0], BASE[2]], [BASE[0], T('b', 'Editado en el PC'), BASE[2]]);
  check('B6. borrado local de algo editado en remote -> se borra (no resucita)', !byId(out2, 'b') && out2.length === 2);
  const out3 = merge(BASE, [BASE[0], BASE[1], BASE[2], T('m1', 'x')], [BASE[0], BASE[2]]);
  check('B7. borrado remoto (local sin tocarlo) -> se borra, y el alta local se conserva', !byId(out3, 'b') && !!byId(out3, 'm1'));
  const out4 = merge(BASE, [BASE[0], T('b', 'Editado en el móvil'), BASE[2], T('m1', 'x')], [BASE[0], BASE[2]]);
  check('B8. borrado remoto de algo editado en local -> se borra (el borrado gana)', !byId(out4, 'b'));
  const out5 = merge(BASE, [BASE[0], BASE[2], T('m1', 'x')], [BASE[0], BASE[2], T('p1', 'y')]);
  check('B9. borrado en ambos lados -> borrado una sola vez, sin errores', !byId(out5, 'b') && out5.length === 4);
}
{
  const same = T('n', 'Nueva');
  const out = merge(BASE, [...BASE, same, T('m1', 'x')], [...BASE, same]);
  check('B10. la misma alta en ambos lados -> una sola copia', out.filter(x => x.id === 'n').length === 1 && !!byId(out, 'm1'));
  const out2 = merge(BASE, [...BASE, T('n', 'versión móvil'), T('m1', 'x')], [...BASE, T('n', 'versión PC')]);
  check('B11. misma id añadida con contenido distinto -> gana local', byId(out2, 'n').title === 'versión móvil' && out2.filter(x => x.id === 'n').length === 1);
}
{
  const base = ['lunes', 'martes'];
  const out = merge(base, ['lunes', 'martes', 'miércoles'], ['lunes', 'jueves']);
  check('B12. elementos sin id: altas por contenido, borrados respetados', deepEqual(out, ['lunes', 'jueves', 'miércoles']));
  const noIdObjs = [{ title: 'sin id' }];
  const out2 = merge(noIdObjs, [{ title: 'sin id' }, { title: 'otro' }], [{ title: 'sin id' }, { title: 'otro' }, { title: 'más' }]);
  check('B13. objetos sin id: la misma alta en ambos lados no se duplica', out2.filter(x => x.title === 'otro').length === 1 && out2.length === 3);
  const out3 = merge([], [{ id: '', t: 1 }, { id: null, t: 2 }], [{ id: '', t: 3 }]);
  check('B14. ids vacíos/null se tratan como "sin id" (no se confunden entre sí)', out3.length === 3);
}
{
  const reminders = [{ id: 'r1', status: 'pending' }, { id: 'r2', status: 'pending' }];
  const local = [{ id: 'r1', status: 'triggered' }, { id: 'r2', status: 'pending' }];
  const remote = [{ id: 'r1', status: 'pending' }, { id: 'r2', status: 'cancelled' }];
  const out = merge(reminders, local, remote);
  check('B15. reminders: el estado cambiado en cada lado se conserva', byId(out, 'r1').status === 'triggered' && byId(out, 'r2').status === 'cancelled');
}
{
  const remote = [T('a', 'uno'), T('a', 'repetido'), T('b', 'dos')];
  const out = merge(null, [T('m1', 'x')], remote);
  check('B16. ids repetidos en remote (datos antiguos): no se pierde ninguno', out.length === 4 && out.filter(x => x.id === 'a').length === 2);
  const out2 = merge([], [T('1', 'texto')], [{ id: 1, title: 'número' }]);
  check('B17. id "1" (texto) e id 1 (número) cuentan como el mismo id (gana local)', out2.length === 1 && out2[0].title === 'texto');
}

section('C) Sin versión común (base null: primera subida con datos ya en el servidor)');
{
  const local = [T('a', 'Comprar pan (móvil)'), T('m1', 'Solo en el móvil')];
  const remote = [T('a', 'Comprar pan (PC)'), T('p1', 'Solo en el PC')];
  const out = merge(null, local, remote);
  check('C1. unión: no se pierde nada de ningún lado', !!byId(out, 'm1') && !!byId(out, 'p1') && out.length === 3);
  check('C2. mismo id en ambos -> gana local', byId(out, 'a').title === 'Comprar pan (móvil)');
  check('C3. base undefined se comporta igual que null', deepEqual(merge(undefined, local, remote), out));
}

section('D) Remote ausente o con forma inesperada');
{
  check('D1. remote null (la clave no está en el servidor) -> se conserva local entero', deepEqual(merge(BASE, [BASE[0]], null), [BASE[0]]));
  check('D2. remote null con base: NO se interpreta como "lo borraron todo"', merge(BASE, BASE, null).length === 3);
  check('D3. remote con otra forma (objeto en vez de lista) -> se conserva local', deepEqual(merge(BASE, BASE, { raro: 1 }), BASE));
  check('D4. objetos: remote null -> se conserva local', deepEqual(merge({ a: 1 }, { a: 2 }, null), { a: 2 }));
  check('D5. local con forma inesperada -> se devuelve local tal cual', merge(null, 'texto', [1]) === 'texto');
}

section('E) Objetos (settingsPrefs / settingsIA), propiedad a propiedad');
{
  const base = { defaultHome: 'inicio', showCompletedTasks: true, dayStartHour: 8 };
  const local = { defaultHome: 'calendario', showCompletedTasks: true, dayStartHour: 8 };
  const remote = { defaultHome: 'inicio', showCompletedTasks: false, dayStartHour: 8 };
  const out = merge(base, local, remote);
  check('E1. propiedades distintas cambiadas en cada lado -> se aplican las dos', out.defaultHome === 'calendario' && out.showCompletedTasks === false && out.dayStartHour === 8);
  const out2 = merge(base, { ...base, dayStartHour: 7 }, { ...base, dayStartHour: 9 });
  check('E2. misma propiedad cambiada en ambos -> gana local', out2.dayStartHour === 7);
  const { dayStartHour, ...withoutHour } = base;
  const out3 = merge(base, withoutHour, { ...base, showCompletedTasks: false });
  check('E3. propiedad quitada en local -> desaparece', !('dayStartHour' in out3) && out3.showCompletedTasks === false);
  const out4 = merge(base, { ...base, nueva: 1 }, { ...base, otra: 2 });
  check('E4. propiedades nuevas en ambos lados -> se conservan las dos', out4.nueva === 1 && out4.otra === 2);
  const out5 = merge({ n: { x: 1, y: 1 } }, { n: { x: 2, y: 1 } }, { n: { x: 1, y: 2 } });
  check('E5. valores anidados se tratan como un todo (gana local si ambos cambian)', deepEqual(out5.n, { x: 2, y: 1 }));
  check('E6. base null -> unión, gana local en empates', deepEqual(merge(null, { a: 1, b: 1 }, { a: 2, c: 3 }), { a: 1, c: 3, b: 1 }));
  check('E7. el orden de las claves no cuenta como cambio', deepEqual(merge(base, { dayStartHour: 8, showCompletedTasks: true, defaultHome: 'inicio' }, remote), remote));
}

section('F) Estabilidad');
{
  const local = [...BASE.slice(1), T('m1', 'móvil')];
  const remote = [T('a', 'editado PC'), ...BASE.slice(1), T('p1', 'PC')];
  const out = merge(BASE, local, remote);
  check('F1. determinista: misma entrada -> mismo resultado', deepEqual(merge(BASE, local, remote), out));
  check('F2. fusionar de nuevo con el resultado ya subido no cambia nada', deepEqual(merge(remote, out, out), out));
  check('F3. si el otro dispositivo parte del resultado y no toca nada, se queda igual', deepEqual(merge(out, out, out), out));
}

section('G) Prueba aleatoria: 500 escenarios móvil/PC con semilla fija');
{
  let seed = 20260927;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (n) => Math.floor(rnd() * n);
  let violations = 0;
  const firstViolation = [];
  for (let s = 0; s < 500; s++) {
    const base = Array.from({ length: 3 + pick(8) }, (_, i) => T(`b${i}`, `base ${i}`));
    const local = JSON.parse(JSON.stringify(base));
    const remote = JSON.parse(JSON.stringify(base));
    const expect = { mustExist: new Map(), mustNotExist: new Set() };
    for (const item of base) {
      // Qué hace cada lado con este elemento: 0 nada, 1 editar, 2 borrar.
      const lo = pick(3), ro = pick(3);
      const li = local.findIndex(x => x.id === item.id);
      if (lo === 1) local[li] = { ...local[li], title: `móvil ${item.id}` };
      if (lo === 2) local.splice(li, 1);
      const ri = remote.findIndex(x => x.id === item.id);
      if (ro === 1) remote[ri] = { ...remote[ri], title: `PC ${item.id}` };
      if (ro === 2) remote.splice(ri, 1);
      if (lo === 2 || ro === 2) expect.mustNotExist.add(item.id);
      else if (lo === 1) expect.mustExist.set(item.id, `móvil ${item.id}`);
      else if (ro === 1) expect.mustExist.set(item.id, `PC ${item.id}`);
      else expect.mustExist.set(item.id, item.title);
    }
    for (let k = pick(3); k > 0; k--) { const id = `m${s}-${k}`; local.push(T(id, id)); expect.mustExist.set(id, id); }
    for (let k = pick(3); k > 0; k--) { const id = `p${s}-${k}`; remote.push(T(id, id)); expect.mustExist.set(id, id); }

    const out = merge(base, local, remote);
    const problems = [];
    for (const [id, title] of expect.mustExist) {
      const found = out.filter(x => x.id === id);
      if (found.length !== 1 || found[0].title !== title) problems.push(`${id}: esperado "${title}", obtenido ${JSON.stringify(found.map(x => x.title))}`);
    }
    for (const id of expect.mustNotExist) if (byId(out, id)) problems.push(`${id}: debería estar borrado`);
    if (out.length !== expect.mustExist.size) problems.push(`tamaño ${out.length} != ${expect.mustExist.size}`);
    if (problems.length) { violations++; if (firstViolation.length === 0) firstViolation.push(`escenario ${s}: ${problems.join('; ')}`); }
  }
  check(`G1. en los 500 escenarios: altas conservadas, ediciones correctas, borrados respetados, sin duplicados${violations ? `   [${violations} fallos; ${firstViolation[0]}]` : ''}`, violations === 0);
}

section('H) Carga en el navegador (sin module.exports)');
{
  const src = fs.readFileSync(path.join(__dirname, 'sync-merge.js'), 'utf8');
  const win = {};
  win.self = win; win.window = win;
  vm.createContext(win);
  vm.runInContext(src, win, { filename: 'js/sync-merge.js' });
  check('H1. expone self.SyncMerge con threeWayMerge', !!win.SyncMerge && typeof win.SyncMerge.threeWayMerge === 'function');
  check('H2. funciona igual que en Node', deepEqual(win.SyncMerge.threeWayMerge(BASE, BASE, [...BASE, T('p1', 'x')]), [...BASE, T('p1', 'x')]));
}

console.log(`\n${pass} ✅  ·  ${fail} ❌`);
process.exit(fail ? 1 : 0);
