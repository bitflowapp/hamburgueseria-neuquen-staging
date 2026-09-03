/*
 * ─────────────────────────────────────────────────────────────────────────────
 * CARRITO — INDEXADO POR LÍNEA CONFIGURADA, NO POR PRODUCTO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PROCEDENCIA: adaptado de `js/cart.js` de TABA (la-taba-pages-preview @ 523d3d0).
 *
 * POR QUÉ NO SE PUDO COPIAR TAL CUAL
 * ----------------------------------
 * El carrito de TABA indexa por `productId`: `addToCart(productId, quantity)`,
 * `incrementCartItem(productId)`, `removeCartItem(productId)`. Para una tienda
 * de bebidas eso es exacto —dos latas de la misma cerveza son la misma línea—,
 * pero acá rompe:
 *
 *     Doble Bacon + cheddar          ┐  con el índice de TABA, la segunda
 *     Doble Bacon sin cebolla        ┘  pisaba a la primera.
 *
 * La identidad de una línea es «producto + lo que se eligió». Eso es
 * `claveDeLinea()` en modificadores.js, y es la diferencia estructural entre
 * vender SKU y vender configuraciones.
 *
 * QUÉ SÍ SE CONSERVA DE TABA
 * --------------------------
 * · El carrito es estado puro: entra un estado, sale un estado nuevo. Sin DOM,
 *   sin fetch, sin singletons. Todo testeable sin navegador.
 * · La reconciliación contra el catálogo VIVO: una línea guardada ayer puede
 *   referirse a un producto que ya no existe, subió de precio o se agotó. El
 *   carrito nunca miente sobre eso; lo marca y deja que la UI lo explique.
 * · Los precios que guarda son informativos. Al cobrar manda el servidor.
 */

import { claveDeLinea, nombreDeLinea, precioUnitarioConfigurado, resolverSeleccion } from './modificadores.js';
import {
  calcularTotales,
  estaAgotado,
  normalizeQuantity,
  precioConfirmado,
  precioPendiente,
  sePuedeComprar,
  stockConocido,
} from './precios.js';

export const MAXIMO_POR_LINEA = 20;
export const MAXIMO_DE_LINEAS = 40;

export function carritoVacio() {
  return { lineas: [] };
}

/**
 * Agrega una configuración al carrito.
 *
 * Devuelve `{ ok, carrito, problemas, claveLinea }`. Nunca lanza: un carrito que
 * explota deja al cliente sin pedido y sin explicación.
 */
export function agregarAlCarrito(carrito, producto, { seleccion = {}, cantidad = 1, notas = '' } = {}) {
  const actual = normalizarCarrito(carrito);
  if (!producto || !producto.id) {
    return { ok: false, carrito: actual, problemas: ['Producto desconocido.'], claveLinea: '' };
  }
  if (!sePuedeComprar(producto)) {
    return {
      ok: false,
      carrito: actual,
      problemas: [precioPendiente(producto)
        ? 'Este producto todavía no tiene precio confirmado.'
        : 'Este producto no está disponible ahora.'],
      claveLinea: '',
    };
  }

  const resuelta = resolverSeleccion(producto.grupos || [], seleccion);
  if (!resuelta.valida) {
    return { ok: false, carrito: actual, problemas: resuelta.problemas, claveLinea: '' };
  }

  const clave = claveDeLinea(producto.id, resuelta.elegidas);
  const pedida = normalizeQuantity(cantidad, 1);
  const existente = actual.lineas.find((linea) => linea.clave === clave);

  if (!existente && actual.lineas.length >= MAXIMO_DE_LINEAS) {
    return { ok: false, carrito: actual, problemas: ['El pedido llegó al máximo de productos distintos.'], claveLinea: '' };
  }

  const yaEnCarrito = existente?.cantidad || 0;
  const tope = topeDeUnidades(producto, clave, actual);
  if (yaEnCarrito >= tope) {
    return {
      ok: false,
      carrito: actual,
      problemas: [tope === 0 ? 'Sin stock disponible.' : `Ya tenés el máximo disponible (${tope}).`],
      claveLinea: clave,
    };
  }
  const cantidadFinal = Math.min(tope, yaEnCarrito + pedida);

  const precioBase = precioConfirmado(producto) ?? 0;
  const linea = {
    clave,
    productoId: producto.id,
    nombre: nombreDeLinea(producto.nombre, resuelta.elegidas),
    nombreBase: producto.nombre,
    imagen: producto.imagen || '',
    cantidad: cantidadFinal,
    precioBase,
    deltaOpciones: resuelta.deltaTotal,
    precioUnitario: precioUnitarioConfigurado(precioBase, resuelta.deltaTotal),
    opciones: resuelta.elegidas,
    notas: String(notas || '').slice(0, 200),
  };
  linea.subtotal = linea.precioUnitario * linea.cantidad;

  const lineas = existente
    ? actual.lineas.map((item) => (item.clave === clave ? linea : item))
    : [...actual.lineas, linea];

  return { ok: true, carrito: { lineas }, problemas: [], claveLinea: clave };
}

export function cambiarCantidad(carrito, clave, cantidad) {
  const actual = normalizarCarrito(carrito);
  const objetivo = Math.max(0, Math.floor(Number(cantidad) || 0));
  if (objetivo === 0) return quitarLinea(actual, clave);
  const lineas = actual.lineas.map((linea) => {
    if (linea.clave !== clave) return linea;
    const cantidadFinal = Math.min(MAXIMO_POR_LINEA, objetivo);
    return { ...linea, cantidad: cantidadFinal, subtotal: linea.precioUnitario * cantidadFinal };
  });
  return { lineas };
}

export function incrementarLinea(carrito, clave) {
  const linea = normalizarCarrito(carrito).lineas.find((item) => item.clave === clave);
  return cambiarCantidad(carrito, clave, (linea?.cantidad || 0) + 1);
}

export function decrementarLinea(carrito, clave) {
  const linea = normalizarCarrito(carrito).lineas.find((item) => item.clave === clave);
  return cambiarCantidad(carrito, clave, (linea?.cantidad || 0) - 1);
}

export function quitarLinea(carrito, clave) {
  const actual = normalizarCarrito(carrito);
  return { lineas: actual.lineas.filter((linea) => linea.clave !== clave) };
}

export function vaciarCarrito() {
  return carritoVacio();
}

export function cantidadDeItems(carrito) {
  return normalizarCarrito(carrito).lineas.reduce((suma, linea) => suma + linea.cantidad, 0);
}

export function resumenDelCarrito(carrito, { modoEntrega = 'delivery', costoEnvio = 0, descuento = 0 } = {}) {
  const actual = normalizarCarrito(carrito);
  const totales = calcularTotales(actual.lineas, { modoEntrega, costoEnvio, descuento });
  return {
    ...totales,
    lineas: actual.lineas,
    items: cantidadDeItems(actual),
  };
}

/**
 * Reconcilia el carrito contra el catálogo VIVO.
 *
 * Un carrito guardado ayer puede referirse a un producto que ya no existe, que
 * subió de precio, que se agotó o al que le sacaron un extra. Nada de eso se
 * arregla en silencio: se INFORMA, porque cambiar el precio sin avisar es
 * exactamente lo que hace que alguien pague algo distinto de lo que aceptó.
 *
 * Devuelve el carrito corregido y la lista de cambios en texto mostrable.
 */
export function reconciliarCarrito(carrito, catalogo = []) {
  const actual = normalizarCarrito(carrito);
  const porId = new Map((Array.isArray(catalogo) ? catalogo : []).map((producto) => [producto.id, producto]));
  const cambios = [];
  const lineas = [];

  for (const linea of actual.lineas) {
    const producto = porId.get(linea.productoId);
    if (!producto) {
      cambios.push({ clave: linea.clave, tipo: 'eliminado', texto: `«${linea.nombre}» ya no está en la carta.` });
      continue;
    }
    if (!sePuedeComprar(producto)) {
      cambios.push({
        clave: linea.clave,
        tipo: 'no_disponible',
        texto: estaAgotado(producto)
          ? `«${linea.nombre}» se agotó.`
          : `«${linea.nombre}» no está disponible ahora.`,
      });
      continue;
    }

    // La selección se vuelve a resolver contra los grupos ACTUALES: si sacaron
    // el cheddar de la carta, la línea deja de poder existir tal como está.
    const seleccion = {};
    for (const eleccion of linea.opciones || []) {
      seleccion[eleccion.grupoId] = [...(seleccion[eleccion.grupoId] || []), eleccion.opcionId];
    }
    const resuelta = resolverSeleccion(producto.grupos || [], seleccion);
    if (!resuelta.valida) {
      cambios.push({
        clave: linea.clave,
        tipo: 'opciones_cambiadas',
        texto: `«${linea.nombre}»: ${resuelta.problemas[0]}`,
      });
      continue;
    }

    const precioBase = precioConfirmado(producto) ?? 0;
    const precioUnitario = precioUnitarioConfigurado(precioBase, resuelta.deltaTotal);
    if (precioUnitario !== linea.precioUnitario) {
      cambios.push({
        clave: linea.clave,
        tipo: 'precio',
        texto: `«${linea.nombre}» cambió de precio.`,
        precioAnterior: linea.precioUnitario,
        precioNuevo: precioUnitario,
      });
    }

    const tope = Math.min(MAXIMO_POR_LINEA, stockConocido(producto) ?? MAXIMO_POR_LINEA);
    const cantidad = Math.min(linea.cantidad, tope);
    if (cantidad < linea.cantidad) {
      cambios.push({
        clave: linea.clave,
        tipo: 'cantidad',
        texto: `«${linea.nombre}»: quedan ${cantidad} disponibles.`,
      });
    }
    if (cantidad <= 0) continue;

    lineas.push({
      ...linea,
      nombre: nombreDeLinea(producto.nombre, resuelta.elegidas),
      nombreBase: producto.nombre,
      imagen: producto.imagen || linea.imagen,
      precioBase,
      deltaOpciones: resuelta.deltaTotal,
      precioUnitario,
      cantidad,
      subtotal: precioUnitario * cantidad,
      opciones: resuelta.elegidas,
    });
  }

  return { carrito: { lineas }, cambios };
}

/**
 * Lo que se le manda al servidor para crear el pedido.
 *
 * **SIN UN SOLO PRECIO.** Viajan identificadores y cantidades; el servidor
 * deriva base y deltas de sus propias tablas. Es el contrato que TABA aplica a
 * `products.price` y que acá se extiende a los modificadores: si el navegador
 * pudiera proponer el precio de un extra, podría proponer cero.
 */
export function lineasParaElServidor(carrito) {
  return normalizarCarrito(carrito).lineas.map((linea) => ({
    producto_id: linea.productoId,
    cantidad: linea.cantidad,
    opciones: (linea.opciones || []).map((eleccion) => ({
      grupo_id: eleccion.grupoId,
      opcion_id: eleccion.opcionId,
    })),
    notas: linea.notas || '',
  }));
}

/** Valida el carrito antes de dejar avanzar al checkout. */
export function validarParaCheckout(carrito, catalogo = [], { minimoEnvio = 0, modoEntrega = 'delivery' } = {}) {
  const { carrito: reconciliado, cambios } = reconciliarCarrito(carrito, catalogo);
  const problemas = cambios.map((cambio) => cambio.texto);

  if (!reconciliado.lineas.length) {
    problemas.push('Tu pedido está vacío.');
    return { ok: false, carrito: reconciliado, problemas, cambios };
  }

  const subtotal = reconciliado.lineas.reduce((suma, linea) => suma + linea.subtotal, 0);
  if (modoEntrega === 'delivery' && minimoEnvio > 0 && subtotal < minimoEnvio) {
    problemas.push(`El mínimo para envío es $ ${minimoEnvio.toLocaleString('es-AR')}.`);
  }

  return { ok: problemas.length === 0, carrito: reconciliado, problemas, cambios };
}

function topeDeUnidades(producto, clave, carrito) {
  const stock = stockConocido(producto);
  if (stock === null) return MAXIMO_POR_LINEA;
  // El stock del producto se reparte entre TODAS las líneas que lo usan: tres
  // configuraciones distintas del mismo producto no pueden sumar más unidades
  // que las que hay. Sin esto, elegir extras distintos multiplicaba el stock.
  const comprometidoEnOtrasLineas = carrito.lineas
    .filter((linea) => linea.productoId === producto.id && linea.clave !== clave)
    .reduce((suma, linea) => suma + linea.cantidad, 0);
  return Math.max(0, Math.min(MAXIMO_POR_LINEA, stock - comprometidoEnOtrasLineas));
}

function normalizarCarrito(carrito) {
  if (!carrito || !Array.isArray(carrito.lineas)) return carritoVacio();
  return { lineas: carrito.lineas.filter((linea) => linea && linea.clave && linea.cantidad > 0) };
}
