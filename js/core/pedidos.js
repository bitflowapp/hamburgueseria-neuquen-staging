/*
 * ─────────────────────────────────────────────────────────────────────────────
 * PEDIDOS · ESTADOS, COCINA Y COMANDA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PROCEDENCIA. La máquina de estados es la de TABA (`js/core/order-workflow.js`,
 * reciclado sin tocar). Lo que se agrega acá es el EJE DE COCINA, que TABA no
 * tiene porque una tienda de bebidas no cocina: agarra la lata y la despacha.
 *
 * LOS ONCE ESTADOS Y LAS TRES COLUMNAS
 * ------------------------------------
 * El flujo completo tiene once estados, pero una cocina sólo puede mirar tres
 * columnas a la vez sin equivocarse. La traducción es ésta:
 *
 *     NUEVOS       submitted, accepted     ← hay que aceptarlos y arrancar
 *     PREPARANDO   preparing               ← están en la plancha
 *     LISTOS       ready, assigned         ← esperando al repartidor o al cliente
 *
 * Lo que sale de la cocina (picked_up, on_the_way, arrived, delivered) ya no es
 * problema de la plancha y no ocupa lugar en la pantalla.
 *
 * POR QUÉ `assigned` ESTÁ EN «LISTOS» Y NO EN UNA CUARTA COLUMNA
 * Para la cocina, un pedido con repartidor asignado que todavía no salió sigue
 * estando sobre el mostrador. Moverlo de columna cuando alguien lo acepta en
 * otra pantalla hace que la comanda se mueva sola delante de quien cocina.
 */

import {
  canTransitionWorkflowStatus,
  getNextWorkflowStatus,
  isTerminalWorkflowStatus,
  normalizeWorkflowStatus,
} from './order-workflow.js';
import { varianteQueNombra } from './modificadores.js';
import { formatearPrecio } from './precios.js';

export { canTransitionWorkflowStatus, isTerminalWorkflowStatus, normalizeWorkflowStatus };

export const ESTADOS_DE_COCINA = Object.freeze(['nuevos', 'preparando', 'listos']);

const COLUMNA_POR_ESTADO = Object.freeze({
  submitted: 'nuevos',
  accepted: 'nuevos',
  preparing: 'preparando',
  ready: 'listos',
  assigned: 'listos',
});

export const ETIQUETAS_DE_ESTADO = Object.freeze({
  draft: 'Borrador',
  submitted: 'Nuevo',
  accepted: 'Confirmado',
  preparing: 'En preparación',
  ready: 'Listo',
  assigned: 'Asignado a repartidor',
  picked_up: 'Retirado',
  on_the_way: 'En camino',
  arrived: 'Llegando',
  delivered: 'Entregado',
  canceled: 'Cancelado',
});

/** Lo que el CLIENTE ve. Deliberadamente más corto que lo que ve el local. */
export const ETIQUETAS_PARA_EL_CLIENTE = Object.freeze({
  draft: 'Armando tu pedido',
  submitted: 'Recibimos tu pedido',
  accepted: 'Confirmado',
  preparing: 'Lo estamos preparando',
  ready: 'Listo',
  assigned: 'Un repartidor lo va a buscar',
  picked_up: 'Salió del local',
  on_the_way: 'En camino',
  arrived: 'El repartidor está llegando',
  delivered: 'Entregado',
  canceled: 'Cancelado',
});

export const MOTIVOS_DE_CANCELACION = Object.freeze([
  'Sin stock de un producto',
  'Local cerrado',
  'El cliente no responde',
  'Dirección fuera de zona',
  'Error al cargar el pedido',
  'Otro',
]);

export function columnaDeCocina(estado) {
  return COLUMNA_POR_ESTADO[normalizeWorkflowStatus(estado)] || null;
}

/** `true` si el pedido todavía le importa a la cocina. */
export function estaEnCocina(pedido) {
  return columnaDeCocina(pedido?.estado) !== null;
}

/**
 * Arma el tablero de cocina.
 *
 * Cada columna viene ordenada por antigüedad ASCENDENTE: el pedido que más
 * esperó va arriba. Es lo contrario de una bandeja de novedades —donde lo nuevo
 * va primero— y es a propósito: una cocina despacha por orden de llegada, y
 * poner lo nuevo arriba es cómo se enfría el pedido de hace veinte minutos.
 */
export function tableroDeCocina(pedidos = [], { ahora = Date.now() } = {}) {
  const columnas = { nuevos: [], preparando: [], listos: [] };
  for (const pedido of Array.isArray(pedidos) ? pedidos : []) {
    const columna = columnaDeCocina(pedido?.estado);
    if (!columna) continue;
    columnas[columna].push(conAntiguedad(pedido, ahora));
  }
  for (const columna of ESTADOS_DE_COCINA) {
    columnas[columna].sort((a, b) => a.creadoEnMs - b.creadoEnMs);
  }
  return columnas;
}

/**
 * Cuánto hace que entró y si ya se pasó del tiempo prometido.
 *
 * `demorado` no es decoración: es la única señal que tiene la cocina de que algo
 * se está enfriando. Se calcula contra el tiempo que el pedido PROMETIÓ, no
 * contra un número fijo, porque una hamburguesa y un combo de seis no tardan lo
 * mismo.
 */
export function conAntiguedad(pedido, ahora = Date.now()) {
  const creadoEnMs = Date.parse(pedido?.creadoEn || '') || ahora;
  const minutos = Math.max(0, Math.floor((ahora - creadoEnMs) / 60000));
  const prometidos = Number(pedido?.minutosPreparacion) || 0;
  return {
    ...pedido,
    creadoEnMs,
    minutosEsperando: minutos,
    minutosPrometidos: prometidos,
    demorado: prometidos > 0 && minutos > prometidos,
    // Aviso temprano: faltando cinco minutos ya conviene mirarlo.
    porVencer: prometidos > 0 && minutos >= prometidos - 5 && minutos <= prometidos,
  };
}

/**
 * La comanda: lo que se imprime o se lee en la pantalla de la plancha.
 *
 * Cada línea trae su cantidad y sus modificadores en líneas propias. No se
 * colapsa nada ni se esconde en un modal: la persona que cocina no puede tocar
 * la pantalla con las manos sucias.
 */
export function comandaDeCocina(pedido) {
  const lineas = (pedido?.lineas || []).map((linea) => {
    // Se descarta SÓLO la variante que ya nombra la línea («Doble»), no todas.
    // Filtrar por tipo dejaba el punto de cocción fuera de la comanda: la
    // plancha sabía el tamaño y no sabía si iba jugosa.
    const nombradora = varianteQueNombra(linea.opciones || []);
    const opciones = (linea.opciones || []).filter((opcion) => opcion !== nombradora);
    return {
      cantidad: linea.cantidad,
      nombre: linea.nombre,
      modificadores: opciones.map((opcion) => ({
        texto: `${opcion.grupoTipo === 'quitar' ? '−' : '+'} ${opcion.opcionNombre}`,
        quitado: opcion.grupoTipo === 'quitar',
      })),
      notas: linea.notas || '',
    };
  });
  return {
    codigo: pedido?.codigo || '',
    modoEntrega: pedido?.modoEntrega || 'delivery',
    lineas,
    // Las notas del cliente van al final y separadas: son instrucciones sobre el
    // pedido entero, no sobre una línea.
    notasDelPedido: pedido?.notas || '',
    totalItems: lineas.reduce((suma, linea) => suma + linea.cantidad, 0),
  };
}

/**
 * Qué puede hacer el LOCAL con este pedido, ahora.
 *
 * Devolver acciones y no estados sueltos es lo que evita que el panel dibuje un
 * botón que el backend va a rechazar. La lista sale de la misma matriz de
 * transiciones que valida el servidor.
 */
export function accionesDelLocal(pedido) {
  const estado = normalizeWorkflowStatus(pedido?.estado);
  if (isTerminalWorkflowStatus(estado)) return [];

  const acciones = [];
  const sePuede = (siguiente) => canTransitionWorkflowStatus(estado, siguiente);

  /*
   * UN pedido nuevo tiene UN botón.
   *
   * El flujo admite `accepted` como paso propio —sirve para una recepción
   * automática o para un mostrador que confirma antes de cocinar— pero en la
   * pantalla de cocina ofrecerlo al lado de «Aceptar y preparar» ponía dos
   * botones casi iguales, uno junto al otro, sobre el pedido que recién entra.
   * Elegir entre ellos cuesta un segundo que la plancha no tiene, y las dos
   * elecciones terminan en el mismo lugar.
   *
   * Para la cocina, aceptar un pedido y empezarlo son el mismo acto: el estado
   * `accepted` sigue existiendo y sigue siendo alcanzable por otras superficies.
   */
  if (sePuede('preparing')) {
    acciones.push({
      id: 'preparing',
      etiqueta: estado === 'submitted' ? 'Aceptar y preparar' : 'Empezar a preparar',
      principal: true,
    });
  } else if (sePuede('accepted')) {
    acciones.push({ id: 'accepted', etiqueta: 'Aceptar', principal: true });
  }
  if (sePuede('ready')) acciones.push({ id: 'ready', etiqueta: 'Marcar listo', principal: true });

  if (estado === 'ready' || estado === 'assigned') {
    if (pedido?.modoEntrega === 'pickup') {
      acciones.push({ id: 'delivered', etiqueta: 'Entregado al cliente', principal: true });
    } else {
      acciones.push({ id: 'picked_up', etiqueta: 'Lo retiró el repartidor', principal: true });
    }
  }

  acciones.push({ id: 'canceled', etiqueta: 'Cancelar', destructiva: true });
  return acciones;
}

/** Lo mismo, para el repartidor. Nunca ofrece acciones de cocina. */
export function accionesDelRepartidor(pedido) {
  const estado = normalizeWorkflowStatus(pedido?.estado);
  /*
   * `modoEntrega` puede no venir, y su ausencia NO significa «no es reparto».
   *
   * La vista recortada del backend (`pedido_para_repartidor`) omite ese campo
   * porque ya filtró por él: todo lo que llega ahí es de reparto. Exigirlo hacía
   * que `undefined !== 'delivery'` devolviera CERO acciones, y el repartidor
   * veía el pedido tomado sin un solo botón para avanzarlo.
   */
  if (pedido?.modoEntrega !== undefined && pedido.modoEntrega !== 'delivery') return [];
  const acciones = [];
  if (estado === 'assigned') acciones.push({ id: 'picked_up', etiqueta: 'Retiré el pedido', principal: true });
  if (estado === 'picked_up') acciones.push({ id: 'on_the_way', etiqueta: 'Salí a entregar', principal: true });
  if (estado === 'on_the_way') acciones.push({ id: 'arrived', etiqueta: 'Llegué', principal: true });
  if (estado === 'arrived' || estado === 'on_the_way') {
    acciones.push({ id: 'delivered', etiqueta: 'Entregado', principal: true });
  }
  if (!isTerminalWorkflowStatus(estado) && estado !== 'submitted') {
    acciones.push({ id: 'incidencia', etiqueta: 'Reportar un problema' });
  }
  return acciones;
}

/**
 * Qué ve el REPARTIDOR de un pedido.
 *
 * Deliberadamente recortado: el repartidor necesita saber adónde va, con quién
 * habla y cuánto cobra. NO necesita la comanda de cocina, ni los extras, ni el
 * detalle de precios por línea. Cada dato de más es una filtración con forma de
 * comodidad. Es la misma decisión que TABA documenta en `js/core/rider.js`.
 */
export function pedidoParaRepartidor(pedido) {
  if (!pedido) return null;

  /*
   * Idempotente a propósito.
   *
   * Contra Supabase el pedido YA llega recortado por `pedido_para_repartidor()`
   * del backend, con `cobraEnDestino` y `aCobrar` resueltos. Volver a derivarlos
   * de `medioDePago` —que en esa forma no viene— daba `undefined === 'cash'`,
   * o sea `false`, y el repartidor dejaba de ver cuánto tenía que cobrar.
   */
  if (pedido.cobraEnDestino !== undefined) {
    return {
      id: pedido.id,
      codigo: pedido.codigo,
      estado: pedido.estado,
      direccion: pedido.direccion,
      cliente: pedido.cliente ?? { nombre: '', telefono: '' },
      cantidadDeItems: pedido.cantidadDeItems ?? 0,
      cobraEnDestino: pedido.cobraEnDestino,
      aCobrar: pedido.aCobrar ?? 0,
      notasDeEntrega: pedido.direccion?.referencia || '',
      creadoEn: pedido.creadoEn,
    };
  }

  const cobraEnDestino = pedido.estadoDePago !== 'approved' && pedido.medioDePago === 'cash';
  return {
    id: pedido.id,
    codigo: pedido.codigo,
    estado: pedido.estado,
    direccion: pedido.direccion,
    cliente: {
      nombre: pedido.cliente?.nombre || '',
      telefono: pedido.cliente?.telefono || '',
    },
    // Cuántos bultos lleva, no QUÉ lleva.
    cantidadDeItems: (pedido.lineas || []).reduce((suma, linea) => suma + linea.cantidad, 0),
    cobraEnDestino,
    aCobrar: cobraEnDestino ? pedido.totales?.total ?? 0 : 0,
    notasDeEntrega: pedido.direccion?.referencia || '',
    creadoEn: pedido.creadoEn,
  };
}

/** Línea de estado para el cliente, con el siguiente paso si lo hay. */
export function seguimientoDelCliente(pedido) {
  const estado = normalizeWorkflowStatus(pedido?.estado);
  const siguiente = getNextWorkflowStatus(estado, pedido?.modoEntrega);
  return {
    estado,
    titulo: ETIQUETAS_PARA_EL_CLIENTE[estado] || 'Tu pedido',
    terminado: isTerminalWorkflowStatus(estado),
    cancelado: estado === 'canceled',
    motivoCancelacion: pedido?.motivoCancelacion || '',
    siguiente: siguiente ? ETIQUETAS_PARA_EL_CLIENTE[siguiente] : '',
    // El mapa sólo tiene sentido cuando hay alguien moviéndose. Antes de que el
    // repartidor salga, un mapa quieto no informa: preocupa.
    mostrarMapa: ['picked_up', 'on_the_way', 'arrived'].includes(estado)
      && pedido?.modoEntrega === 'delivery',
  };
}

/** Resumen para el ticket y para el panel. */
export function totalesLegibles(pedido, opciones = {}) {
  const totales = pedido?.totales || {};
  const filas = [
    { etiqueta: 'Subtotal', valor: totales.subtotal ?? 0 },
  ];
  if ((totales.descuento ?? 0) > 0) filas.push({ etiqueta: 'Descuento', valor: -(totales.descuento ?? 0) });
  if (pedido?.modoEntrega === 'delivery') filas.push({ etiqueta: 'Envío', valor: totales.costoEnvio ?? 0 });
  filas.push({ etiqueta: 'Total', valor: totales.total ?? 0, destacada: true });
  return filas.map((fila) => ({ ...fila, texto: formatearPrecio(Math.abs(fila.valor), opciones) }));
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * EL ESTADO DEL DINERO, SEPARADO DEL ESTADO DEL PEDIDO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * SON DOS EJES DISTINTOS Y MEZCLARLOS CUESTA PLATA.
 * Un pedido puede estar «entregado» y sin cobrar, o «nuevo» y ya pagado. La
 * cocina y el mostrador necesitan ver los dos a la vez y no confundirlos: quien
 * lee «Entregado» y asume que también quiere decir «cobrado» regala una
 * hamburguesa.
 *
 * LA DECISIÓN QUE ORDENA ESTA FUNCIÓN
 * «Pendiente» NO ES UNA ALARMA CUANDO SE PAGA EN EFECTIVO. Es el estado normal
 * de un pedido que se cobra al entregar, y pintarlo de rojo entrena a la cocina
 * a ignorar el aviso — con lo cual el día que un pago online quede pendiente de
 * verdad, nadie lo va a mirar.
 *
 * Por eso el tono depende del MEDIO y no sólo del estado: efectivo pendiente es
 * neutro y dice cuánto hay que cobrar; Mercado Pago pendiente es una alerta,
 * porque significa que el cliente todavía no puso la plata.
 */

/** Medios donde el dinero se cobra en el momento de la entrega. */
const MEDIOS_QUE_SE_COBRAN_EN_DESTINO = Object.freeze(['cash']);

export function estadoDelDinero(pedido) {
  const estado = String(pedido?.estadoDePago || 'pending').trim().toLowerCase();
  const medio = String(pedido?.medioDePago || 'cash').trim().toLowerCase();
  const total = Number(pedido?.totales?.total ?? 0);

  if (estado === 'approved') {
    return { clave: 'approved', texto: 'Pagado', tono: 'exito', cobraEnDestino: false, aCobrar: 0 };
  }
  if (estado === 'in_process') {
    return { clave: 'in_process', texto: 'Procesando pago', tono: 'alerta', cobraEnDestino: false, aCobrar: 0 };
  }
  if (estado === 'rejected') {
    return { clave: 'rejected', texto: 'Pago rechazado', tono: 'peligro', cobraEnDestino: false, aCobrar: 0 };
  }
  if (estado === 'cancelled') {
    return { clave: 'cancelled', texto: 'Pago cancelado', tono: 'peligro', cobraEnDestino: false, aCobrar: 0 };
  }
  if (estado === 'refunded') {
    return { clave: 'refunded', texto: 'Devuelto', tono: 'neutro', cobraEnDestino: false, aCobrar: 0 };
  }
  if (estado === 'partially_refunded') {
    return { clave: 'partially_refunded', texto: 'Devuelto en parte', tono: 'alerta', cobraEnDestino: false, aCobrar: 0 };
  }

  // Pendiente. Acá es donde el medio cambia el significado.
  if (MEDIOS_QUE_SE_COBRAN_EN_DESTINO.includes(medio)) {
    return {
      clave: 'pending',
      texto: 'Cobrar al entregar',
      tono: 'neutro',
      cobraEnDestino: true,
      // Cuánto tiene que cobrar quien entrega. Es el dato que evita el vuelto
      // equivocado, y sale del total del pedido y no de una cuenta a mano.
      aCobrar: Number.isFinite(total) ? total : 0,
    };
  }
  if (medio === 'transfer') {
    return { clave: 'pending', texto: 'Espera transferencia', tono: 'alerta', cobraEnDestino: false, aCobrar: 0 };
  }
  return { clave: 'pending', texto: 'Pago pendiente', tono: 'alerta', cobraEnDestino: false, aCobrar: 0 };
}

/**
 * `true` si el dinero está resuelto a favor del comercio.
 *
 * Un efectivo pendiente NO cuenta: la plata todavía no está. Sirve para que el
 * panel pueda ordenar la bandeja por lo que falta cobrar sin repetir la regla.
 */
export function dineroAcreditado(pedido) {
  return estadoDelDinero(pedido).clave === 'approved';
}
