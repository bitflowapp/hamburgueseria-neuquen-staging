/*
 * ─────────────────────────────────────────────────────────────────────────────
 * BACKEND EN MEMORIA — MISMO CONTRATO QUE EL SERVIDOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PROCEDENCIA. El patrón es el de `js/repositories/*` de TABA: una interfaz
 * común y varias implementaciones intercambiables, elegidas por configuración.
 * Es lo que permite desarrollar la tienda entera sin backend y, el día que hay
 * uno, cambiar una línea de config sin tocar la UI.
 *
 * LA REGLA QUE HACE QUE ESTO NO SEA UN JUGUETE
 * --------------------------------------------
 * Este repositorio se comporta como el SERVIDOR, no como una maqueta amable:
 *
 *   · recibe `{producto_id, cantidad, opciones[]}` y NADA MÁS. Si el llamador
 *     manda un precio, se ignora, igual que en `crear_pedido`;
 *   · deriva base y deltas de SU copia del catálogo;
 *   · rechaza lo que el servidor rechazaría: producto sin precio, opción
 *     pendiente, opción de un grupo que el producto no ofrece, stock
 *     insuficiente, local cerrado, fuera de zona.
 *
 * Si esto fuera permisivo, la tienda funcionaría en demo y fallaría en
 * producción, que es exactamente el modo de fallo que el patrón existe para
 * evitar. La prueba `tests/paridad-sandbox-servidor.test.mjs` compara los dos
 * caminos caso por caso.
 */

import { normalizarGrupos } from '../core/modificadores.js';
import { normalizeQuantity, sePuedeComprar } from '../core/precios.js';
import {
  canTransitionWorkflowStatus,
  isTerminalWorkflowStatus,
  normalizeWorkflowStatus,
} from '../core/order-workflow.js';

const SELLOS_POR_ESTADO = Object.freeze({
  accepted: 'aceptadoEn',
  preparing: 'preparandoEn',
  ready: 'listoEn',
  assigned: 'asignadoEn',
  picked_up: 'retiradoEn',
  on_the_way: 'enCaminoEn',
  arrived: 'llegoEn',
  delivered: 'entregadoEn',
  canceled: 'canceladoEn',
});

export class ErrorDePedido extends Error {
  constructor(mensaje, codigo = 'rechazado') {
    super(mensaje);
    this.name = 'ErrorDePedido';
    this.codigo = codigo;
  }
}

export function crearRepositorioSandbox({
  carta = { categorias: [], productos: [] },
  comercio = {},
  zonas = [],
  ahora = () => new Date(),
} = {}) {
  const estado = {
    comercio: {
      abiertoDelivery: true,
      abiertoRetiro: true,
      deliveryHabilitado: true,
      retiroHabilitado: true,
      aceptaPedidos: true,
      costoEnvioPorDefecto: null,
      minimoPorDefecto: 0,
      minutosPreparacionPorDefecto: 25,
      prefijoPedido: 'HB',
      ...comercio,
    },
    categorias: carta.categorias || [],
    productos: (carta.productos || []).map(clonar),
    zonas: zonas.map(clonar),
    pedidos: [],
    secuencia: 0,
    oyentes: new Set(),
  };

  const porId = () => new Map(estado.productos.map((producto) => [producto.id, producto]));

  function notificar() {
    for (const oyente of estado.oyentes) {
      try {
        oyente(estado.pedidos.map(clonar));
      } catch (_) {
        // Un oyente que explota no puede tumbar a los demás.
      }
    }
  }

  function resolverZona(barrio) {
    if (!estado.zonas.length) {
      // Sin zonas cargadas no hay cobertura declarada. Igual que en el servidor,
      // eso NO significa envío gratis a todas partes.
      return estado.comercio.costoEnvioPorDefecto == null
        ? { cubierta: false, motivo: 'sin_costo_de_envio' }
        : {
          cubierta: true,
          zonaId: null,
          zonaNombre: null,
          costoEnvio: estado.comercio.costoEnvioPorDefecto,
          minimoSubtotal: estado.comercio.minimoPorDefecto ?? 0,
        };
    }
    const plegado = plegar(barrio);
    const zona = estado.zonas
      .filter((candidata) => candidata.activa !== false && plegar(candidata.nombre) === plegado)
      .sort((a, b) => (a.prioridad ?? 100) - (b.prioridad ?? 100))[0];
    if (!zona) return { cubierta: false, motivo: 'fuera_de_zona' };
    const costo = zona.costoEnvio ?? estado.comercio.costoEnvioPorDefecto;
    if (costo == null) {
      return { cubierta: false, motivo: 'zona_sin_tarifa', zonaId: zona.id, zonaNombre: zona.nombre };
    }
    return {
      cubierta: true,
      zonaId: zona.id,
      zonaNombre: zona.nombre,
      costoEnvio: costo,
      minimoSubtotal: zona.minimoSubtotal ?? estado.comercio.minimoPorDefecto ?? 0,
      etaMinutos: zona.etaMinutos ?? null,
    };
  }

  return {
    modo: 'sandbox',

    async obtenerCarta() {
      return { categorias: estado.categorias.map(clonar), productos: estado.productos.map(clonar) };
    },

    async disponibilidad({ barrio = '' } = {}) {
      return {
        abiertoDelivery: estado.comercio.abiertoDelivery,
        abiertoRetiro: estado.comercio.abiertoRetiro,
        entrega: resolverZona(barrio),
        consultadoEn: ahora().toISOString(),
      };
    },

    /**
     * Alta de pedido. Espeja `crear_pedido` del servidor, paso por paso.
     */
    async crearPedido(solicitud = {}) {
      const modo = solicitud.modoEntrega === 'pickup' ? 'pickup' : 'delivery';

      if (!estado.comercio.aceptaPedidos) {
        throw new ErrorDePedido('El local no está recibiendo pedidos.', 'comercio_no_habilitado');
      }
      if (modo === 'delivery' && !estado.comercio.deliveryHabilitado) {
        throw new ErrorDePedido('El envío a domicilio no está habilitado.', 'delivery_apagado');
      }
      if (modo === 'pickup' && !estado.comercio.retiroHabilitado) {
        throw new ErrorDePedido('El retiro en el local no está habilitado.', 'retiro_apagado');
      }
      if (modo === 'delivery' && !estado.comercio.abiertoDelivery) {
        throw new ErrorDePedido('El local está cerrado en este momento.', 'cerrado');
      }
      if (modo === 'pickup' && !estado.comercio.abiertoRetiro) {
        throw new ErrorDePedido('El local está cerrado en este momento.', 'cerrado');
      }

      const nombre = String(solicitud.clienteNombre || '').trim();
      const telefono = String(solicitud.clienteTelefono || '').trim();
      if (!nombre || !telefono) {
        throw new ErrorDePedido('Nombre y teléfono son obligatorios.', 'datos_incompletos');
      }

      const lineasPedidas = Array.isArray(solicitud.lineas) ? solicitud.lineas : [];
      if (!lineasPedidas.length || lineasPedidas.length > 40) {
        throw new ErrorDePedido('El pedido debe tener entre 1 y 40 líneas.', 'lineas_invalidas');
      }

      const catalogo = porId();

      // ── Demanda de stock agregada POR PRODUCTO ──────────────────────────────
      // Igual que el servidor: dos líneas del mismo producto con configuraciones
      // distintas no pueden llevarse el stock dos veces.
      const demanda = new Map();
      for (const linea of lineasPedidas) {
        const cantidad = normalizeQuantity(linea?.cantidad, 1);
        const productoId = idDeProducto(linea);
        demanda.set(productoId, (demanda.get(productoId) || 0) + cantidad);
      }
      for (const [productoId, cantidad] of demanda) {
        const producto = catalogo.get(productoId);
        if (!producto) throw new ErrorDePedido('Un producto del pedido ya no existe.', 'producto_inexistente');
        // El stock se mira ANTES que la disponibilidad general porque «se agotó»
        // es una respuesta más útil que «no está disponible»: una le dice al
        // cliente que vuelva mañana y a la cocina que reponga; la otra no dice
        // nada. La compuerta comercial es la misma, cambia sólo el motivo.
        if (producto.controlaStock && (producto.stock ?? 0) < cantidad) {
          throw new ErrorDePedido(
            (producto.stock ?? 0) === 0
              ? `Se agotó «${producto.nombre}».`
              : `Sólo quedan ${producto.stock} de «${producto.nombre}».`,
            'sin_stock',
          );
        }
        if (!sePuedeComprar(producto)) {
          throw new ErrorDePedido(`«${producto.nombre}» no está disponible.`, 'producto_no_disponible');
        }
      }

      // ── Zona y envío ────────────────────────────────────────────────────────
      let costoEnvio = 0;
      let minimo = 0;
      let zonaId = null;
      if (modo === 'delivery') {
        const calle = String(solicitud.direccion?.calle || '').trim();
        const numero = String(solicitud.direccion?.numero || '').trim();
        if (!calle || !numero) {
          throw new ErrorDePedido('Falta la calle y el número de la dirección.', 'direccion_incompleta');
        }
        const zona = resolverZona(solicitud.direccion?.barrio);
        if (!zona.cubierta) {
          throw new ErrorDePedido(
            zona.motivo === 'fuera_de_zona'
              ? 'Todavía no llegamos a esa zona.'
              : 'El local no fijó el costo de envío para esa zona.',
            zona.motivo,
          );
        }
        costoEnvio = zona.costoEnvio;
        minimo = zona.minimoSubtotal ?? 0;
        zonaId = zona.zonaId;
      }

      // ── Líneas, con el precio derivado ACÁ ──────────────────────────────────
      const lineas = [];
      let subtotal = 0;
      let prep = 0;

      lineasPedidas.forEach((pedida, indice) => {
        const producto = catalogo.get(idDeProducto(pedida));
        const cantidad = normalizeQuantity(pedida?.cantidad, 1);
        const grupos = normalizarGrupos(producto.grupos || []);
        const gruposPorId = new Map(grupos.map((grupo) => [grupo.id, grupo]));

        const base = Number(producto.precio);
        let deltas = 0;
        const opciones = [];

        for (const seleccionada of Array.isArray(pedida.opciones) ? pedida.opciones : []) {
          const grupo = gruposPorId.get(idDeGrupo(seleccionada));
          // El grupo tiene que ser de ESTE producto. Sin esta comprobación se
          // podría pedir el extra barato de otro producto.
          if (!grupo) {
            throw new ErrorDePedido(
              `La línea ${indice + 1} pide opciones que este producto no ofrece.`,
              'opcion_ajena',
            );
          }
          const opcion = grupo.opciones.find((candidata) => candidata.id === idDeOpcion(seleccionada));
          if (!opcion) {
            throw new ErrorDePedido(`Una opción de la línea ${indice + 1} ya no existe.`, 'opcion_inexistente');
          }
          if (!opcion.disponible) {
            throw new ErrorDePedido(`«${opcion.nombre}» no está disponible.`, 'opcion_no_disponible');
          }
          if (opcion.precioPendiente) {
            throw new ErrorDePedido(`«${opcion.nombre}» no tiene precio confirmado.`, 'opcion_sin_precio');
          }
          deltas += opcion.precioDelta;
          opciones.push({
            grupoNombre: grupo.nombre,
            grupoTipo: grupo.tipo,
            opcionNombre: opcion.nombre,
            precioDelta: opcion.precioDelta,
          });
        }

        const unitario = Math.max(0, Math.round(base + deltas));
        subtotal += unitario * cantidad;
        prep = Math.max(prep, Number(producto.minutosPreparacion) || 0);

        lineas.push({
          id: `linea-${indice + 1}`,
          productoId: producto.id,
          nombre: nombreConVariante(producto.nombre, opciones),
          cantidad,
          precioBase: Math.round(base),
          deltaOpciones: unitario - Math.round(base),
          precioUnitario: unitario,
          subtotal: unitario * cantidad,
          notas: String(pedida.notas || '').slice(0, 200),
          opciones,
        });
      });

      if (modo === 'delivery' && minimo > 0 && subtotal < minimo) {
        throw new ErrorDePedido(`El mínimo para envío es $ ${minimo.toLocaleString('es-AR')}.`, 'bajo_minimo');
      }

      // Recién acá se descuenta el stock: si algo falló arriba, no se tocó nada.
      for (const [productoId, cantidad] of demanda) {
        const producto = catalogo.get(productoId);
        if (producto.controlaStock) producto.stock = Math.max(0, (producto.stock ?? 0) - cantidad);
      }

      estado.secuencia += 1;
      const creadoEn = ahora().toISOString();
      const pedido = {
        id: `ped-${estado.secuencia}`,
        codigo: `${estado.comercio.prefijoPedido}-${String(estado.secuencia).padStart(4, '0')}`,
        estado: 'submitted',
        modoEntrega: modo,
        cliente: { nombre, telefono },
        direccion: modo === 'pickup' ? null : { ...solicitud.direccion },
        zonaId,
        medioDePago: solicitud.medioDePago || 'cash',
        estadoDePago: 'pending',
        // Lo genera el BACKEND, nunca quien pide: un token elegido por el
        // cliente es un token que el cliente puede predecir para otro pedido.
        // Mismo formato que el de la base (32 hexadecimales) para que lo que se
        // prueba acá sea lo que corre allá.
        tokenDeSeguimiento: Array.from({ length: 32 },
          () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join(''),
        notas: String(solicitud.notas || '').slice(0, 300),
        totales: { subtotal, descuento: 0, costoEnvio, total: subtotal + costoEnvio },
        minutosPreparacion: prep || estado.comercio.minutosPreparacionPorDefecto,
        riderId: null,
        revision: 1,
        creadoEn,
        actualizadoEn: creadoEn,
        historial: [{ estado: 'submitted', en: creadoEn }],
        lineas,
      };

      estado.pedidos.unshift(pedido);
      notificar();
      return clonar(pedido);
    },

    async listarPedidos({ estados = [], riderId = null } = {}) {
      return estado.pedidos
        .filter((pedido) => (estados.length ? estados.includes(pedido.estado) : true))
        .filter((pedido) => (riderId ? pedido.riderId === riderId : true))
        .map(clonar);
    },

    async obtenerPedido(id) {
      const pedido = estado.pedidos.find((candidato) => candidato.id === id || candidato.codigo === id);
      return pedido ? clonar(pedido) : null;
    },

    /**
     * Cambio de estado. La transición se valida contra la MISMA matriz que usa
     * el servidor: un panel no puede inventar un camino que el backend rechaza.
     */
    async cambiarEstado(id, siguiente, { motivo = '', riderId = null } = {}) {
      const pedido = estado.pedidos.find((candidato) => candidato.id === id);
      if (!pedido) throw new ErrorDePedido('Pedido inexistente.', 'inexistente');

      const destino = normalizeWorkflowStatus(siguiente, '');
      if (!destino) throw new ErrorDePedido('Estado desconocido.', 'estado_invalido');
      if (isTerminalWorkflowStatus(pedido.estado)) {
        throw new ErrorDePedido('El pedido ya está cerrado.', 'terminal');
      }
      if (!canTransitionWorkflowStatus(pedido.estado, destino)) {
        throw new ErrorDePedido(`No se puede pasar de ${pedido.estado} a ${destino}.`, 'transicion_invalida');
      }
      // Cancelar sin decir por qué deja un pedido cerrado que nadie puede
      // explicarle al cliente. El servidor lo impone con un CHECK.
      if (destino === 'canceled' && !String(motivo).trim()) {
        throw new ErrorDePedido('Una cancelación necesita motivo.', 'falta_motivo');
      }

      const en = ahora().toISOString();
      pedido.estado = destino;
      pedido.actualizadoEn = en;
      pedido.revision += 1;
      pedido.historial.push({ estado: destino, en });
      const sello = SELLOS_POR_ESTADO[destino];
      if (sello) pedido[sello] = en;
      if (destino === 'canceled') pedido.motivoCancelacion = String(motivo).trim();
      if (riderId) pedido.riderId = riderId;

      // Devolver el stock de un pedido cancelado. No hacerlo es cómo un local
      // termina con productos «agotados» que están en la heladera.
      if (destino === 'canceled') {
        const catalogo = porId();
        for (const linea of pedido.lineas) {
          const producto = catalogo.get(linea.productoId);
          if (producto?.controlaStock) producto.stock = (producto.stock ?? 0) + linea.cantidad;
        }
      }

      notificar();
      return clonar(pedido);
    },

    async asignarRepartidor(id, riderId) {
      const pedido = estado.pedidos.find((candidato) => candidato.id === id);
      if (!pedido) throw new ErrorDePedido('Pedido inexistente.', 'inexistente');
      if (pedido.modoEntrega !== 'delivery') {
        throw new ErrorDePedido('Un pedido para retirar no se asigna a un repartidor.', 'modo_invalido');
      }
      if (!canTransitionWorkflowStatus(pedido.estado, 'assigned')) {
        throw new ErrorDePedido('El pedido todavía no está listo para asignar.', 'transicion_invalida');
      }
      return this.cambiarEstado(id, 'assigned', { riderId });
    },

    /*
     * Acepta `opciones` y las ignora a propósito.
     *
     * El backend de Supabase usa `{ recargar }` para no leer una tabla que el
     * cliente anónimo tiene denegada. Acá no hay tabla ni permisos, pero la
     * FIRMA tiene que ser la misma: dos backends intercambiables que aceptan
     * argumentos distintos dejan de ser intercambiables el día del cambio, y el
     * fallo aparece en producción y no acá.
     */
    /** La misma puerta pública que en Supabase, para que la tienda no distinga. */
    async seguirPorToken(token) {
      const pedido = estado.pedidos.find((candidato) => candidato.tokenDeSeguimiento === token);
      return pedido ? clonar(pedido) : null;
    },

    suscribir(oyente, _opciones = {}) {
      estado.oyentes.add(oyente);
      return () => estado.oyentes.delete(oyente);
    },

    /** Sólo para el modo demo y las pruebas. */
    _estado: estado,
  };
}

/*
 * EL CONTRATO DE LA SOLICITUD SE ESCRIBE EN snake_case.
 *
 * Es el que habla la RPC `crear_pedido` de Postgres —`producto_id`, `grupo_id`,
 * `opcion_id`— y por lo tanto el que emite `lineasParaElServidor`. Este
 * repositorio acepta ESE, no otro.
 *
 * Costó un fallo real: el sandbox leía `productoId` y el carrito mandaba
 * `producto_id`, así que todo pedido armado desde la tienda moría con «un
 * producto del pedido ya no existe» aunque el producto estuviera ahí. Ninguna
 * suite lo vio porque las pruebas del repositorio escribían su propio payload a
 * mano y las del carrito comprobaban la forma sin llegar a mandarla. La que
 * faltaba era la que cruza los dos, y ahora existe:
 * `tests/vertical-carrito-a-pedido.test.mjs`.
 *
 * Se aceptan las dos grafías —no cuesta nada y hace imposible que la costura
 * vuelva a romperse—, pero la canónica es la del servidor.
 */
function idDeProducto(linea) {
  return linea?.producto_id ?? linea?.productoId ?? null;
}
function idDeGrupo(seleccion) {
  return seleccion?.grupo_id ?? seleccion?.grupoId ?? null;
}
function idDeOpcion(seleccion) {
  return seleccion?.opcion_id ?? seleccion?.opcionId ?? null;
}

function nombreConVariante(nombre, opciones) {
  const variante = opciones.find((opcion) => opcion.grupoTipo === 'variante');
  return variante ? `${nombre} ${variante.opcionNombre}` : nombre;
}

function plegar(texto) {
  return String(texto ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // diacriticos, con escapes: el rango literal es invisible y fragil
    .replace(/\s+/g, ' ');
}

function clonar(valor) {
  return structuredClone(valor);
}
