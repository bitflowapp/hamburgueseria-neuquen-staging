/*
 * ─────────────────────────────────────────────────────────────────────────────
 * REPOSITORIO SUPABASE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Implementa la MISMA interfaz que `repositorio-sandbox.js`. Ni la tienda, ni el
 * panel, ni el repartidor saben cuál de los dos les tocó: eso lo decide
 * `backend.js` según `runtime-config.js`.
 *
 * LO QUE ESTE ARCHIVO NO HACE, Y ES LO IMPORTANTE
 * ----------------------------------------------
 * No calcula un precio. No decide un estado. No arma un total. Cada operación
 * es una llamada a una RPC que valida del lado del servidor, y lo que vuelve se
 * usa tal cual. Si mañana alguien agrega acá un `precio * cantidad`, el número
 * de la pantalla puede dejar de coincidir con el que se cobra: ése es
 * exactamente el bug que toda esta arquitectura existe para hacer imposible.
 *
 * REALTIME EN VEZ DE POLLING
 * --------------------------
 * El sandbox avisaba por `BroadcastChannel` porque las tres pantallas vivían en
 * el mismo navegador. Acá el aviso viene de Postgres por Realtime, que es el
 * mismo enganche desde el punto de vista de quien lo consume: `suscribir()`
 * devuelve una función para cortar y ya. La vista no cambió una línea.
 *
 * Se escucha la tabla `orders` filtrada por comercio. No se escucha
 * `order_items`: una línea no cambia después de creada, y suscribirse a algo
 * que no cambia es gastar una conexión para nada.
 */

import { ErrorDePedido } from './repositorio-sandbox.js';

/**
 * @param {object} opciones
 * @param {import('@supabase/supabase-js').SupabaseClient} opciones.cliente
 * @param {string} opciones.businessId
 */
export function crearRepositorioSupabase({ cliente, businessId }) {
  if (!cliente) throw new Error('hace falta un cliente de Supabase');
  if (!businessId) throw new Error('hace falta un businessId');

/*
 * QUIÉN SE SUSCRIBE Y QUÉ NECESITA.
 *
 * `Map` y no `Set` porque no todos los suscriptores quieren lo mismo. El panel
 * quiere la BANDEJA entera cada vez que algo cambia; la tienda del cliente sólo
 * quiere que le avisen, y después relee SU pedido con `obtenerPedido`.
 *
 * La distinción no es una optimización. `listarPedidos()` hace un `select` sobre
 * `orders`, que el rol `anon` tiene DENEGADO a propósito —la sonda de seguridad
 * lo comprueba— así que la tienda del cliente disparaba un 401 en la consola
 * cada vez que su pedido cambiaba de estado. No filtraba nada, pero dejaba un
 * error permanente a la vista de cualquiera que abriera el inspector, y el
 * arreglo evidente para quien lo viera mañana es `GRANT SELECT ON orders TO
 * anon` — que sí abriría los pedidos de todos los clientes.
 *
 * Un error que invita a una solución peligrosa es peor que ninguno.
 */
  const oyentes = new Map();
  let canal = null;
  let dejarDeMirarLaSesion = null;

  /*
   * EL SOCKET DE REALTIME NECESITA EL TOKEN, Y LO NECESITA OTRA VEZ CADA HORA.
   *
   * `postgres_changes` respeta la RLS, y para eso Realtime tiene que saber
   * QUIÉN escucha. Si el socket no lleva el JWT, la suscripción se establece
   * —el canal informa `SUBSCRIBED`— y no llega ningún evento: la RLS los filtra
   * todos. Es el modo de fallo más confuso posible, porque todo parece andar.
   *
   * Y no alcanza con hacerlo una vez. El JWT vence (una hora por defecto) y el
   * cliente lo renueva solo, pero el socket se queda con el viejo: la bandeja
   * del panel deja de actualizarse a mitad de un servicio y nadie entiende por
   * qué. Por eso se re-propaga en cada cambio de sesión.
   *
   * Lo destapó la prueba de integración contra el stack real; ninguna prueba de
   * esquema puede verlo, porque Realtime es un proceso aparte que lee el WAL.
   */
  async function propagarTokenAlSocket() {
    try {
      const { data } = await cliente.auth.getSession();
      const token = data?.session?.access_token;
      if (token) await cliente.realtime.setAuth(token);
    } catch (_) {
      // Sin sesión no hay nada que propagar: el canal público sigue andando.
    }
  }

  /**
   * Traduce un error de PostgREST a algo que se le pueda mostrar a una persona.
   *
   * Los `raise exception` del backend traen mensajes escritos para leerse, así
   * que se usan tal cual. Lo que NO se muestra es un error de infraestructura:
   * ahí el mensaje interno puede filtrar nombres de tablas y de funciones.
   */
  function comoErrorDePedido(error, porDefecto = 'No se pudo completar la operación.') {
    if (!error) return null;
    const mensaje = String(error.message || '');
    // Los códigos que el backend usa a propósito para hablarle al cliente.
    const esDelDominio = ['P0001', '22023', '23514', '23503', '55000', '42501', '23505']
      .includes(String(error.code || ''));
    return new ErrorDePedido(
      esDelDominio && mensaje ? mensaje : porDefecto,
      String(error.code || 'rechazado'),
    );
  }

  async function rpc(nombre, argumentos, porDefecto) {
    const { data, error } = await cliente.rpc(nombre, argumentos);
    if (error) throw comoErrorDePedido(error, porDefecto);
    return data;
  }

  /*
   * Vive en el closure y no como método, a propósito.
   *
   * El callback de Realtime la necesita, y depender de `this` ahí rompe en
   * cuanto alguien hace `const { suscribir } = repositorio`: el método se
   * desprende del objeto y `this` queda indefinido. Un fallo así aparece sólo
   * en producción y sólo cuando llega un pedido.
   */
  async function listarPedidos({ estados = [] } = {}) {
    let consulta = cliente
      .from('orders')
      .select('id')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (estados.length) consulta = consulta.in('status', estados);

    const { data, error } = await consulta;
    if (error) throw comoErrorDePedido(error, 'No pudimos leer los pedidos.');

    // Lecturas independientes, en paralelo: en serie, una bandeja de 40 pedidos
    // son 40 viajes encadenados.
    /*
     * `mi_pedido` y no `pedido_json`.
     *
     * `pedido_json` es INTERNA desde la migración de superficie mínima: es
     * `security definer`, no comprueba nada, y devolvía teléfono, dirección y
     * token de seguimiento con sólo un id. `mi_pedido` hace la misma proyección
     * pero después de comprobar que quien pregunta es el dueño del pedido o
     * alguien del local.
     *
     * Los nulos se filtran: si la RLS dejó ver la fila pero `mi_pedido` dice que
     * no, gana `mi_pedido`.
     */
    const pedidos = await Promise.all(
      (data ?? []).map((fila) => rpc('mi_pedido', { p_order_id: fila.id })),
    );
    return pedidos.filter(Boolean);
  }

  /*
   * ESTADO DE LA CONEXION EN VIVO.
   *
   * `vivo` · `caido` · `desconocido`. Quien dibuja lo muestra; quien no, lo
   * ignora. Lo importante es que EXISTA: un panel silenciosamente congelado en
   * medio del servicio es la falla mas cara de este sistema, porque nadie mira
   * una pantalla que parece estar bien.
   */
  let conexion = 'desconocido';
  let latido = null;
  const oyentesDeConexion = new Set();

  function marcarConexion(nuevo) {
    if (conexion === nuevo) return;
    conexion = nuevo;
    for (const oyente of oyentesDeConexion) {
      try { oyente(conexion); } catch (_) { /* un oyente roto no tumba a los demas */ }
    }
  }

  let recargando = false;
  async function recargarYAvisar() {
    // Sin solapamiento: con Realtime activo llegan rafagas de eventos y cada uno
    // dispararia una recarga. La primera alcanza.
    if (recargando) return;
    recargando = true;
    try {
      // La bandeja se lee sólo si alguien la pidió. Si el único suscriptor es
      // la tienda del cliente, se avisa y nada más.
      const haceFalta = [...oyentes.values()].some((opciones) => opciones.recargar);
      avisar(haceFalta ? await listarPedidos() : null);
      marcarConexion('vivo');
    } catch (_) {
      marcarConexion('caido');
    } finally {
      recargando = false;
    }
  }

  function alVolverALaPestana() {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    recargarYAvisar();
  }

  function avisar(pedidos) {
    for (const oyente of oyentes.keys()) {
      try {
        oyente(pedidos);
      } catch (_) { /* un oyente roto no tumba a los demás */ }
    }
  }

  return {
    modo: 'supabase',
    businessId,
    // Lo necesita `js/auth.js` para la sesion. Se expone a proposito y no se
    // usa para consultar datos: eso sigue pasando por los metodos de aca.
    cliente,

    // ── Carta ───────────────────────────────────────────────────────────────

    async obtenerCarta() {
      const carta = await rpc('carta_publica', { p_business_id: businessId },
        'No pudimos cargar la carta.');
      return {
        categorias: carta?.categorias ?? [],
        // El servidor ya decidió qué es pedible; acá sólo se transporta.
        productos: (carta?.productos ?? []).map((producto) => ({
          ...producto,
          // La compuerta comercial la calculó `producto_es_pedible()`. El
          // cliente la respeta y no la recalcula: dos definiciones de «se puede
          // comprar» terminan diciendo cosas distintas.
          disponible: producto.pedible,
        })),
      };
    },

    async disponibilidad({ barrio = '', latitud = null, longitud = null } = {}) {
      const datos = await rpc('disponibilidad_comercial', {
        p_business_id: businessId,
        p_barrio: barrio || null,
        p_lat: latitud,
        p_lng: longitud,
      }, 'No pudimos consultar si el local está abierto.');
      return datos;
    },

    // ── Pedidos ─────────────────────────────────────────────────────────────

    /**
     * `idempotencia` NO es opcional en la práctica: sin ella, un checkout
     * cortado por timeout crea dos pedidos. Quien llama la genera y la conserva
     * mientras dure el intento.
     */
    async crearPedido(solicitud = {}) {
      const payload = {
        business_id: businessId,
        fulfillment_type: solicitud.modoEntrega === 'pickup' ? 'pickup' : 'delivery',
        cliente_nombre: solicitud.clienteNombre,
        cliente_telefono: solicitud.clienteTelefono,
        medio_de_pago: solicitud.medioDePago || 'cash',
        notas: solicitud.notas || '',
        direccion: solicitud.direccion || null,
        // Viaja SÓLO para que el servidor pueda detectar una discrepancia.
        // Nunca participa del cálculo; ver `crear_pedido`.
        total_declarado: solicitud.totalDeclarado ?? null,
        idempotency_key: solicitud.idempotencia || null,
        lineas: solicitud.lineas || [],
      };
      return rpc('crear_pedido', { payload }, 'No pudimos tomar el pedido.');
    },

    /*
     * SE PREGUNTA DIRECTO A `mi_pedido`. Sin comprobar antes que la fila exista.
     *
     * Había un `select('id')` sobre `orders` como paso previo, y sobraba por dos
     * motivos. El primero es que no agregaba nada: `mi_pedido` ya devuelve `null`
     * cuando quien pregunta no es el dueño del pedido ni del local —esa
     * comprobación es su razón de ser—, así que el chequeo previo repetía la
     * pregunta con menos información.
     *
     * El segundo es que ROMPÍA. El rol `anon` tiene denegado el `select` sobre
     * `orders` a propósito, y quien compra sin cuenta es exactamente `anon`: el
     * cliente que volvía a su seguimiento recibía un 401 y la vista se quedaba
     * congelada en el estado con el que se había cargado.
     */
    async obtenerPedido(id) {
      return rpc('mi_pedido', { p_order_id: id }, 'No pudimos leer el pedido.');
    },

    /*
     * SEGUIR UN PEDIDO SIN CUENTA.
     *
     * `mi_pedido` está otorgada SÓLO a `authenticated`, y eso está bien: es la
     * puerta del panel y del repartidor. Quien compra sin registrarse es `anon`
     * y su puerta es `seguimiento_publico`, que pide el token que la base generó
     * al crear el pedido y devuelve MENOS: sin teléfono y sin calle.
     *
     * La tienda venía preguntando por la puerta equivocada. No era una fuga
     * —el permiso estaba bien puesto y respondía 401— pero el seguimiento del
     * cliente quedaba congelado en el estado que tenía al confirmar: el pedido
     * avanzaba en la cocina y en la pantalla del cliente no pasaba nada.
     *
     * Se normaliza acá y no en la vista: `momentos` es la forma del contrato
     * público y `historial` la que dibuja la tienda, y traducir en la plantilla
     * significaría que la vista sepa por qué puerta entró el dato.
     */
    async seguirPorToken(token) {
      const seguimiento = await rpc('seguimiento_publico', { p_token: token },
        'No pudimos leer el seguimiento.');
      if (!seguimiento) return null;
      const momentos = seguimiento.momentos || {};
      const PASO_DE = {
        accepted: 'aceptado', preparing: 'preparando', ready: 'listo',
        on_the_way: 'retirado', delivered: 'entregado',
      };
      return {
        ...seguimiento,
        // La dirección completa NO viaja por esta puerta a propósito. El barrio
        // alcanza para que el cliente reconozca su pedido.
        direccion: seguimiento.barrio ? { barrio: seguimiento.barrio } : null,
        historial: Object.entries(PASO_DE)
          .filter(([, clave]) => momentos[clave])
          .map(([estado, clave]) => ({ estado, en: momentos[clave] })),
      };
    },

    // La RLS ya limita a lo que este usuario puede ver: el panel ve los de su
    // comercio, el cliente los suyos. No hace falta filtrar por rol acá.
    listarPedidos,

    async cambiarEstado(id, siguiente, { motivo = '' } = {}) {
      return rpc('cambiar_estado_pedido', {
        p_order_id: id,
        p_nuevo_estado: siguiente,
        p_motivo: motivo || null,
      }, 'No pudimos cambiar el estado del pedido.');
    },

    async asignarRepartidor(id, riderId) {
      return rpc('asignar_repartidor', { p_order_id: id, p_rider_id: riderId },
        'No pudimos asignar el repartidor.');
    },

    // ── Repartidor ──────────────────────────────────────────────────────────

    async colaDelRepartidor() {
      return rpc('cola_del_repartidor', { p_business_id: businessId },
        'No pudimos cargar tus pedidos.');
    },

    async tomarPedido(id) {
      return rpc('tomar_pedido', { p_order_id: id }, 'No pudimos tomar el pedido.');
    },

    // ── Pagos ───────────────────────────────────────────────────────────────

    /**
     * Pide el link de pago. El importe NO viaja: lo fija el servidor.
     *
     * Se llama a la Edge Function y no a una RPC porque hay que hablar con
     * Mercado Pago, y el token del proveedor no puede estar en el navegador.
     */
    async iniciarPagoOnline(orderId) {
      const { data, error } = await cliente.functions.invoke('crear-preferencia', {
        body: { order_id: orderId },
      });
      if (error) throw new ErrorDePedido('No pudimos generar el link de pago.', 'pago_no_iniciado');
      if (!data?.ok) throw new ErrorDePedido(data?.mensaje || 'No pudimos generar el link de pago.', data?.codigo);
      return data;
    },

    /**
     * El estado del pago sale de la BASE, nunca del redirect.
     *
     * Cuando Mercado Pago devuelve al cliente a `/pago/exito/`, esa URL la puede
     * escribir cualquiera. Lo único que cuenta es lo que el webhook ya
     * verificó server-to-server y guardó.
     */
    async estadoDePago(orderId) {
      return rpc('estado_de_pago_del_pedido', { p_order_id: orderId },
        'No pudimos consultar el pago.');
    },

    // ── Carta desde el panel ────────────────────────────────────────────────

    async actualizarProducto(productoId, cambios) {
      const fila = {};
      if ('precio' in cambios) {
        fila.price = Math.max(0, Math.round(Number(cambios.precio) || 0));
        // Un precio en cero no es un precio: es pendiente. Misma regla que en
        // el panel de demo y que en el CHECK de la tabla.
        fila.price_status = fila.price > 0 ? 'confirmed' : 'pending';
      }
      if ('disponible' in cambios) fila.available = Boolean(cambios.disponible);
      if ('agotado' in cambios) fila.is_sold_out = Boolean(cambios.agotado);
      if ('stock' in cambios) fila.stock = cambios.stock;

      const { data, error } = await cliente
        .from('products')
        .update(fila)
        .eq('id', productoId)
        .eq('business_id', businessId)
        .select()
        .maybeSingle();
      if (error) throw comoErrorDePedido(error, 'No pudimos actualizar el producto.');
      return data;
    },

    async actualizarComercio(cambios) {
      const fila = {};
      if ('abiertoDelivery' in cambios) fila.delivery_enabled = Boolean(cambios.abiertoDelivery);
      if ('abiertoRetiro' in cambios) fila.pickup_enabled = Boolean(cambios.abiertoRetiro);
      if ('estado' in cambios) fila.status = cambios.estado;

      const { data, error } = await cliente
        .from('businesses')
        .update(fila)
        .eq('id', businessId)
        .select()
        .maybeSingle();
      if (error) throw comoErrorDePedido(error, 'No pudimos actualizar la configuración.');
      return data;
    },

    // ── Realtime ────────────────────────────────────────────────────────────

    /** Estado del canal en vivo, para que la vista pueda mostrarlo. */
    estadoDeConexion: () => conexion,

    alCambiarConexion(oyente) {
      oyentesDeConexion.add(oyente);
      oyente(conexion);
      return () => oyentesDeConexion.delete(oyente);
    },

    /** Fuerza una relectura. La usa el boton de reintentar. */
    refrescar: () => recargarYAvisar(),

    /**
     * @param oyente             se llama con la bandeja, o con `null` si nadie la pidió
     * @param opciones.recargar  `true` (por defecto) relee la bandeja entera en cada
     *                           cambio. La tienda del cliente pasa `false`: no puede
     *                           leer `orders` y no la necesita.
     */
    suscribir(oyente, { recargar = true } = {}) {
      oyentes.set(oyente, { recargar });

      if (!canal) {
        propagarTokenAlSocket();
        // Cada renovación de token vuelve a propagarse: sin esto la suscripción
        // muere en silencio cuando vence el JWT.
        if (!dejarDeMirarLaSesion) {
          const { data } = cliente.auth.onAuthStateChange(() => { propagarTokenAlSocket(); });
          dejarDeMirarLaSesion = () => data?.subscription?.unsubscribe();
        }

        canal = cliente
          .channel(`pedidos-${businessId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'orders', filter: `business_id=eq.${businessId}` },
            async () => {
              /*
               * Se recarga la lista entera en vez de aplicar el cambio de la
               * notificación.
               *
               * Es a propósito: el payload de Realtime trae la fila cruda de
               * `orders`, sin las líneas ni las opciones, y armar el pedido a
               * partir de eso significaría reconstruir en el cliente lo que
               * `pedido_json` ya arma bien. Para el volumen de una
               * hamburguesería —decenas de pedidos por noche— una recarga por
               * cambio es barata y no puede desincronizarse.
               */
              marcarConexion('vivo');
              await recargarYAvisar();
            },
          )
          .subscribe((estadoDelCanal) => {
            /*
             * EL ESTADO DEL CANAL SE PUBLICA, NO SE IGNORA.
             *
             * Los que importan son CHANNEL_ERROR, TIMED_OUT y CLOSED: son los
             * tres modos en que la bandeja deja de recibir sin que nada falle
             * visiblemente.
             */
            if (estadoDelCanal === 'SUBSCRIBED') {
              marcarConexion('vivo');
              // Al (re)conectar SIEMPRE se recarga: los cambios ocurridos
              // mientras el socket estuvo caido no se reenvian. Realtime avisa
              // de cambios; la base es la que tiene la historia.
              recargarYAvisar();
            } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(estadoDelCanal)) {
              marcarConexion('caido');
            }
          });

        /*
         * RED DE SEGURIDAD.
         *
         * Realtime puede fallar de maneras que el canal no reporta: una laptop
         * suspendida, un proxy que corta sockets ociosos, una pestana abierta
         * seis horas. Un refresco periodico garantiza que el panel nunca quede
         * mas de un minuto desactualizado, aunque el socket este muerto y crea
         * que no.
         *
         * No es polling agresivo: un minuto contra una consulta de los pedidos
         * activos. Es el piso, no el mecanismo principal.
         */
        latido = setInterval(() => { recargarYAvisar(); }, 60_000);

        // Volver a la pestana es el momento exacto en que alguien va a mirar.
        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', alVolverALaPestana);
        }
        globalThis.addEventListener?.('online', alVolverALaPestana);
      }

      return () => {
        oyentes.delete(oyente);
        if (oyentes.size === 0 && canal) {
          cliente.removeChannel(canal);
          canal = null;
          dejarDeMirarLaSesion?.();
          dejarDeMirarLaSesion = null;
          if (latido) { clearInterval(latido); latido = null; }
          if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', alVolverALaPestana);
          }
          globalThis.removeEventListener?.('online', alVolverALaPestana);
          marcarConexion('desconocido');
        }
      };
    },
  };
}
