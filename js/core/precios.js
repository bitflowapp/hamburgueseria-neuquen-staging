/*
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTRATO DE PRECIO Y DISPONIBILIDAD
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PROCEDENCIA: reciclado de `js/core/pricing.js` de TABA
 * (la-taba-pages-preview @ 523d3d0). El contrato de «pendiente ≠ gratis» y
 * «stock ausente ≠ stock cero» se conserva PALABRA POR PALABRA en su doctrina,
 * porque no es una preferencia de estilo: es la razón por la que TABA no vendió
 * productos a $ 0.
 *
 * QUÉ CAMBIA RESPECTO DEL ORIGINAL
 * --------------------------------
 * · TABA resolvía el costo de envío consultando su store de disponibilidad
 *   comercial. Acá el envío lo resuelve `envios.js` contra las zonas, porque una
 *   hamburguesería cobra por zona y no por comercio.
 * · Se suma el precio configurado (base + modificadores), que en TABA no existía.
 *
 * QUÉ NO CAMBIA
 * -------------
 * «Sin precio» y «vale cero pesos» son cosas distintas y en JavaScript se
 * escriben igual: `Number(null)`, `Number('')` y `Number(undefined)` valen 0.
 * La columna de la base tampoco ayuda —el precio es `not null check (>= 0)`— y
 * el estado explícito vive aparte, en `price_status`.
 *
 * Éste es el único lugar donde se decide si un producto tiene precio. La regla
 * vale para las DOS direcciones:
 *
 *   · un `price_status = 'pending'` es pendiente aunque traiga un número;
 *   · un precio que no es un número mayor a cero es pendiente aunque el estado
 *     diga «confirmed». Si el backend manda una fila incoherente, la tienda
 *     falla cerrada en vez de ofrecer algo a $ 0.
 */

export const PRECIO_PENDIENTE_TITULO = 'Precio a confirmar';
export const PRECIO_PENDIENTE_DETALLE = 'Este producto todavía no está disponible para pedir.';

export function normalizeMoneyValue(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.round(numeric));
}

export function normalizeQuantity(value, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.floor(numeric));
}

export function normalizeStock(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

export function normalizarModoDeEntrega(value) {
  return value === 'pickup' ? 'pickup' : 'delivery';
}

export function precioPendiente(producto) {
  if (!producto || typeof producto !== 'object') return true;
  if (producto.precioPendiente === true || producto.pricePending === true) return true;
  // Los dos nombres se miran por separado y CUALQUIERA que diga «pending» gana.
  // Con `??` bastaba que la variante camelCase dijera «confirmed» para tapar una
  // snake_case que decía lo contrario, y entre dos fuentes que se contradicen
  // sobre si algo se puede vender hay que creerle a la que dice que no.
  const estados = [producto.estadoPrecio, producto.priceStatus, producto.price_status]
    .map((valor) => String(valor ?? '').trim().toLowerCase());
  if (estados.includes('pending') || estados.includes('pendiente')) return true;
  const monto = Number(producto.precio ?? producto.price);
  return !Number.isFinite(monto) || monto <= 0;
}

/** El precio, o `null` si está pendiente. Nunca devuelve cero por ausencia. */
export function precioConfirmado(producto) {
  if (precioPendiente(producto)) return null;
  return normalizeMoneyValue(producto.precio ?? producto.price, 0);
}

/**
 * El stock se declara ausente con `null`, no con cero: cero es «se agotó» y null
 * es «nadie lo contó todavía». Son estados distintos y la diferencia importa,
 * porque uno se resuelve reponiendo y el otro contando.
 *
 * En una cocina hay un tercer caso que TABA no tenía: un producto que se prepara
 * al momento NO lleva stock numérico. Ése se declara con `controlaStock: false`
 * y no es pendiente ni agotado: es ilimitado mientras el local esté abierto.
 */
export function controlaStock(producto) {
  return producto?.controlaStock === true || producto?.tracks_stock === true;
}

export function stockPendiente(producto) {
  if (!producto || typeof producto !== 'object') return true;
  if (!controlaStock(producto)) return false;
  const valor = producto.stock;
  if (valor === null || valor === undefined || valor === '') return true;
  return !Number.isFinite(Number(valor));
}

export function stockConocido(producto) {
  if (!controlaStock(producto)) return null;
  if (stockPendiente(producto)) return null;
  return Math.max(0, Math.floor(Number(producto.stock)));
}

/** `true` si el producto está agotado. Un producto sin control de stock nunca lo está. */
export function estaAgotado(producto) {
  if (producto?.agotado === true || producto?.is_sold_out === true) return true;
  if (!controlaStock(producto)) return false;
  const stock = stockConocido(producto);
  return stock === null || stock <= 0;
}

/**
 * La compuerta comercial completa, del lado del cliente.
 * El servidor impone la misma; ésta existe para que la tienda no ofrezca lo que
 * el servidor va a rechazar.
 */
export function sePuedeComprar(producto) {
  if (!producto || typeof producto !== 'object') return false;
  if (precioPendiente(producto)) return false;
  if (estaAgotado(producto)) return false;
  return producto.disponible !== false && producto.archivado !== true;
}

export function calcularSubtotal(lineas = []) {
  if (!Array.isArray(lineas)) return 0;
  return lineas.reduce((suma, linea) => {
    const cantidadCruda = Number(linea?.cantidad ?? linea?.quantity);
    const cantidad = Number.isFinite(cantidadCruda) ? Math.max(0, Math.floor(cantidadCruda)) : 0;
    const precioUnitario = normalizeMoneyValue(linea?.precioUnitario ?? linea?.unitPrice, 0);
    return suma + cantidad * precioUnitario;
  }, 0);
}

export function normalizarDescuento(valor, subtotal = 0) {
  const base = normalizeMoneyValue(subtotal, 0);
  const descuento = normalizeMoneyValue(valor, 0);
  return Math.min(base, descuento);
}

/**
 * Totales del pedido.
 *
 * `costoEnvio` se recibe RESUELTO desde afuera, no se adivina acá: quien sabe
 * cuánto cuesta el envío es la zona de la dirección concreta, y ese número lo
 * fija el servidor. Anunciar el costo por defecto del comercio cuando la zona ya
 * dijo otra cosa sería anunciar un precio y cobrar otro.
 */
export function calcularTotales(lineas = [], { modoEntrega = 'delivery', costoEnvio = 0, descuento = 0 } = {}) {
  const subtotal = Array.isArray(lineas) ? calcularSubtotal(lineas) : normalizeMoneyValue(lineas, 0);
  const envio = normalizarModoDeEntrega(modoEntrega) === 'pickup' ? 0 : normalizeMoneyValue(costoEnvio, 0);
  const descuentoTotal = normalizarDescuento(descuento, subtotal);
  return {
    subtotal,
    descuentoTotal,
    costoEnvio: envio,
    total: Math.max(0, subtotal - descuentoTotal) + envio,
  };
}

/** Formato de moneda argentino. Sin decimales: la cocina no cobra centavos. */
export function formatearPrecio(valor, { locale = 'es-AR', moneda = 'ARS' } = {}) {
  const monto = normalizeMoneyValue(valor, 0);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: moneda,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(monto);
  } catch (_) {
    return `$ ${monto.toLocaleString('es-AR')}`;
  }
}
