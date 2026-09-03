/*
 * ─────────────────────────────────────────────────────────────────────────────
 * VARIANTES Y EXTRAS — EL MOTOR QUE TABA NO TENÍA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * QUÉ PROBLEMA RESUELVE
 * ---------------------
 * TABA vende SKU: una lata de Heineken es una lata de Heineken. Su línea de
 * pedido es `producto × cantidad`, y eso está impuesto por un CHECK de
 * PostgreSQL: `subtotal = quantity * unit_price`.
 *
 * Una hamburguesería no vende SKU: vende CONFIGURACIONES.
 *
 *     Doble Bacon               $ 5.900
 *       + cheddar extra           $ 800
 *       + huevo                   $ 600
 *       − cebolla                    —
 *     ─────────────────────────────────
 *     precio unitario           $ 7.300
 *
 * El precio unitario de una línea es `base + Σ(deltas elegidos)`. Nada de esto
 * está hardcodeado: los grupos y las opciones son datos, editables desde el
 * panel, y este módulo sólo sabe las REGLAS.
 *
 * DOS CLASES DE GRUPO, UNA SOLA MECÁNICA
 * --------------------------------------
 * · `variante`  — se elige exactamente una. Simple / Doble / Triple.
 *                 Es `min=1, max=1, obligatorio`.
 * · `extra`     — se eligen cero o varias. Cheddar, bacon, huevo.
 *                 Es `min=0, max=N`.
 * · `quitar`    — sacar algo que viene incluido. Delta 0 y no cambia el precio,
 *                 pero SÍ tiene que llegar a la cocina.
 * · `combo`     — elegir el acompañamiento o la bebida de un combo.
 *
 * Las cuatro son el mismo objeto con distintos límites. No hay ramas especiales
 * por tipo en el cálculo: el tipo sólo cambia cómo se dibuja y qué defaults trae.
 *
 * QUIÉN FIJA EL PRECIO
 * --------------------
 * Este módulo calcula para PODER MOSTRAR el total antes de pagar. La autoridad
 * es el servidor: `crear_pedido` vuelve a derivar cada delta desde
 * `menu_options` y si los dos números no coinciden, **manda el servidor y el
 * pedido se rechaza** en vez de cobrar de menos. Es la misma doctrina que TABA
 * aplica a `products.price`, extendida a los modificadores — sin ella, el
 * navegador podría proponer un cheddar de $ 0.
 *
 * PENDIENTE ≠ GRATIS
 * ------------------
 * Igual que en el precio del producto, una opción sin precio confirmado NO vale
 * cero: bloquea la línea. `Number(null)` es 0 en JavaScript y esa coincidencia
 * ya costó plata en otros proyectos.
 */

import { normalizeMoneyValue } from './precios.js';
import { sanitizeText } from './validators.js';

export const TIPOS_DE_GRUPO = Object.freeze(['variante', 'extra', 'quitar', 'combo']);

/** Límites por defecto de cada tipo. Un grupo puede sobreescribirlos. */
const LIMITES_POR_TIPO = Object.freeze({
  variante: Object.freeze({ minimo: 1, maximo: 1, obligatorio: true }),
  extra: Object.freeze({ minimo: 0, maximo: 20, obligatorio: false }),
  quitar: Object.freeze({ minimo: 0, maximo: 20, obligatorio: false }),
  combo: Object.freeze({ minimo: 1, maximo: 1, obligatorio: true }),
});

export function normalizarTipoDeGrupo(valor) {
  const tipo = String(valor ?? '').trim().toLowerCase();
  return TIPOS_DE_GRUPO.includes(tipo) ? tipo : 'extra';
}

/**
 * Una opción concreta: «cheddar extra, +$800».
 *
 * `precioDelta` puede ser 0 (una opción sin costo es legítima: «sin cebolla»,
 * «punto jugoso») pero NO puede ser ausente. La ausencia se declara con
 * `precioPendiente: true` y bloquea, no vale cero.
 */
export function normalizarOpcion(cruda = {}, indice = 0) {
  const id = sanitizeText(cruda.id ?? cruda.optionId, { fallback: '', maxLength: 80 });
  if (!id) return null;

  const deltaCrudo = cruda.precioDelta ?? cruda.price_delta ?? cruda.priceDelta;
  const declaradaPendiente = cruda.precioPendiente === true || cruda.price_pending === true;
  const deltaNumerico = Number(deltaCrudo);
  // Ausencia real: null, undefined, '' o algo que no es número. El cero
  // explícito NO es ausencia.
  const faltaElDato = deltaCrudo == null
    || (typeof deltaCrudo === 'string' && deltaCrudo.trim() === '')
    || !Number.isFinite(deltaNumerico);

  return Object.freeze({
    id,
    nombre: sanitizeText(cruda.nombre ?? cruda.name, { fallback: 'Opción', maxLength: 80 }),
    // Un delta negativo es legítimo: un combo puede descontar por llevarlo sin
    // bebida. Por eso NO se usa normalizeMoneyValue acá (recorta a >= 0).
    precioDelta: faltaElDato ? 0 : Math.round(deltaNumerico),
    precioPendiente: declaradaPendiente || faltaElDato,
    porDefecto: cruda.porDefecto === true || cruda.is_default === true,
    disponible: cruda.disponible !== false && cruda.is_available !== false,
    // Insumo que consume esta opción, para el descuento de stock. Opcional:
    // mientras no exista el módulo de insumos, la opción se vende igual.
    insumoId: sanitizeText(cruda.insumoId ?? cruda.inventory_item_id, { fallback: '', maxLength: 80 }),
    orden: ordenDeclarado(cruda, indice),
  });
}

/*
 * El orden de una carta lo decide quien la escribe, no el alfabeto.
 *
 * Sin `orden` explícito, el orden implícito es el de DECLARACIÓN. Ordenar por
 * nombre parecía inofensivo hasta que un test lo mostró: «Simple, Doble, Triple»
 * se convertía en «Doble, Simple, Triple», y la selección por defecto de una
 * variante obligatoria terminaba eligiendo la primera alfabética —«A punto»— en
 * vez de la primera que el comercio escribió.
 */
function ordenDeclarado(crudo, indice) {
  const declarado = Number(crudo?.orden ?? crudo?.sort_order);
  return Number.isFinite(declarado) ? declarado : indice;
}

/**
 * Un grupo de opciones: «¿Cuántos medallones?» o «Agregá extras».
 */
export function normalizarGrupo(crudo = {}, indice = 0) {
  const id = sanitizeText(crudo.id ?? crudo.groupId, { fallback: '', maxLength: 80 });
  if (!id) return null;

  const tipo = normalizarTipoDeGrupo(crudo.tipo ?? crudo.kind);
  const limites = LIMITES_POR_TIPO[tipo];

  const opciones = (Array.isArray(crudo.opciones ?? crudo.options) ? (crudo.opciones ?? crudo.options) : [])
    .map((opcion, posicion) => normalizarOpcion(opcion, posicion))
    .filter(Boolean)
    .sort((a, b) => a.orden - b.orden);

  const minimo = enteroNoNegativo(crudo.minimo ?? crudo.min_select, limites.minimo);
  // El máximo nunca puede ser menor que el mínimo: sería un grupo imposible de
  // satisfacer, y el cliente quedaría trabado sin entender por qué.
  const maximo = Math.max(minimo, enteroNoNegativo(crudo.maximo ?? crudo.max_select, limites.maximo));

  return Object.freeze({
    id,
    nombre: sanitizeText(crudo.nombre ?? crudo.name, { fallback: 'Opciones', maxLength: 80 }),
    ayuda: sanitizeText(crudo.ayuda ?? crudo.help_text, { fallback: '', maxLength: 160 }),
    tipo,
    minimo,
    maximo,
    obligatorio: crudo.obligatorio ?? crudo.is_required ?? limites.obligatorio,
    // Permite elegir la misma opción más de una vez («doble cheddar»).
    permiteRepetir: crudo.permiteRepetir === true || crudo.allows_repeat === true,
    orden: ordenDeclarado(crudo, indice),
    opciones,
  });
}

export function normalizarGrupos(crudos = []) {
  return (Array.isArray(crudos) ? crudos : [])
    .map((grupo, indice) => normalizarGrupo(grupo, indice))
    .filter(Boolean)
    .sort((a, b) => a.orden - b.orden);
}

/**
 * Selección inicial de un producto: lo que viene marcado por defecto.
 *
 * Una variante obligatoria sin default explícito toma la primera opción
 * disponible. Sin esto el cliente abre la ficha y el botón «Agregar» está
 * apagado sin que nada explique por qué.
 */
export function seleccionPorDefecto(grupos = []) {
  const seleccion = {};
  for (const grupo of normalizarGrupos(grupos)) {
    const disponibles = grupo.opciones.filter((opcion) => opcion.disponible && !opcion.precioPendiente);
    const marcadas = disponibles.filter((opcion) => opcion.porDefecto);
    if (marcadas.length) {
      seleccion[grupo.id] = marcadas.slice(0, grupo.maximo).map((opcion) => opcion.id);
    } else if (grupo.obligatorio && grupo.minimo > 0 && disponibles.length) {
      seleccion[grupo.id] = disponibles.slice(0, grupo.minimo).map((opcion) => opcion.id);
    } else {
      seleccion[grupo.id] = [];
    }
  }
  return seleccion;
}

/**
 * Valida y resuelve una selección contra los grupos del producto.
 *
 * Devuelve SIEMPRE un objeto: una selección inválida se tiene que poder
 * explicar, no sólo rechazar. `problemas` viene con texto que se le puede
 * mostrar a una persona tal cual.
 */
export function resolverSeleccion(grupos = [], seleccionCruda = {}) {
  const normalizados = normalizarGrupos(grupos);
  const problemas = [];
  const elegidas = [];
  let deltaTotal = 0;

  for (const grupo of normalizados) {
    const porId = new Map(grupo.opciones.map((opcion) => [opcion.id, opcion]));
    const pedidas = Array.isArray(seleccionCruda?.[grupo.id])
      ? seleccionCruda[grupo.id].map((valor) => sanitizeText(valor, { fallback: '', maxLength: 80 })).filter(Boolean)
      : [];

    const vistas = new Set();
    const validas = [];

    for (const opcionId of pedidas) {
      const opcion = porId.get(opcionId);
      if (!opcion) {
        problemas.push(`${grupo.nombre}: la opción elegida ya no existe.`);
        continue;
      }
      if (!opcion.disponible) {
        problemas.push(`${grupo.nombre}: «${opcion.nombre}» no está disponible.`);
        continue;
      }
      // Pendiente NO es gratis: bloquea. Ver el encabezado.
      if (opcion.precioPendiente) {
        problemas.push(`${grupo.nombre}: «${opcion.nombre}» todavía no tiene precio confirmado.`);
        continue;
      }
      if (!grupo.permiteRepetir && vistas.has(opcionId)) {
        problemas.push(`${grupo.nombre}: «${opcion.nombre}» no se puede elegir dos veces.`);
        continue;
      }
      vistas.add(opcionId);
      validas.push(opcion);
    }

    if (validas.length < grupo.minimo) {
      problemas.push(
        grupo.minimo === 1
          ? `${grupo.nombre}: elegí una opción.`
          : `${grupo.nombre}: elegí al menos ${grupo.minimo}.`,
      );
    }
    if (validas.length > grupo.maximo) {
      problemas.push(`${grupo.nombre}: podés elegir hasta ${grupo.maximo}.`);
      validas.length = grupo.maximo;
    }

    for (const opcion of validas) {
      deltaTotal += opcion.precioDelta;
      elegidas.push({
        grupoId: grupo.id,
        grupoNombre: grupo.nombre,
        grupoTipo: grupo.tipo,
        opcionId: opcion.id,
        opcionNombre: opcion.nombre,
        precioDelta: opcion.precioDelta,
        insumoId: opcion.insumoId,
      });
    }
  }

  // Un grupo que llegó en la selección pero no existe en el producto es una
  // selección corrupta (catálogo cambiado, sesión vieja), no algo a ignorar en
  // silencio.
  const idsConocidos = new Set(normalizados.map((grupo) => grupo.id));
  for (const clave of Object.keys(seleccionCruda || {})) {
    if (!idsConocidos.has(clave) && Array.isArray(seleccionCruda[clave]) && seleccionCruda[clave].length) {
      problemas.push('El producto cambió desde que armaste esta selección. Revisala.');
      break;
    }
  }

  return {
    valida: problemas.length === 0,
    problemas,
    elegidas,
    deltaTotal,
  };
}

/**
 * Precio unitario de una línea configurada: base + deltas.
 *
 * Nunca baja de cero. Una promo mal cargada con deltas negativos que superan la
 * base produciría un precio negativo, y un pedido con total negativo es plata
 * saliendo del local.
 */
export function precioUnitarioConfigurado(precioBase, deltaTotal = 0) {
  const base = normalizeMoneyValue(precioBase, 0);
  const delta = Number.isFinite(Number(deltaTotal)) ? Math.round(Number(deltaTotal)) : 0;
  return Math.max(0, base + delta);
}

/**
 * Clave estable de una línea del carrito.
 *
 * ES LA PIEZA QUE HACE QUE EL CARRITO DE TABA NO SIRVA TAL CUAL. Su carrito
 * indexa por `productId`, así que dos hamburguesas del mismo producto con
 * extras distintos serían la misma línea y una pisaría a la otra. Acá la
 * identidad de la línea es «producto + lo que se eligió».
 *
 * El orden se normaliza para que la misma configuración cargada en distinto
 * orden dé la MISMA clave: si no, agregar dos veces «Doble + cheddar» crearía
 * dos líneas de 1 en vez de una de 2.
 */
export function claveDeLinea(productoId, elegidas = []) {
  const base = sanitizeText(productoId, { fallback: '', maxLength: 80 });
  if (!elegidas.length) return base;
  const firma = [...elegidas]
    .map((eleccion) => `${eleccion.grupoId}:${eleccion.opcionId}`)
    .sort()
    .join('|');
  return `${base}#${firma}`;
}

/**
 * Resumen legible de las opciones de una línea, para la cocina y el ticket.
 *
 * La cocina lee esto de un vistazo y no puede depender de colores ni de tocar
 * nada: los agregados llevan «+» y los quitados «−».
 */
export function resumenDeOpciones(elegidas = []) {
  const nombradora = varianteQueNombra(elegidas);
  return elegidas.map((eleccion) => ({
    texto: `${eleccion.grupoTipo === 'quitar' ? '−' : '+'} ${eleccion.opcionNombre}`,
    tipo: eleccion.grupoTipo,
    // Sólo la variante que YA está en el nombre de la línea deja de destacarse.
    // Las demás —el punto de cocción, por ejemplo— son instrucciones para la
    // cocina y tienen que verse.
    destacada: eleccion !== nombradora,
    precioDelta: eleccion.precioDelta,
  }));
}

/**
 * Cuál de las opciones elegidas ES el nombre de la línea.
 *
 * Existe como función propia —y no como un `find` repetido en dos archivos—
 * porque el nombre y la comanda TIENEN que estar de acuerdo sobre esto. Cuando
 * no lo estaban, la comanda filtraba todas las variantes y el punto de cocción
 * («Jugosa») no aparecía ni en el nombre ni en los modificadores: la plancha se
 * enteraba del tamaño pero nunca de cómo cocinarla.
 *
 * Un producto puede tener VARIOS grupos de variante —tamaño y punto son los dos
 * casos normales— y sólo el PRIMERO nombra la línea. El resto son instrucciones
 * y van a la comanda.
 */
export function varianteQueNombra(elegidas = []) {
  return elegidas.find((eleccion) => eleccion.grupoTipo === 'variante') || null;
}

/** Nombre completo de la línea: producto + variante que nombra. */
export function nombreDeLinea(nombreProducto, elegidas = []) {
  const variante = varianteQueNombra(elegidas);
  const base = sanitizeText(nombreProducto, { fallback: 'Producto', maxLength: 100 });
  return variante ? `${base} ${variante.opcionNombre}` : base;
}

function enteroNoNegativo(valor, porDefecto) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) return porDefecto;
  return Math.floor(numero);
}
