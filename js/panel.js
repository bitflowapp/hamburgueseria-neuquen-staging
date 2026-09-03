/*
 * ─────────────────────────────────────────────────────────────────────────────
 * PANEL DEL NEGOCIO · COCINA, PEDIDOS, CARTA Y CONFIGURACIÓN
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PROCEDENCIA. El armazón —pestañas, bandeja por estados, acciones derivadas
 * del estado— viene del business panel de TABA (`js/business/*`), pero su
 * bandeja es de retail: filtra, empaqueta, escanea códigos de barras y factura.
 * Acá el centro es la COCINA, que TABA no tiene.
 *
 * LA REGLA DEL BOTÓN QUE NO MIENTE
 * --------------------------------
 * Cada acción que se dibuja sale de `accionesDelLocal()`, que consulta la MISMA
 * matriz de transiciones que valida el servidor. El panel no puede ofrecer un
 * botón que el backend vaya a rechazar. Es la diferencia entre una interfaz que
 * refleja el sistema y una que lo adivina.
 */

import { obtenerRepositorio } from './backend.js';
import { alCambiarSesion, estadoDeSesion, iniciarSesionDeLaPantalla, pintarAcceso, salir } from './auth.js';
import { MARCA, CIUDAD, configuracionSemilla, decisionesPendientes } from './config/negocio.js';
import {
  accionesDelLocal, comandaDeCocina, conAntiguedad, ETIQUETAS_DE_ESTADO,
  MOTIVOS_DE_CANCELACION, tableroDeCocina, estadoDelDinero,
} from './core/pedidos.js';
import { estaAgotado, formatearPrecio, precioPendiente, sePuedeComprar } from './core/precios.js';

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
const dinero = (valor) => formatearPrecio(valor, { locale: CIUDAD.locale, moneda: CIUDAD.moneda });

const repositorio = obtenerRepositorio();

const estado = {
  seccion: 'cocina',
  pedidos: [],
  carta: { categorias: [], productos: [] },
  filtro: 'activos',
  conexion: 'desconocido',
};

const FILTROS = [
  { id: 'activos', etiqueta: 'Activos', estados: ['submitted', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up', 'on_the_way', 'arrived'] },
  { id: 'nuevos', etiqueta: 'Nuevos', estados: ['submitted', 'accepted'] },
  { id: 'cocina', etiqueta: 'En cocina', estados: ['preparing'] },
  { id: 'reparto', etiqueta: 'En reparto', estados: ['assigned', 'picked_up', 'on_the_way', 'arrived'] },
  { id: 'entregados', etiqueta: 'Entregados', estados: ['delivered'] },
  { id: 'cancelados', etiqueta: 'Cancelados', estados: ['canceled'] },
  { id: 'todos', etiqueta: 'Todos', estados: [] },
];

// ── Arranque ─────────────────────────────────────────────────────────────────

/*
 * QUIEN ENTRA AL PANEL.
 *
 * El repartidor NO: tiene su propia pantalla, con su propia vista recortada.
 * Dejarlo entrar acá le mostraría la comanda de cocina y los pedidos de todos.
 */
const ROLES_DEL_PANEL = ['owner', 'staff'];

async function iniciar() {
  $('[data-marca-nombre]').textContent = MARCA.nombre;
  $('[data-sello]').textContent = MARCA.nombre.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  document.title = `Panel · ${MARCA.nombre}`;

  /*
   * Los eventos se cablean SIEMPRE, antes de decidir si hay sesión.
   *
   * Están delegados en `document`, así que sirven igual para la pantalla de
   * acceso y para el panel. Cablearlos después del control de sesión —como
   * estaba— significaba que quien entrara por el formulario de login se
   * encontraba con un panel dibujado y con TODOS los botones muertos: la
   * comanda aparecía, «Aceptar y preparar» no hacía nada, y no había ningún
   * error que lo explicara. `iniciar()` ya había retornado antes de llegar a
   * `cablearEventos()`.
   */
  cablearEventos();

  await iniciarSesionDeLaPantalla(ROLES_DEL_PANEL);
  // Cada cambio de sesión vuelve a decidir qué se dibuja: cerrar sesión en otra
  // pestaña tiene que cerrarla acá, no dejar una bandeja viva sin permisos.
  alCambiarSesion(() => { dibujarSegunSesion(); });
  dibujarSegunSesion();
}

let panelArrancado = false;

/** `true` si se puede seguir dibujando el panel. */
function dibujarSegunSesion() {
  const capa = $('[data-capa-acceso]');
  const armazon = $('.panel');
  const puede = pintarAcceso(capa, {
    titulo: 'Panel del negocio',
    rolesAdmitidos: ROLES_DEL_PANEL,
    alEntrar: () => dibujarSegunSesion(),
  });

  capa.hidden = puede;
  armazon.hidden = !puede;
  if (!puede) return false;

  const s = estadoDeSesion();
  const identidad = $('[data-identidad]');
  if (identidad) {
    identidad.innerHTML = s.sesion
      ? `${escapar(s.sesion.email)} · ${escapar(s.rol)} <button data-salir-sesion>Salir</button>`
      : '<span style="color:var(--tinta-suave)">modo demo</span>';
  }

  // Arrancar una sola vez: `alCambiarSesion` dispara con cada renovación de
  // token y volver a suscribirse en cada una dejaría canales colgados.
  if (!panelArrancado) {
    panelArrancado = true;
    arrancarPanel();
  }
  return true;
}

async function arrancarPanel() {
  await refrescar();
  repositorio.suscribir(async (pedidos) => {
    estado.pedidos = pedidos;
    estado.carta = await repositorio.obtenerCarta();
    render();
  });
  repositorio.alCambiarConexion?.((conexion) => {
    estado.conexion = conexion;
    renderConexion();
  });

  /*
   * El reloj de cada comanda tiene que avanzar solo. Sin esto, un pedido
   * demorado se sigue viendo «hace 3 min» hasta que alguien toque algo, que es
   * justo cuando la demora ya no importa. Un minuto es la resolución que la
   * cocina necesita: más seguido gasta batería en una tablet sin dar nada.
   */
  setInterval(() => { if (estado.seccion === 'cocina') renderCocina(); }, 60_000);

  render();
}

async function refrescar() {
  estado.pedidos = await repositorio.listarPedidos();
  estado.carta = await repositorio.obtenerCarta();
  estado.disponibilidad = await repositorio.disponibilidad();
}

// ── Render ───────────────────────────────────────────────────────────────────

function render() {
  for (const seccion of $$('[data-seccion]')) {
    seccion.hidden = seccion.dataset.seccion !== estado.seccion;
  }
  for (const pestana of $$('[data-pestana]')) {
    pestana.setAttribute('aria-current', String(pestana.dataset.pestana === estado.seccion));
  }

  const nuevos = estado.pedidos.filter((pedido) => ['submitted', 'accepted'].includes(pedido.estado)).length;
  const globoCocina = $('[data-globo-cocina]');
  globoCocina.textContent = String(nuevos);
  globoCocina.hidden = nuevos === 0;

  const pendientes = decisionesPendientes(configuracionSemilla()).length;
  const globoConfig = $('[data-globo-config]');
  globoConfig.textContent = String(pendientes);
  globoConfig.hidden = pendientes === 0;

  const abierto = Boolean(estado.disponibilidad?.abiertoDelivery || estado.disponibilidad?.abiertoRetiro);
  $('[data-estado-local]').dataset.abierto = String(abierto);
  $('[data-estado-local-texto]').textContent = abierto ? 'Recibiendo pedidos' : 'Cerrado';

  renderConexion();

  if (estado.seccion === 'cocina') renderCocina();
  if (estado.seccion === 'pedidos') renderPedidos();
  if (estado.seccion === 'carta') renderCarta();
  if (estado.seccion === 'configuracion') renderConfiguracion();
}

/*
 * El estado de la conexión en vivo, a la vista.
 *
 * En modo demo no hay socket que mostrar. Contra Supabase, un panel que dejó de
 * recibir tiene que DECIRLO: la bandeja congelada en medio del servicio es la
 * falla más cara de este sistema, porque nadie mira una pantalla que parece
 * estar bien.
 */
function renderConexion() {
  const chip = $('[data-conexion]');
  if (!chip) return;
  if (repositorio.modo !== 'supabase') { chip.hidden = true; return; }

  const conexion = estado.conexion || 'desconocido';
  chip.hidden = false;
  chip.dataset.estado = conexion;
  chip.innerHTML = conexion === 'caido'
    ? '<span class="conexion__punto" aria-hidden="true"></span>'
      + 'Sin conexión en vivo <button data-reintentar-conexion>Reintentar</button>'
    : `<span class="conexion__punto" aria-hidden="true"></span>${
      conexion === 'vivo' ? 'En vivo' : 'Conectando…'}`;
}

const TITULOS_DE_COLUMNA = { nuevos: 'Nuevos', preparando: 'Preparando', listos: 'Listos' };

function renderCocina() {
  const tablero = tableroDeCocina(estado.pedidos);
  const demorados = Object.values(tablero).flat().filter((pedido) => pedido.demorado).length;

  $('[data-resumen-cocina]').innerHTML = demorados
    ? `⚠️ <strong>${demorados}</strong> ${demorados === 1 ? 'pedido demorado' : 'pedidos demorados'}`
    : `<strong>${Object.values(tablero).flat().length}</strong> en curso`;

  $('[data-cocina]').innerHTML = ['nuevos', 'preparando', 'listos'].map((columna) => `
    <section class="columna" data-columna="${columna}">
      <header class="columna__cabecera">
        <span>${TITULOS_DE_COLUMNA[columna]}</span>
        <span class="columna__cuenta">${tablero[columna].length}</span>
      </header>
      <div class="columna__lista">
        ${tablero[columna].length
          ? tablero[columna].map(tarjetaDeComanda).join('')
          : '<p class="columna__vacia">Nada por acá</p>'}
      </div>
    </section>`).join('');
}

function tarjetaDeComanda(pedido) {
  const comanda = comandaDeCocina(pedido);
  const acciones = accionesDelLocal(pedido);

  return `
    <article class="comanda"
             data-demorado="${pedido.demorado}"
             data-por-vencer="${pedido.porVencer && !pedido.demorado}"
             data-nuevo="${pedido.estado === 'submitted'}">
      <header class="comanda__cabecera">
        <span class="comanda__codigo">${escapar(pedido.codigo)}</span>
        <span class="comanda__modo" data-modo="${escapar(pedido.modoEntrega)}">
          ${pedido.modoEntrega === 'pickup' ? 'Retira' : 'Envío'}
        </span>
        <span class="comanda__reloj" title="Esperando / prometido">
          ${pedido.minutosPrometidos
            ? `${pedido.minutosEsperando} / ${pedido.minutosPrometidos} min`
            : `${pedido.minutosEsperando} min`}
        </span>
      </header>

      ${(() => {
        /*
         * EL DINERO, EN SU PROPIA LÍNEA Y CON SU PROPIO TONO.
         *
         * Sólo se dibuja cuando dice algo que la cocina tiene que saber antes de
         * prender la plancha: un pago online que todavía no entró, uno
         * rechazado, o cuánto hay que cobrar al entregar. Un «Pagado» en cada
         * comanda es ruido que hace que nadie lea la línea el día que importa.
         */
        const dinero_ = estadoDelDinero(pedido);
        if (dinero_.clave === 'approved') return '';
        return `<p class="comanda__dinero" data-tono="${escapar(dinero_.tono)}">
          ${escapar(dinero_.texto)}${dinero_.cobraEnDestino ? ` · <strong>${dinero(dinero_.aCobrar)}</strong>` : ''}
        </p>`;
      })()}

      <div class="comanda__lineas">
        ${comanda.lineas.map((linea) => `
          <div class="comanda__linea">
            <span class="comanda__cantidad">${linea.cantidad}×</span>
            <div>
              <div class="comanda__producto">${escapar(linea.nombre)}</div>
              ${linea.modificadores.length ? `
                <div class="comanda__modificadores">
                  ${linea.modificadores.map((modificador) => `
                    <span class="comanda__modificador" data-quitado="${modificador.quitado}">
                      ${escapar(modificador.texto)}
                    </span>`).join('')}
                </div>` : ''}
              ${linea.notas ? `<div class="comanda__nota">“${escapar(linea.notas)}”</div>` : ''}
            </div>
          </div>`).join('')}
      </div>

      <div class="comanda__pie">
        ${comanda.notasDelPedido
          ? `<p class="comanda__aclaracion">📝 ${escapar(comanda.notasDelPedido)}</p>` : ''}
        <div class="comanda__acciones">
          ${acciones.filter((accion) => accion.principal).map((accion) => `
            <button class="boton boton--principal" data-accion="${escapar(accion.id)}"
                    data-pedido="${escapar(pedido.id)}">${escapar(accion.etiqueta)}</button>`).join('')}
          ${acciones.some((accion) => accion.destructiva) ? `
            <button class="boton boton--peligro" style="flex:0 0 auto;min-width:56px"
                    data-accion="canceled" data-pedido="${escapar(pedido.id)}"
                    aria-label="Cancelar ${escapar(pedido.codigo)}">✕</button>` : ''}
        </div>
      </div>
    </article>`;
}

function renderPedidos() {
  $('[data-filtros]').innerHTML = FILTROS.map((filtro) => `
    <button class="filtro" data-filtro="${filtro.id}"
            aria-current="${filtro.id === estado.filtro}">${escapar(filtro.etiqueta)}</button>`).join('');

  const filtro = FILTROS.find((candidato) => candidato.id === estado.filtro) || FILTROS[0];
  const pedidos = estado.pedidos
    .filter((pedido) => (filtro.estados.length ? filtro.estados.includes(pedido.estado) : true))
    .map((pedido) => conAntiguedad(pedido));

  if (!pedidos.length) {
    $('[data-tabla-pedidos]').innerHTML = '<div class="vacio"><p>No hay pedidos con este filtro.</p></div>';
    return;
  }

  $('[data-tabla-pedidos]').innerHTML = `
    <table class="tabla">
      <thead>
        <tr>
          <th>Pedido</th><th>Hora</th><th>Cliente</th><th>Entrega</th>
          <th>Detalle</th><th>Pago</th><th class="tabla__numero">Total</th><th>Estado</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${pedidos.map(filaDePedido).join('')}
      </tbody>
    </table>`;
}

function filaDePedido(pedido) {
  const acciones = accionesDelLocal(pedido);
  const principal = acciones.find((accion) => accion.principal);
  const direccion = pedido.modoEntrega === 'pickup'
    ? 'Retira en el local'
    : `${escapar(pedido.direccion?.calle || '')} ${escapar(pedido.direccion?.numero || '')}`
      + (pedido.direccion?.barrio ? `<br><span class="fila-producto__meta">${escapar(pedido.direccion.barrio)}</span>` : '');

  return `
    <tr>
      <td><strong>${escapar(pedido.codigo)}</strong></td>
      <td>${hora(pedido.creadoEn)}<br><span class="fila-producto__meta">${pedido.minutosEsperando} min</span></td>
      <td>${escapar(pedido.cliente?.nombre || '')}<br>
          <span class="fila-producto__meta">${escapar(pedido.cliente?.telefono || '')}</span></td>
      <td>${direccion}</td>
      <td>
        ${pedido.lineas.map((linea) => `
          ${linea.cantidad}× ${escapar(linea.nombre)}
          ${(linea.opciones || []).filter((opcion) => opcion.grupoTipo === 'extra' || opcion.grupoTipo === 'quitar').length
            ? `<br><span class="fila-producto__meta">${(linea.opciones || [])
                .filter((opcion) => opcion.grupoTipo === 'extra' || opcion.grupoTipo === 'quitar')
                .map((opcion) => `${opcion.grupoTipo === 'quitar' ? '−' : '+'} ${escapar(opcion.opcionNombre)}`)
                .join(', ')}</span>` : ''}
          ${linea.notas ? `<br><span class="fila-producto__meta">“${escapar(linea.notas)}”</span>` : ''}
        `).join('<br>')}
        ${pedido.notas ? `<br><span class="fila-producto__meta">📝 ${escapar(pedido.notas)}</span>` : ''}
      </td>
      <td>
        ${escapar(etiquetaDePago(pedido.medioDePago))}
        ${(() => {
          const dinero_ = estadoDelDinero(pedido);
          return `<br><span class="pastilla-pago" data-tono="${escapar(dinero_.tono)}">${escapar(dinero_.texto)}</span>`;
        })()}
      </td>
      <td class="tabla__numero">
        ${dinero(pedido.totales.total)}
        ${pedido.modoEntrega === 'delivery'
          ? `<br><span class="fila-producto__meta">envío ${dinero(pedido.totales.costoEnvio)}</span>` : ''}
      </td>
      <td>
        <span class="pastilla" data-estado="${escapar(pedido.estado)}">${escapar(ETIQUETAS_DE_ESTADO[pedido.estado])}</span>
        ${pedido.motivoCancelacion ? `<br><span class="fila-producto__meta">${escapar(pedido.motivoCancelacion)}</span>` : ''}
      </td>
      <td>
        ${principal ? `<button class="boton boton--secundario" style="min-height:38px"
            data-accion="${escapar(principal.id)}" data-pedido="${escapar(pedido.id)}">${escapar(principal.etiqueta)}</button>` : ''}
      </td>
    </tr>`;
}

function renderCarta() {
  const porCategoria = estado.carta.categorias.map((categoria) => {
    const productos = estado.carta.productos.filter((producto) => producto.categoria === categoria.id);
    if (!productos.length) return '';
    return `
      <h2 style="font-size:var(--texto-lg);margin:var(--e5) 0 var(--e2)">${escapar(categoria.nombre)}</h2>
      <div class="productos-panel">${productos.map(filaDeProducto).join('')}</div>`;
  }).join('');
  $('[data-carta-panel]').innerHTML = porCategoria;
}

function filaDeProducto(producto) {
  const grupos = (producto.grupos || []).map((grupo) => grupo.nombre);
  return `
    <div class="fila-producto" data-pedible="${sePuedeComprar(producto)}">
      <div>
        <div class="fila-producto__nombre">${escapar(producto.nombre)}</div>
        <div class="fila-producto__meta">
          ${producto.controlaStock ? `Stock: ${producto.stock}` : 'Se prepara al momento'}
          ${grupos.length ? ` · ${escapar(grupos.join(', '))}` : ''}
          ${precioPendiente(producto) ? ' · <strong style="color:var(--alerta)">precio a confirmar</strong>' : ''}
        </div>
      </div>
      <label class="solo-lectores" for="precio-${escapar(producto.id)}">Precio de ${escapar(producto.nombre)}</label>
      <input class="precio-editable" id="precio-${escapar(producto.id)}" type="number" min="0" step="100"
             value="${Number(producto.precio) || 0}" data-precio-de="${escapar(producto.id)}" />
      <label class="interruptor">
        <input type="checkbox" data-disponible-de="${escapar(producto.id)}" ${producto.disponible ? 'checked' : ''} />
        <span>En carta</span>
      </label>
      <label class="interruptor">
        <input type="checkbox" data-agotado-de="${escapar(producto.id)}" ${estaAgotado(producto) ? 'checked' : ''} />
        <span>Agotado</span>
      </label>
    </div>`;
}

function renderConfiguracion() {
  const config = configuracionSemilla();
  const pendientes = decisionesPendientes(config);

  $('[data-configuracion]').innerHTML = `
    <div class="tarjeta">
      <h2>Antes de vender de verdad</h2>
      <p>
        Estas decisiones son comerciales y todavía no están tomadas. Mientras falte
        alguna, la tienda avisa que es una vista previa en vez de aparentar que
        está lista. Se cambian todas en <code>js/config/negocio.js</code>, sin
        tocar una línea de lógica.
      </p>
      ${pendientes.length ? `
        <div class="pendientes">
          ${pendientes.map((item) => `
            <div class="pendiente">
              <span class="pendiente__icono" aria-hidden="true">!</span>
              <span>${escapar(item.que)}</span>
              <code>${escapar(item.campo)}</code>
            </div>`).join('')}
        </div>`
        : '<p style="color:var(--exito);margin-top:var(--e3)">✓ Todo listo para vender.</p>'}
    </div>

    <div class="tarjeta">
      <h2>Estado del local</h2>
      <p>Cortar la recepción de pedidos sin cerrar la tienda: la carta se sigue viendo y no se puede pedir.</p>
      <div style="display:flex;gap:var(--e3);margin-top:var(--e4);flex-wrap:wrap">
        <label class="interruptor">
          <input type="checkbox" data-comercio="abiertoDelivery" ${estado.disponibilidad?.abiertoDelivery ? 'checked' : ''} />
          <span>Recibe pedidos con envío</span>
        </label>
        <label class="interruptor">
          <input type="checkbox" data-comercio="abiertoRetiro" ${estado.disponibilidad?.abiertoRetiro ? 'checked' : ''} />
          <span>Recibe pedidos para retirar</span>
        </label>
      </div>
    </div>

    <div class="tarjeta">
      <h2>Zonas de reparto</h2>
      <p>
        Neuquén Capital. Cada zona tiene su costo y su mínimo; el backend resuelve
        la cobertura contra el barrio declarado o contra un polígono.
        <strong>Los valores de abajo son de ejemplo</strong> hasta que el comercio
        fije los suyos.
      </p>
      <table class="tabla" style="margin-top:var(--e4)">
        <thead><tr><th>Zona</th><th class="tabla__numero">Envío</th><th class="tabla__numero">Mínimo</th><th class="tabla__numero">Estimado</th></tr></thead>
        <tbody>
          ${repositorio._estado.zonas.map((zona) => `
            <tr>
              <td>${escapar(zona.nombre)}</td>
              <td class="tabla__numero">${dinero(zona.costoEnvio)}</td>
              <td class="tabla__numero">${zona.minimoSubtotal ? dinero(zona.minimoSubtotal) : '—'}</td>
              <td class="tabla__numero">${zona.etaMinutos ? `${zona.etaMinutos} min` : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="tarjeta">
      <h2>Datos de prueba</h2>
      <p>Borra todos los pedidos de esta demo. No afecta la carta.</p>
      <button class="boton boton--peligro" data-reiniciar style="margin-top:var(--e3)">Borrar los pedidos de prueba</button>
    </div>`;
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

    const pestana = evento.target.closest('[data-pestana]');
    if (pestana) { estado.seccion = pestana.dataset.pestana; return render(); }

    const filtro = evento.target.closest('[data-filtro]');
    if (filtro) { estado.filtro = filtro.dataset.filtro; return render(); }

    const accion = evento.target.closest('[data-accion]');
    if (accion) return ejecutarAccion(accion.dataset.pedido, accion.dataset.accion);

    if (evento.target.closest('[data-reiniciar]')) {
      // Es destructivo y no se puede deshacer: se pregunta.
      if (!confirm('¿Borrar todos los pedidos de prueba?')) return;
      await repositorio.reiniciar();
      await refrescar();
      return render();
    }
  });

  document.addEventListener('change', async (evento) => {
    const entrada = evento.target;

    if (entrada.dataset.precioDe) {
      const precio = Math.max(0, Math.round(Number(entrada.value) || 0));
      // Un precio en cero no es un precio: se guarda como PENDIENTE, y el
      // producto deja de poder pedirse. Es el mismo contrato que el servidor.
      await repositorio.actualizarProducto(entrada.dataset.precioDe, {
        precio,
        estadoPrecio: precio > 0 ? 'confirmed' : 'pending',
      });
      return refrescarYRender();
    }
    if (entrada.dataset.disponibleDe) {
      await repositorio.actualizarProducto(entrada.dataset.disponibleDe, { disponible: entrada.checked });
      return refrescarYRender();
    }
    if (entrada.dataset.agotadoDe) {
      await repositorio.actualizarProducto(entrada.dataset.agotadoDe, { agotado: entrada.checked });
      return refrescarYRender();
    }
    if (entrada.dataset.comercio) {
      await repositorio.actualizarComercio({ [entrada.dataset.comercio]: entrada.checked });
      return refrescarYRender();
    }
  });
}

async function ejecutarAccion(pedidoId, accionId) {
  try {
    if (accionId === 'canceled') {
      const motivo = prompt(`Motivo de la cancelación:\n\n${MOTIVOS_DE_CANCELACION.join('\n')}`);
      // Cancelar sin motivo se rechaza igual del lado del servidor; frenarlo acá
      // evita el viaje y el mensaje de error.
      if (!motivo || !motivo.trim()) return;
      await repositorio.cambiarEstado(pedidoId, 'canceled', { motivo: motivo.trim() });
    } else {
      await repositorio.cambiarEstado(pedidoId, accionId);
    }
    await refrescarYRender();
  } catch (error) {
    alert(error?.message || 'No se pudo aplicar el cambio.');
  }
}

async function refrescarYRender() {
  await refrescar();
  render();
}

// ── Utilidades ───────────────────────────────────────────────────────────────

function etiquetaDePago(id) {
  return { cash: 'Efectivo', transfer: 'Transferencia', mercado_pago: 'Mercado Pago' }[id] || id || '—';
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

iniciar();
