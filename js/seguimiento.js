/*
 * ─────────────────────────────────────────────────────────────────────────────
 * SEGUIMIENTO DEL PEDIDO · SIN CUENTA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Una página aparte, y no una vista del catálogo, por dos razones:
 *
 * 1. Se abre desde OTRO aparato. El enlace llega por WhatsApp al teléfono de
 *    quien recibe el pedido, que puede no ser quien lo hizo, y ahí no hay
 *    carrito ni sesión ni nada del navegador original.
 * 2. Se recarga cada tanto durante media hora. Cargar la tienda entera para eso
 *    es gastar batería y datos en una pantalla que sólo muestra un estado.
 *
 * LA AUTORIDAD ES EL TOKEN, Y ESTÁ EN LA URL
 * `?t=<32 hex>`. No se guarda en `localStorage`: el enlace ES la credencial y
 * duplicarla en el almacenamiento sólo agrega un lugar del que se puede filtrar.
 *
 * QUÉ NO PUEDE HACER ESTA PÁGINA
 * Consultar otro pedido, enumerar, ni cambiar un estado. La RPC
 * `seguimiento_publico` devuelve un subconjunto —sin teléfono ni calle— y es lo
 * único que esta pantalla puede llamar.
 */

import { MARCA, CIUDAD } from './config/negocio.js';
import { formatearPrecio } from './core/precios.js';
import { ETIQUETAS_PARA_EL_CLIENTE } from './core/pedidos.js';

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const dinero = (valor) => formatearPrecio(valor, { locale: CIUDAD.locale, moneda: CIUDAD.moneda });

const PASOS_ENVIO = ['submitted', 'accepted', 'preparing', 'ready', 'on_the_way', 'delivered'];
const PASOS_RETIRO = ['submitted', 'accepted', 'preparing', 'ready', 'delivered'];

/*
 * Cada cuánto se vuelve a preguntar.
 *
 * Es polling, y es deliberado: Realtime necesitaría una suscripción autenticada
 * y esta persona no tiene cuenta. Veinte segundos es suficiente para que un
 * cambio se note enseguida y lo bastante espaciado para no gastar la batería de
 * un teléfono que va a quedar media hora con esta pantalla abierta.
 *
 * En un pedido cerrado se deja de preguntar: no va a cambiar más.
 */
const CADA_MS = 20_000;

const token = new URLSearchParams(location.search).get('t') || '';
let temporizador = null;

async function consultar() {
  const config = globalThis.__HAMBURGUESERIA_RUNTIME_CONFIG__;

  if (!config?.supabaseUrl || !config?.clavePublicable) {
    pintarMensaje(
      'Seguimiento no disponible',
      'Esta copia de la tienda no está conectada a un backend.',
    );
    return null;
  }
  if (!/^[a-f0-9]{32}$/.test(token)) {
    pintarMensaje(
      'Enlace incompleto',
      'Abrí el enlace tal como te llegó, sin recortarlo.',
    );
    return null;
  }

  /*
   * `fetch` directo en vez del cliente de Supabase.
   *
   * Esta página hace UNA consulta a UNA función. Bajar la biblioteca entera
   * —con Auth, Realtime y Storage adentro— para eso es cargar cientos de
   * kilobytes en el teléfono de alguien que sólo quiere ver si su hamburguesa
   * salió.
   */
  const respuesta = await fetch(`${config.supabaseUrl}/rest/v1/rpc/seguimiento_publico`, {
    method: 'POST',
    headers: {
      apikey: config.clavePublicable,
      authorization: `Bearer ${config.clavePublicable}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_token: token }),
  }).catch(() => null);

  if (!respuesta?.ok) {
    marcarActualizado('sin conexión');
    return null;
  }
  return respuesta.json();
}

function render(pedido) {
  const contenedor = $('[data-seguimiento]');

  if (!pedido) {
    pintarMensaje(
      'No encontramos ese pedido',
      'Puede que el enlace esté vencido o incompleto. Escribile al local si tenés dudas.',
    );
    return;
  }

  const flujo = pedido.modoEntrega === 'pickup' ? PASOS_RETIRO : PASOS_ENVIO;
  const indice = flujo.indexOf(pedido.estado);
  const cancelado = pedido.estado === 'canceled';
  const momentos = pedido.momentos || {};
  const momentoDe = {
    accepted: momentos.aceptado, preparing: momentos.preparando, ready: momentos.listo,
    on_the_way: momentos.retirado, delivered: momentos.entregado,
  };

  contenedor.innerHTML = `
    <p style="color:var(--tinta-suave);font-size:var(--texto-sm)">Tu pedido</p>
    <h1 class="seguimiento__codigo">${escapar(pedido.codigo)}</h1>

    <h2 style="margin-top:var(--e4);font-size:var(--texto-xl)">
      ${escapar(ETIQUETAS_PARA_EL_CLIENTE[pedido.estado] || 'En curso')}
    </h2>

    ${cancelado ? `
      <div class="aviso" data-tono="error" style="margin-top:var(--e4)">
        Este pedido fue cancelado${pedido.motivoCancelacion ? `: ${escapar(pedido.motivoCancelacion)}` : ''}.
      </div>`
      : `<p style="color:var(--tinta-media);margin-top:var(--e2)">
           ${pedido.modoEntrega === 'pickup'
             ? `Lo retirás en el local. Listo en ~${pedido.minutosPreparacion} minutos.`
             : `Te lo llevamos${pedido.barrio ? ` a ${escapar(pedido.barrio)}` : ''}.`}
         </p>`}

    ${pedido.estadoDePago === 'approved'
      ? '<div class="aviso" data-tono="exito" style="margin-top:var(--e4)">Pago acreditado ✓</div>'
      : pedido.estadoDePago === 'rejected'
        ? '<div class="aviso" data-tono="error" style="margin-top:var(--e4)">El pago fue rechazado.</div>'
        : ''}

    ${cancelado ? '' : `
      <div class="pasos">
        ${flujo.map((paso, i) => `
          <div class="paso" data-estado="${i < indice ? 'hecho' : i === indice ? 'actual' : 'pendiente'}">
            <span class="paso__marca" aria-hidden="true">${i < indice ? '✓' : i + 1}</span>
            <div>
              <div class="paso__titulo">${escapar(ETIQUETAS_PARA_EL_CLIENTE[paso])}</div>
              ${momentoDe[paso] ? `<div class="paso__momento">${hora(momentoDe[paso])}</div>` : ''}
            </div>
          </div>`).join('')}
      </div>`}

    <div class="totales">
      <h3 style="font-size:var(--texto-lg);margin-bottom:var(--e2)">Tu pedido</h3>
      ${(pedido.lineas || []).map((linea) => `
        <div class="totales__fila">
          <span>
            ${linea.cantidad}× ${escapar(linea.nombre)}
            ${linea.configuracion ? `<br><span class="fila-producto__meta">${escapar(linea.configuracion)}</span>` : ''}
          </span>
          <span>${dinero(linea.subtotal)}</span>
        </div>`).join('')}
      <div class="totales__fila"><span>Subtotal</span><span>${dinero(pedido.totales.subtotal)}</span></div>
      ${pedido.modoEntrega === 'delivery'
        ? `<div class="totales__fila"><span>Envío</span><span>${dinero(pedido.totales.costoEnvio)}</span></div>` : ''}
      <div class="totales__fila" data-destacada="true">
        <span>Total</span><span>${dinero(pedido.totales.total)}</span>
      </div>
    </div>`;
}

function pintarMensaje(titulo, detalle) {
  $('[data-seguimiento]').innerHTML = `
    <div class="vacio">
      <div class="vacio__icono" aria-hidden="true">🔎</div>
      <h2>${escapar(titulo)}</h2>
      <p>${escapar(detalle)}</p>
    </div>`;
}

function marcarActualizado(texto) {
  const chip = $('[data-actualizado]');
  if (chip) chip.textContent = texto;
}

async function ciclo() {
  const pedido = await consultar();
  render(pedido);

  if (pedido) {
    marcarActualizado(`Actualizado ${hora(new Date().toISOString())}`);
    // Un pedido cerrado no cambia más: se deja de preguntar en vez de gastar
    // batería consultando algo que ya terminó.
    if (['delivered', 'canceled'].includes(pedido.estado)) {
      if (temporizador) clearInterval(temporizador);
      marcarActualizado('Pedido cerrado');
    }
  }
}

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

$('[data-marca-nombre]').textContent = MARCA.nombre;
$('[data-sello]').textContent = MARCA.nombre.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
document.title = `Seguí tu pedido · ${MARCA.nombre}`;

await ciclo();
temporizador = setInterval(ciclo, CADA_MS);

// Volver a la pestaña es cuando alguien mira: se consulta ya, sin esperar el
// próximo ciclo.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') ciclo();
});
