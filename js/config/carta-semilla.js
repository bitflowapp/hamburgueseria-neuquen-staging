/*
 * ─────────────────────────────────────────────────────────────────────────────
 * CARTA SEMILLA — ESTRUCTURA REAL, PRECIOS A CONFIRMAR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * QUÉ ES Y QUÉ NO ES
 * ------------------
 * Esto es una carta de ARRANQUE: sirve para que la tienda se pueda ver, probar
 * y demostrar antes de que exista backend. NO es la carta del negocio.
 *
 * Los precios de acá son de referencia y están puestos para que el sistema tenga
 * números con los que operar. El día que el comercio cargue los suyos, esta
 * carta deja de usarse: en producción manda `carta_publica()` de Supabase.
 *
 * LO QUE SÍ ES REAL Y VALE
 * ------------------------
 * La ESTRUCTURA. Las categorías, los grupos de opciones y cómo se combinan
 * salieron de cómo funciona de verdad una hamburguesería:
 *
 *   · una hamburguesa se elige simple / doble / triple, y eso cambia el precio;
 *   · los extras son los mismos para toda la línea (por eso los grupos son
 *     compartidos y no se cargan producto por producto);
 *   · un combo es «hamburguesa + elegí acompañamiento + elegí bebida», no un
 *     producto distinto con precio propio;
 *   · «sin cebolla» no cambia el precio pero TIENE que llegar a la cocina.
 *
 * Nada de esto está hardcodeado en la lógica: son datos, y el panel los edita.
 */

/** Grupos compartidos por toda la línea. Se cargan una vez. */
export const GRUPOS_DE_OPCIONES = Object.freeze([
  {
    id: 'medallones',
    nombre: '¿Cuántos medallones?',
    ayuda: 'Elegí el tamaño',
    tipo: 'variante',
    minimo: 1,
    maximo: 1,
    obligatorio: true,
    opciones: [
      { id: 'simple', nombre: 'Simple', precioDelta: 0, porDefecto: true },
      { id: 'doble', nombre: 'Doble', precioDelta: 2500 },
      { id: 'triple', nombre: 'Triple', precioDelta: 4800 },
    ],
  },
  {
    id: 'punto',
    nombre: 'Punto de la carne',
    tipo: 'variante',
    minimo: 1,
    maximo: 1,
    obligatorio: true,
    opciones: [
      { id: 'jugoso', nombre: 'Jugosa', precioDelta: 0 },
      { id: 'a-punto', nombre: 'A punto', precioDelta: 0, porDefecto: true },
      { id: 'cocida', nombre: 'Bien cocida', precioDelta: 0 },
    ],
  },
  {
    id: 'extras',
    nombre: 'Agregale',
    ayuda: 'Hasta 5 agregados',
    tipo: 'extra',
    minimo: 0,
    maximo: 5,
    opciones: [
      { id: 'cheddar', nombre: 'Cheddar extra', precioDelta: 900 },
      { id: 'bacon', nombre: 'Bacon', precioDelta: 1300 },
      { id: 'huevo', nombre: 'Huevo frito', precioDelta: 700 },
      { id: 'medallon-extra', nombre: 'Medallón extra', precioDelta: 2500 },
      { id: 'cebolla-caramelizada', nombre: 'Cebolla caramelizada', precioDelta: 700 },
      { id: 'salsa-extra', nombre: 'Salsa extra', precioDelta: 500 },
    ],
  },
  {
    id: 'quitar',
    nombre: 'Sacale',
    ayuda: 'No cambia el precio',
    tipo: 'quitar',
    minimo: 0,
    maximo: 6,
    opciones: [
      { id: 'sin-cebolla', nombre: 'Sin cebolla', precioDelta: 0 },
      { id: 'sin-tomate', nombre: 'Sin tomate', precioDelta: 0 },
      { id: 'sin-lechuga', nombre: 'Sin lechuga', precioDelta: 0 },
      { id: 'sin-pepino', nombre: 'Sin pepinos', precioDelta: 0 },
      { id: 'sin-salsa', nombre: 'Sin salsa de la casa', precioDelta: 0 },
    ],
  },
  {
    id: 'acompanamiento',
    nombre: 'Elegí el acompañamiento',
    tipo: 'combo',
    minimo: 1,
    maximo: 1,
    obligatorio: true,
    opciones: [
      { id: 'papas-clasicas', nombre: 'Papas clásicas', precioDelta: 0, porDefecto: true },
      { id: 'papas-cheddar', nombre: 'Papas con cheddar y bacon', precioDelta: 1800 },
      { id: 'aros-cebolla', nombre: 'Aros de cebolla', precioDelta: 900 },
    ],
  },
  {
    id: 'bebida-combo',
    nombre: 'Elegí la bebida',
    tipo: 'combo',
    minimo: 1,
    maximo: 1,
    obligatorio: true,
    opciones: [
      { id: 'gaseosa-linea', nombre: 'Gaseosa línea Coca-Cola 500 ml', precioDelta: 0, porDefecto: true },
      { id: 'agua', nombre: 'Agua sin gas 500 ml', precioDelta: 0 },
      { id: 'limonada', nombre: 'Limonada de la casa', precioDelta: 600 },
      // Sin bebida DESCUENTA. Un delta negativo es legítimo y el motor lo admite.
      { id: 'sin-bebida', nombre: 'Sin bebida', precioDelta: -900 },
    ],
  },
  {
    id: 'salsas-aparte',
    nombre: 'Salsas aparte',
    tipo: 'extra',
    minimo: 0,
    maximo: 4,
    opciones: [
      { id: 'barbacoa', nombre: 'Barbacoa', precioDelta: 400 },
      { id: 'cheddar-liquido', nombre: 'Cheddar', precioDelta: 500 },
      { id: 'alioli', nombre: 'Alioli', precioDelta: 400 },
      { id: 'picante', nombre: 'Picante de la casa', precioDelta: 400 },
    ],
  },
]);

export const CATEGORIAS = Object.freeze([
  { id: 'hamburguesas', nombre: 'Hamburguesas', icono: '🍔', orden: 1 },
  { id: 'combos', nombre: 'Combos', icono: '🍟', orden: 2 },
  { id: 'papas', nombre: 'Papas', icono: '🍟', orden: 3 },
  { id: 'bebidas', nombre: 'Bebidas', icono: '🥤', orden: 4 },
  { id: 'extras', nombre: 'Extras', icono: '➕', orden: 5 },
  { id: 'salsas', nombre: 'Salsas', icono: '🧂', orden: 6 },
  { id: 'promociones', nombre: 'Promos', icono: '🔥', orden: 7 },
]);

const GRUPOS_HAMBURGUESA = ['medallones', 'punto', 'extras', 'quitar'];
const GRUPOS_COMBO = ['medallones', 'punto', 'extras', 'quitar', 'acompanamiento', 'bebida-combo'];

export const PRODUCTOS = Object.freeze([
  // ── Hamburguesas ──────────────────────────────────────────────────────────
  producto({
    id: 'clasica', nombre: 'Clásica', categoria: 'hamburguesas', precio: 7200,
    descripcion: 'Medallón de 160 g, cheddar, lechuga, tomate y salsa de la casa.',
    minutos: 14, grupos: GRUPOS_HAMBURGUESA, orden: 1,
  }),
  producto({
    id: 'bacon-cheese', nombre: 'Bacon Cheese', categoria: 'hamburguesas', precio: 8400,
    descripcion: 'Doble cheddar fundido, bacon crocante y cebolla caramelizada.',
    minutos: 16, grupos: GRUPOS_HAMBURGUESA, insignia: 'Más pedida', orden: 2,
  }),
  producto({
    id: 'la-de-la-casa', nombre: 'La de la Casa', categoria: 'hamburguesas', precio: 9300,
    descripcion: 'Medallón, provoleta a la plancha, rúcula y alioli de ajo asado.',
    minutos: 18, grupos: GRUPOS_HAMBURGUESA, orden: 3,
  }),
  producto({
    id: 'picante', nombre: 'Picante', categoria: 'hamburguesas', precio: 8600,
    descripcion: 'Jalapeños, cheddar y salsa picante de la casa. Pica de verdad.',
    minutos: 16, grupos: GRUPOS_HAMBURGUESA, orden: 4,
  }),
  producto({
    id: 'veggie', nombre: 'Veggie', categoria: 'hamburguesas', precio: 7800,
    descripcion: 'Medallón de garbanzo y remolacha, queso vegano y alioli.',
    minutos: 15, grupos: ['punto', 'extras', 'quitar'], orden: 5,
  }),

  // ── Combos ────────────────────────────────────────────────────────────────
  producto({
    id: 'combo-clasico', nombre: 'Combo Clásica', categoria: 'combos', precio: 11500,
    descripcion: 'Clásica + acompañamiento + bebida.',
    minutos: 18, grupos: GRUPOS_COMBO, insignia: 'Combo', orden: 1,
  }),
  producto({
    id: 'combo-bacon', nombre: 'Combo Bacon Cheese', categoria: 'combos', precio: 12800,
    descripcion: 'Bacon Cheese + acompañamiento + bebida.',
    minutos: 20, grupos: GRUPOS_COMBO, orden: 2,
  }),
  producto({
    id: 'combo-doble', nombre: 'Combo Doble para dos', categoria: 'combos', precio: 22400,
    descripcion: 'Dos hamburguesas, papas grandes para compartir y dos bebidas.',
    minutos: 25, grupos: GRUPOS_COMBO, orden: 3,
  }),

  // ── Papas ─────────────────────────────────────────────────────────────────
  producto({
    id: 'papas-chicas', nombre: 'Papas chicas', categoria: 'papas', precio: 3200,
    descripcion: 'Porción individual.', minutos: 8, grupos: [], orden: 1,
  }),
  producto({
    id: 'papas-grandes', nombre: 'Papas grandes', categoria: 'papas', precio: 4900,
    descripcion: 'Para compartir entre dos.', minutos: 10, grupos: [], orden: 2,
  }),
  producto({
    id: 'papas-cheddar-bacon', nombre: 'Papas cheddar y bacon', categoria: 'papas', precio: 6800,
    descripcion: 'Papas grandes con cheddar fundido y bacon.', minutos: 12, grupos: [], orden: 3,
  }),
  producto({
    id: 'aros-de-cebolla', nombre: 'Aros de cebolla', categoria: 'papas', precio: 4200,
    descripcion: 'Ocho aros rebozados.', minutos: 10, grupos: [], orden: 4,
  }),

  // ── Bebidas: llevan stock porque son unidades contables ───────────────────
  producto({
    id: 'gaseosa-500', nombre: 'Gaseosa 500 ml', categoria: 'bebidas', precio: 2200,
    descripcion: 'Línea Coca-Cola.', minutos: 1, grupos: [], stock: 48, orden: 1,
  }),
  producto({
    id: 'agua-500', nombre: 'Agua sin gas 500 ml', categoria: 'bebidas', precio: 1800,
    minutos: 1, grupos: [], stock: 36, orden: 2,
  }),
  producto({
    id: 'limonada', nombre: 'Limonada de la casa', categoria: 'bebidas', precio: 2900,
    descripcion: 'Con menta y jengibre.', minutos: 4, grupos: [], stock: 20, orden: 3,
  }),
  producto({
    id: 'cerveza-473', nombre: 'Cerveza artesanal 473 ml', categoria: 'bebidas', precio: 4200,
    descripcion: 'Rubia de la Patagonia.', minutos: 1, grupos: [], stock: 24, orden: 4,
  }),

  // ── Extras y salsas ───────────────────────────────────────────────────────
  producto({
    id: 'porcion-cheddar', nombre: 'Porción de cheddar', categoria: 'extras', precio: 1200,
    minutos: 2, grupos: [], orden: 1,
  }),
  producto({
    id: 'porcion-bacon', nombre: 'Porción de bacon', categoria: 'extras', precio: 1600,
    minutos: 4, grupos: [], orden: 2,
  }),
  producto({
    id: 'salsas', nombre: 'Salsas', categoria: 'salsas', precio: 400,
    descripcion: 'Elegí las que quieras.', minutos: 1, grupos: ['salsas-aparte'], orden: 1,
  }),
]);

/** La carta completa, ya con los grupos resueltos por producto. */
export function cartaSemilla() {
  const porId = new Map(GRUPOS_DE_OPCIONES.map((grupo) => [grupo.id, grupo]));
  return {
    categorias: CATEGORIAS.map((categoria) => ({ ...categoria })),
    productos: PRODUCTOS.map((item) => ({
      ...item,
      grupos: item.gruposIds.map((id) => porId.get(id)).filter(Boolean),
    })),
  };
}

/**
 * La foto de un producto se DERIVA de su identificador.
 *
 * `assets/carta/<id>.webp`, y al lado `<id>-sm.webp` para pantallas chicas. Las
 * genera `scripts/preparar-imagenes.mjs` desde el registro de derechos de
 * `assets/carta/fuentes.json`, que declara que hoy son fotos de referencia con
 * licencia y no fotos del local.
 *
 * Se deriva en vez de escribirse producto por producto porque una ruta copiada
 * a mano es una ruta que queda apuntando al producto de al lado el día que se
 * renombra algo, y una foto equivocada en una carta es un plato equivocado.
 *
 * La ruta es RELATIVA A LA RAÍZ DE LA APP, no al documento: la tienda vive en
 * `/` y el panel en `/panel/`, y una ruta relativa al documento se rompe en uno
 * de los dos. Quien la dibuja la resuelve con `js/core/rutas.js`.
 *
 * Declaración y no `const`: `PRODUCTOS` se construye más arriba en este mismo
 * archivo y una función flecha asignada acá abajo todavía no existiría cuando
 * la llama. Una declaración se iza; un `const` deja una zona muerta.
 */
export function rutaDeFoto(id) {
  return `assets/carta/${id}.webp`;
}

function producto({
  id, nombre, categoria, precio, descripcion = '', minutos = 15,
  grupos = [], stock = null, insignia = '', orden = 0,
}) {
  return Object.freeze({
    id,
    nombre,
    categoria,
    descripcion,
    precio,
    estadoPrecio: 'confirmed',
    // La cocina prepara al momento: sólo lo contable lleva stock. La distinción
    // importa porque «sin stock» y «no lo contamos» son cosas distintas.
    controlaStock: stock !== null,
    stock,
    agotado: false,
    disponible: true,
    minutosPreparacion: minutos,
    insignia,
    orden,
    imagen: rutaDeFoto(id),
    gruposIds: grupos,
  });
}
