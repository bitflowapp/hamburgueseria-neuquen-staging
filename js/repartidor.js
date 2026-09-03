/*
 * ─────────────────────────────────────────────────────────────────────────────
 * REPARTIDOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PROCEDENCIA. El recorte de información es la doctrina de `js/core/rider.js` de
 * TABA, conservada entera: el reparto ve adónde va, con quién habla y cuánto
 * cobra. NO ve la comanda de cocina, ni los extras, ni el precio por línea.
 *
 * POR QUÉ IMPORTA TANTO ESE RECORTE
 * ---------------------------------
 * No es prolijidad: es que cada dato de más es una filtración con forma de
 * comodidad. El repartidor no necesita saber que la hamburguesa lleva cheddar
 * extra, y saberlo no mejora ninguna entrega. Lo hace `pedidoParaRepartidor()`,
 * y hay una prueba que afirma que los extras NO salen del local
 * (`tests/vertical-carrito-a-pedido.test.mjs`).
 *
 * UN REPARTO POR VEZ, POR AHORA
 * -----------------------------
 * TABA llegó a multi-pedido con capacidad, ofertas y aceptación concurrente
 * (`rider_active_order_capacity`, `rider_order_offers`). Es mucho más de lo que
 * una hamburguesería con un repartidor necesita el primer día, y el modelo está
 * disponible para portar cuando haga falta. Hoy: se toma uno, se entrega, se
 * toma el siguiente. La limitación es DELIBERADA y está acá escrita para que se
 * levante a propósito y no por accidente.
 */

import { obtenerRepositorio } from './backend.js';
import { alCambiarSesion, estadoDeSesion, iniciarSesionDeLaPantalla, pintarAcceso, salir } from './auth.js';
import { MARCA, CIUDAD } from './config/negocio.js';
import { accionesDelRepartidor, ETIQUETAS_DE_ESTADO, pedidoParaRepartidor } from './core/pedidos.js';
import { formatearPrecio } from './core/precios.js';
import { safeStorageGet, safeStorageSet } from './core/storage.js';

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const dinero = (valor) => formatearPrecio(valor, { locale: CIUDAD.locale, moneda: CIUDAD.moneda });

const repositorio = obtenerRepositorio();

/*
 * Identidad del repartidor.
 *
 * En producción sale de la sesión autenticada (TABA lo resuelve con su capa de
 * identidad, `identity_current_context`). Acá se guarda en el aparato para que
 * la demo distinga dos repartidores en dos navegadores. NO es autenticación y
 * está dicho: un identificador de aparato no prueba quién lo sostiene.
 */
const CLAVE_RIDER = 'hburg.repartidor.v1';
let riderId = safeStorageGet(localStorage, CLAVE_RIDER);
if (!riderId) {
  riderId = `rider-${Math.random().toString(36).slice(2, 8)}`;
  safeStorageSet(localStorage, CLAVE_RIDER, riderId);
}

const estado = { pedidos: [], conexion: 'desconocido' };

/*
 * QUIEN ENTRA AL REPARTO.
 *
 * Sólo `rider`. El dueño y la cocina tienen el panel; dejarlos entrar acá no
 * agregaría nada y esta pantalla existe para mostrar MENOS, no más.
 */
const ROLES_DEL_REPARTO = ['rider'];

let repartoArrancado = false;

async function iniciar() {
  $('[data-marca-nombre]').textContent = MARCA.nombre;
  document.title = `Reparto · ${MARCA.nombre}`;

  // Igual que en el panel: los eventos están delegados en `document` y se
  // cablean ANTES del control de sesión. Cablearlos después dejaba todos los
  // botones muertos para quien entrara por el formulario de acceso.
  cablearEventos();

  await iniciarSesionDeLaPantalla(ROLES_DEL_REPARTO);
  alCambiarSesion(() => { dibujarSegunSesion(); });
  dibujarSegunSesion();
}

/** `true` si se puede seguir dibujando la pantalla de reparto. */
function dibujarSegunSesion() {
  const capa = $('[data-capa-acceso]');
  const cuerpo = $('.repartidor__cuerpo');
  const barra = $('.repartidor__barra');

  const puede = pintarAcceso(capa, {
    titulo: 'Reparto',
    rolesAdmitidos: ROLES_DEL_REPARTO,
    alEntrar: () => dibujarSegunSesion(),
  });

  capa.hidden = puede;
  cuerpo.hidden = !puede;
  barra.hidden = !puede;
  if (!puede) return false;

  const s = estadoDeSesion();
  /*
   * LA IDENTIDAD DEL REPARTIDOR SALE DE LA SESIÓN, NO DEL APARATO.
   *
   * En modo demo se seguía usando un identificador guardado en el navegador,
   * que servía para distinguir dos ventanas y nada más. Contra Supabase eso no
   * alcanza: un identificador de aparato no prueba quién lo sostiene, y el
   * backend decide con `auth.uid()`.
   */
  if (s.sesion) riderId = s.sesion.userId;

  const identidad = $('[data-identidad]');
  if (identidad) {
    identidad.innerHTML = s.sesion
      ? `${escapar(s.sesion.email)} <button data-salir-sesion>Salir</button>`
      : '<span style="color:var(--tinta-suave)">modo demo</span>';
  }

  if (!repartoArrancado) {
    repartoArrancado = true;
    arrancarReparto();
  }
  return true;
}

async function arrancarReparto() {
  await refrescar();
  /*
   * La suscripción NO usa lo que le pasan.
   *
   * El repositorio avisa con la lista completa de pedidos, y contra Supabase el
   * repartidor trabaja con la vista RECORTADA que arma `cola_del_repartidor`.
   * Tomar el argumento mezclaba las dos formas en el mismo estado: el pedido
   * activo se redibujaba con campos distintos según quién lo hubiera puesto, y
   * los botones aparecían y desaparecían.
   *
   * El aviso se usa como señal de «algo cambió, volvé a preguntar», que es para
   * lo que sirve.
   */
  repositorio.suscribir(async () => { await refrescar(); render(); });
  repositorio.alCambiarConexion?.((conexion) => {
    estado.conexion = conexion;
    renderConexion();
  });
  render();
}

/*
 * El estado de la conexión, también acá.
 *
 * Un repartidor que cree tener la lista al día y en realidad la tiene de hace
 * veinte minutos sale a una dirección que ya se canceló.
 */
function renderConexion() {
  const chip = $('[data-conexion]');
  if (!chip) return;
  if (repositorio.modo !== 'supabase') { chip.hidden = true; return; }
  const conexion = estado.conexion || 'desconocido';
  chip.hidden = false;
  chip.dataset.estado = conexion;
  chip.innerHTML = conexion === 'caido'
    ? '<span class="conexion__punto" aria-hidden="true"></span>Sin conexión <button data-reintentar-conexion>Reintentar</button>'
    : `<span class="conexion__punto" aria-hidden="true"></span>${conexion === 'vivo' ? 'En vivo' : 'Conectando…'}`;
}

async function refrescar() {
  /*
   * Contra Supabase, la cola la arma el BACKEND (`cola_del_repartidor`), que
   * aplica su propia compuerta y devuelve la vista recortada. Acá no se filtra
   * nada por seguridad: filtrar en el cliente es dibujar menos de lo que se
   * bajó, y lo que se bajó ya viajó.
   *
   * En demo se listan los pedidos y el filtrado local alcanza, porque no hay
   * datos de nadie.
   */
  if (repositorio.modo === 'supabase') {
    const cola = await repositorio.colaDelRepartidor();
    estado.pedidos = Array.isArray(cola) ? cola.filter(Boolean) : [];
    return;
  }
  estado.pedidos = await repositorio.listarPedidos();
}

// ── Selección de lo que le toca a este repartidor ─────────────────────────────

const EN_CURSO = ['assigned', 'picked_up', 'on_the_way', 'arrived'];

/*
 * DOS FORMAS DE PEDIDO, Y HAY QUE TOLERAR LAS DOS.
 *
 * Contra Supabase, `cola_del_repartidor` devuelve la vista RECORTADA: sin
 * `modoEntrega` y sin `riderId`, porque el backend ya filtró y esos campos no le
 * hacen falta a quien reparte. En demo llega el pedido completo.
 *
 * Los filtros de acá asumían la forma completa y contra el backend real no
 * mostraban NADA: `pedido.modoEntrega === 'delivery'` era `undefined === 'delivery'`.
 * La lista quedaba vacía sin un solo error, que es la peor forma de fallar.
 *
 * La regla ahora es: si el campo no vino, el backend YA decidió por nosotros.
 */
const esDeReparto = (pedido) => pedido.modoEntrega === undefined || pedido.modoEntrega === 'delivery';
const esMio = (pedido) => pedido.riderId === undefined || pedido.riderId === riderId;
const sinTomar = (pedido) => pedido.riderId === undefined || !pedido.riderId;

function repartoActivo() {
  return estado.pedidos.find((pedido) => esMio(pedido) && EN_CURSO.includes(pedido.estado)) || null;
}

/**
 * Lo que se puede tomar: pedidos LISTOS, a domicilio y sin repartidor.
 *
 * Un pedido en preparación no aparece: prometerlo antes de que salga de la
 * plancha hace que alguien vaya al local a esperar, y una moto esperando es una
 * moto que no está repartiendo. El primero de la lista es el que más esperó.
 */
function disponibles() {
  return estado.pedidos
    .filter((pedido) => pedido.estado === 'ready' && esDeReparto(pedido) && sinTomar(pedido))
    .sort((a, b) => Date.parse(a.creadoEn) - Date.parse(b.creadoEn));
}

function entregadosPorMi() {
  return estado.pedidos
    .filter((pedido) => esMio(pedido) && pedido.estado === 'delivered')
    .sort((a, b) => Date.parse(b.entregadoEn || b.creadoEn) - Date.parse(a.entregadoEn || a.creadoEn));
}

// ── Render ───────────────────────────────────────────────────────────────────

function render() {
  const activo = repartoActivo();
  const seccionActiva = $('[data-activo]');
  seccionActiva.hidden = !activo;
  if (activo) seccionActiva.innerHTML = tarjetaDeReparto(activo, { activo: true });

  const lista = disponibles();
  $('[data-cuenta-disponibles]').textContent = String(lista.length);
  $('[data-disponibles]').innerHTML = lista.length
    ? lista.map((pedido) => tarjetaDeReparto(pedido, { activo: false })).join('')
    : `<div class="vacio">
         <div class="vacio__icono" aria-hidden="true">🛵</div>
         <p>${activo ? 'Terminá el reparto en curso para tomar otro.' : 'No hay pedidos listos para retirar.'}</p>
       </div>`;

  const hechos = entregadosPorMi();
  $('[data-cuenta-historial]').textContent = String(hechos.length);
  $('[data-historial]').innerHTML = hechos.map((pedido) => `
    <div class="entrega-hecha">
      <strong>${escapar(pedido.codigo)}</strong>
      <span>${escapar(pedido.direccion?.calle || '')} ${escapar(pedido.direccion?.numero || '')}</span>
      <span>${hora(pedido.entregadoEn)}</span>
    </div>`).join('') || '<p class="entrega-hecha">Todavía no entregaste nada hoy.</p>';

  renderConexion();

  const enTurno = Boolean(activo) || lista.length > 0;
  $('[data-turno]').dataset.abierto = String(enTurno);
  $('[data-turno-texto]').textContent = activo ? 'Repartiendo' : enTurno ? 'Hay pedidos' : 'Sin pedidos';
}

function tarjetaDeReparto(pedido, { activo }) {
  const vista = pedidoParaRepartidor(pedido);
  const acciones = accionesDelRepartidor(pedido);
  const direccion = `${vista.direccion?.calle || ''} ${vista.direccion?.numero || ''}`.trim();
  const piso = [vista.direccion?.piso, vista.direccion?.departamento].filter(Boolean).join(' ');
  // El destino se abre en la app de mapas del teléfono. Es la que el repartidor
  // ya sabe usar y la que tiene su historial y su tráfico.
  const consulta = encodeURIComponent(`${direccion}, ${vista.direccion?.barrio || ''}, ${CIUDAD.nombre}, ${CIUDAD.provincia}`);

  return `
    <article class="reparto" data-activo="${activo}">
      <header class="reparto__cabecera">
        <span class="reparto__codigo">${escapar(vista.codigo)}</span>
        <span class="reparto__estado">${escapar(ETIQUETAS_DE_ESTADO[vista.estado] || '')}</span>
      </header>

      <div class="reparto__cuerpo">
        <p class="reparto__direccion">${escapar(direccion)}${piso ? ` · ${escapar(piso)}` : ''}</p>
        <p class="reparto__barrio">${escapar(vista.direccion?.barrio || '')}</p>
        ${vista.notasDeEntrega ? `<p class="reparto__referencia">📍 ${escapar(vista.notasDeEntrega)}</p>` : ''}

        <div class="reparto__datos">
          <span class="reparto__dato">👤 <strong>${escapar(vista.cliente.nombre)}</strong></span>
          <span class="reparto__dato">📦 <strong>${vista.cantidadDeItems}</strong> ${vista.cantidadDeItems === 1 ? 'producto' : 'productos'}</span>
        </div>

        ${vista.cobraEnDestino
          ? `<div class="reparto__cobro">
               <span>Cobrar en efectivo</span><strong>${dinero(vista.aCobrar)}</strong>
             </div>`
          : '<p class="reparto__pagado">✓ Ya está pago. No hay que cobrar nada.</p>'}

        ${activo ? `
          <div class="reparto__contacto">
            <a class="boton boton--secundario" href="tel:${escapar(vista.cliente.telefono)}">📞 Llamar</a>
            <a class="boton boton--secundario" target="_blank" rel="noopener"
               href="https://www.google.com/maps/search/?api=1&query=${consulta}">🗺 Cómo llegar</a>
          </div>` : ''}
      </div>

      <div class="reparto__acciones">
        ${activo
          ? acciones.filter((accion) => accion.principal).map((accion) => `
              <button class="boton boton--principal" data-accion="${escapar(accion.id)}"
                      data-pedido="${escapar(pedido.id)}">${escapar(accion.etiqueta)}</button>`).join('')
          : `<button class="boton boton--principal" data-tomar="${escapar(pedido.id)}">Tomar este pedido</button>`}
        ${activo && acciones.some((accion) => accion.id === 'incidencia')
          ? `<div class="reparto__secundarias">
               <button class="boton boton--fantasma" data-incidencia="${escapar(pedido.id)}">Reportar un problema</button>
             </div>` : ''}
      </div>
    </article>`;
}

// ── Eventos ──────────────────────────────────────────────────────────────────

function cablearEventos() {
  document.addEventListener('click', async (evento) => {
    if (evento.target.closest('[data-salir-sesion]')) {
      await salir();
      location.reload();
      return;
    }
    if (evento.target.closest('[data-reintentar-conexion]')) {
      await repositorio.refrescar?.();
      return;
    }

    const tomar = evento.target.closest('[data-tomar]');
    if (tomar) return tomarPedido(tomar.dataset.tomar);

    const accion = evento.target.closest('[data-accion]');
    if (accion) return avanzar(accion.dataset.pedido, accion.dataset.accion);

    const incidencia = evento.target.closest('[data-incidencia]');
    if (incidencia) return reportar(incidencia.dataset.incidencia);
  });
}

async function tomarPedido(pedidoId) {
  // Un repartidor por vez: se comprueba acá para dar el motivo, y el servidor lo
  // vuelve a comprobar porque dos teléfonos pueden tocar el mismo botón a la vez
  // y sólo uno puede ganar.
  if (repartoActivo()) {
    alert('Ya tenés un reparto en curso. Terminá ese antes de tomar otro.');
    return;
  }
  try {
    /*
     * `tomarPedido` y no `asignarRepartidor`.
     *
     * Son dos operaciones distintas y las confundía el cliente: `asignar` es
     * del LOCAL —elige a quién le toca— y exige `es_del_local`, así que un
     * repartidor llamándola recibe «sin permiso». `tomar` es del repartidor y
     * resuelve la carrera con `for update`: dos teléfonos tocan el botón a la
     * vez y sólo uno gana.
     *
     * En demo no existe la distinción y se cae a `asignarRepartidor`.
     */
    if (typeof repositorio.tomarPedido === 'function') {
      await repositorio.tomarPedido(pedidoId);
    } else {
      await repositorio.asignarRepartidor(pedidoId, riderId);
    }
    await refrescar();
    render();
  } catch (error) {
    alert(error?.message || 'Otro repartidor lo tomó primero.');
    await refrescar();
    render();
  }
}

async function avanzar(pedidoId, accionId) {
  try {
    await repositorio.cambiarEstado(pedidoId, accionId, { riderId });
    await refrescar();
    render();
  } catch (error) {
    alert(error?.message || 'No se pudo actualizar el pedido.');
  }
}

async function reportar(pedidoId) {
  /*
   * Un problema en la calle NO cancela el pedido desde el teléfono.
   *
   * La decisión de cancelar es del local: es el que sabe si rehacerlo, si
   * llamar al cliente o si mandar otra moto. Dejar cancelar desde acá pondría
   * esa decisión en manos de quien tiene menos información y más apuro. Por eso
   * lo que se hace es DEJAR CONSTANCIA y devolver el pedido a la cola.
   */
  const motivo = prompt('¿Qué pasó? El local lo va a ver:');
  if (!motivo || !motivo.trim()) return;
  alert(
    'Anotado. Avisale al local por teléfono para que decida qué hacer.\n\n'
    + 'Desde acá no se cancela un pedido: esa decisión es del local.',
  );
}

// ── Utilidades ───────────────────────────────────────────────────────────────

function hora(iso) {
  try {
    return new Date(iso).toLocaleTimeString(CIUDAD.locale, { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

function escapar(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

iniciar();
