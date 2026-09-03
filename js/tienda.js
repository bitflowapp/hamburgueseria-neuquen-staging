/*
 * ─────────────────────────────────────────────────────────────────────────────
 * LA TIENDA — CONTROLADOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PROCEDENCIA. La forma —un controlador delgado sobre módulos de dominio puros,
 * render por `innerHTML` sobre plantillas, estado en un objeto y suscripción—
 * es la de `js/app.js` de TABA. Lo que NO se recicló es su `ui.js`: 217 KB que
 * saben de góndolas, packs, alcohol y stories.
 *
 * REGLA QUE ESTE ARCHIVO RESPETA
 * ------------------------------
 * Acá no se calcula un precio. Se PIDE. Todo número que se muestra sale de
 * `core/carrito.js` o del repositorio, que a su vez lo deriva como lo deriva el
 * servidor. Un `precio * cantidad` escrito en la capa de vista es exactamente
 * cómo el total de la pantalla deja de coincidir con el que se cobra.
 */

import { MARCA, LOCAL, CIUDAD, SERVICIO, BARRIOS_NEUQUEN, MEDIOS_DE_PAGO,
  configuracionSemilla, decisionesPendientes } from './config/negocio.js';
import { ErrorDePedido } from './repositories/repositorio-sandbox.js';
import { obtenerRepositorio } from './backend.js';
import {
  agregarAlCarrito, cambiarCantidad, cantidadDeItems, carritoVacio,
  lineasParaElServidor, quitarLinea, reconciliarCarrito, resumenDelCarrito, validarParaCheckout,
} from './core/carrito.js';
import {
  normalizarGrupos, precioUnitarioConfigurado, resolverSeleccion, seleccionPorDefecto,
} from './core/modificadores.js';
import { estaAgotado, formatearPrecio, precioPendiente, sePuedeComprar } from './core/precios.js';
import { seguimientoDelCliente, ETIQUETAS_PARA_EL_CLIENTE } from './core/pedidos.js';
import { isValidArgentinePhone, validateCustomerName } from './core/validators.js';
import { safeJsonParse, safeStorageGet, safeStorageSet } from './core/storage.js';
import { juegoDeFoto, rutaDeApp } from './core/rutas.js';

const CLAVE_CARRITO = 'hburg.carrito.v1';
const CLAVE_PEDIDO = 'hburg.ultimo-pedido.v1';
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

const dinero = (valor) => formatearPrecio(valor, { locale: CIUDAD.locale, moneda: CIUDAD.moneda });

// ── Estado ───────────────────────────────────────────────────────────────────

const estado = {
  vista: 'carta',
  carta: { categorias: [], productos: [] },
  categoriaActiva: 'todo',
  carrito: carritoVacio(),
  disponibilidad: null,
  entrega: null,   // cobertura resuelta por el backend para el barrio elegido
  hoja: null,        // { producto, seleccion, cantidad, notas }
  pedido: null,
  enviando: false,
};

/*
 * El repositorio se pide a `backend.js`, que decide cuál toca según
 * `runtime-config.js`. La tienda no sabe si le tocó la demo o Supabase, y ése
 * es exactamente el punto: el día del backend no se toca este archivo.
 */
const repositorio = obtenerRepositorio();

// ── Arranque ─────────────────────────────────────────────────────────────────

async function iniciar() {
  aplicarMarca();
  restaurarCarrito();
  estado.carta = await repositorio.obtenerCarta();
  estado.disponibilidad = await repositorio.disponibilidad();

  // El carrito guardado se reconcilia contra la carta VIVA antes de mostrarse.
  // Un carrito de ayer puede tener productos que ya no existen.
  const { carrito, cambios } = reconciliarCarrito(estado.carrito, estado.carta.productos);
  estado.carrito = carrito;
  if (cambios.length) estado.avisosDelCarrito = cambios.map((cambio) => cambio.texto);

  cablearEventos();
  restaurarUltimoPedido();
  render();
}

function aplicarMarca() {
  const iniciales = MARCA.nombre.split(/\s+/).map((palabra) => palabra[0]).join('').slice(0, 2).toUpperCase();
  $('[data-sello]').textContent = iniciales;
  $('[data-marca-nombre]').textContent = MARCA.nombre;
  $('[data-marca-bajada]').textContent = MARCA.bajada;
  $('[data-portada-titulo]').innerHTML = claimDestacado(MARCA.claim);
  $('[data-portada-bajada]').textContent = MARCA.claimSecundario;
  $('[data-portada-sello]').textContent = `Parrilla · ${CIUDAD.nombre} Capital`;
  document.title = `${MARCA.nombre} · Hamburguesas en ${CIUDAD.nombre}`;
}

/**
 * La última palabra del claim va en oro.
 *
 * Es tipografía, no contenido: el ojo termina la frase en el color de la marca
 * y el título deja de ser un bloque plano. Se hace acá y no en el HTML para que
 * cambiar el claim en `negocio.js` siga funcionando sin tocar la plantilla.
 */
function claimDestacado(claim) {
  const palabras = String(claim || '').trim().split(/\s+/);
  if (palabras.length < 2) return escapar(claim);
  const ultima = palabras.pop();
  return `${escapar(palabras.join(' '))} <em>${escapar(ultima)}</em>`;
}

// ── Render ───────────────────────────────────────────────────────────────────

function render() {
  for (const seccion of $$('[data-vista]')) {
    const activa = seccion.dataset.vista === estado.vista;
    seccion.hidden = !activa;
  }
  if (estado.vista === 'carta') {
    renderPortada(); renderVentajas(); renderDestacados();
    renderCategorias(); renderCarta(); renderPie();
  }
  if (estado.vista === 'carrito') renderCarrito();
  if (estado.vista === 'checkout') renderCheckout();
  if (estado.vista === 'seguimiento') renderSeguimiento();
  renderBarraDelCarrito();
  renderEstadoDelLocal();
}

function renderEstadoDelLocal() {
  const abierto = Boolean(estado.disponibilidad?.abiertoDelivery || estado.disponibilidad?.abiertoRetiro);
  const chip = $('[data-estado-local]');
  chip.dataset.abierto = String(abierto);
  $('[data-estado-local-texto]').textContent = abierto ? 'Abierto ahora' : 'Cerrado';
}

/*
 * LA PORTADA NO LLEVA EL ESTADO DE CONFIGURACIÓN.
 *
 * Lo que falta cargar es información del OPERADOR y se resuelve en el panel,
 * que es el único lugar donde se puede hacer algo al respecto. La versión
 * anterior lo ponía acá y el resultado era una tienda que se presentaba
 * diciendo que no estaba lista.
 *
 * El panel lo sigue mostrando —y con la lista completa, no con una cuenta— así
 * que el dato no se pierde: cambia de destinatario.
 */
function renderPortada() {
  const datos = [];

  if (LOCAL.direccionVerificada && LOCAL.direccion) {
    datos.push({ icono: '📍', texto: `<strong>${escapar(LOCAL.direccion)}</strong>` });
  }

  // El envío se anuncia SÓLO si el comercio lo fijó. Un «$ 0» escrito por un
  // guion se lee como envío gratis, y después se cobra.
  const envio = estado.disponibilidad?.entrega;
  if (envio?.cubierta) {
    datos.push({ icono: '🛵', texto: `Envío desde <strong>${dinero(envio.costoEnvio)}</strong>`, tono: 'oro' });
  }

  datos.push({ icono: '⏱', texto: `Listo en <strong>${SERVICIO.minutosPreparacionPorDefecto} min</strong>` });

  if (estado.disponibilidad?.abiertoRetiro) {
    datos.push({ icono: '🏠', texto: 'También <strong>retirás en el local</strong>' });
  }

  $('[data-portada-datos]').innerHTML = datos.map((dato) => `
    <li class="dato"${dato.tono ? ` data-tono="${dato.tono}"` : ''}>
      <span aria-hidden="true">${dato.icono}</span>${dato.texto}
    </li>`).join('');
}

/**
 * Las cuatro razones para comprar acá.
 *
 * Se arman con lo que el comercio TIENE CONFIRMADO. Una ventaja que promete un
 * envío sin costo fijado, o un horario que nadie cargó, es peor que no
 * anunciarla: es la primera promesa que el local incumple.
 */
function renderVentajas() {
  const ventajas = [
    { icono: '🔥', titulo: 'Hecha al momento', detalle: 'A la parrilla, cuando la pedís' },
    { icono: '🛵', titulo: 'Te la llevamos', detalle: `Reparto en ${CIUDAD.nombre}` },
    { icono: '🏠', titulo: 'O la retirás', detalle: 'Sin costo de envío' },
    { icono: '📍', titulo: 'Seguí tu pedido', detalle: 'Desde la cocina hasta tu puerta' },
  ];
  $('[data-ventajas]').innerHTML = ventajas.map((ventaja) => `
    <li class="ventaja">
      <span class="ventaja__icono" aria-hidden="true">${ventaja.icono}</span>
      <span>
        <span class="ventaja__titulo">${escapar(ventaja.titulo)}</span><br />
        <span class="ventaja__detalle">${escapar(ventaja.detalle)}</span>
      </span>
    </li>`).join('');
}

/**
 * Destacados: lo que el comercio marcó con insignia, y si no hay ninguno, lo
 * primero de la categoría principal.
 *
 * Existe porque una carta de diecinueve productos sin un punto de entrada
 * obliga a decidir entre diecinueve cosas, y quien tiene que decidir demasiado
 * no decide nada. La sección se OCULTA si no hay al menos dos: un carrusel de
 * un solo elemento no es un carrusel, es una tarjeta desalineada.
 */
function renderDestacados() {
  const pedibles = estado.carta.productos.filter(sePuedeComprar);
  const conInsignia = pedibles.filter((producto) => producto.insignia);

  /*
   * Los marcados primero, y después se COMPLETA hasta seis.
   *
   * Antes se mostraban sólo los marcados, y con dos productos marcados el
   * carrusel quedaba con dos tarjetas y medio monitor vacío al lado: una
   * sección destacada que parece un error de carga destaca en contra.
   *
   * Se completa con lo que ya está ordenado por el comercio, así que el relleno
   * sigue siendo su criterio y no uno inventado acá.
   */
  const elegidos = [...conInsignia];
  for (const producto of pedibles) {
    if (elegidos.length >= 6) break;
    if (!elegidos.includes(producto)) elegidos.push(producto);
  }

  const seccion = $('[data-destacados]');
  seccion.hidden = elegidos.length < 2;
  if (seccion.hidden) return;
  $('[data-destacados-lista]').innerHTML = elegidos.map(tarjetaDeProducto).join('');
}

function renderPie() {
  const mediosActivos = MEDIOS_DE_PAGO.filter((medio) => medio.habilitado);
  const pendientes = decisionesPendientes(configuracionSemilla());

  $('[data-pie]').innerHTML = `
    <div class="pie__bloque">
      <h3>${escapar(MARCA.nombre)}</h3>
      <p>${escapar(MARCA.bajada)}</p>
      ${LOCAL.direccionVerificada && LOCAL.direccion ? `<p>${escapar(LOCAL.direccion)}</p>` : ''}
      ${LOCAL.whatsappVerificado && LOCAL.whatsapp
        ? `<p><a href="https://wa.me/${escapar(LOCAL.whatsapp.replace(/\D/g, ''))}">WhatsApp ${escapar(LOCAL.whatsapp)}</a></p>`
        : ''}
    </div>

    <div class="pie__bloque">
      <h3>Cómo pagás</h3>
      <div class="pie__pagos">
        ${mediosActivos.map((medio) => `
          <span class="chip-pago">
            <span aria-hidden="true">${iconoDePago(medio.id)}</span>${escapar(medio.etiqueta)}
          </span>`).join('')}
      </div>
    </div>

    <div class="pie__bloque">
      <h3>Cómo lo recibís</h3>
      <ul>
        <li>🛵 Envío a domicilio en ${escapar(CIUDAD.nombre)}</li>
        <li>🏠 Retiro en el local</li>
        <li>⏱ Listo en ~${SERVICIO.minutosPreparacionPorDefecto} minutos</li>
      </ul>
    </div>

    <p class="pie__legal">
      ${pendientes.length
        ? `Vista previa · el comercio todavía está cargando ${pendientes.length} datos.
           <a href="${escapar(rutaDeApp('panel/'))}">Panel</a> · `
        : ''}
      Las fotos son de referencia.
    </p>`;
}

const ICONOS_DE_PAGO = { cash: '💵', transfer: '🏦', mercado_pago: '💳' };
const iconoDePago = (id) => ICONOS_DE_PAGO[id] || '💳';

function renderCategorias() {
  const contenedor = $('[data-categorias]');
  const categorias = [{ id: 'todo', nombre: 'Todo', icono: '🔥' }, ...estado.carta.categorias];
  contenedor.innerHTML = categorias.map((categoria) => `
    <button class="categoria" role="tab" data-categoria="${escapar(categoria.id)}"
            aria-current="${categoria.id === estado.categoriaActiva}">
      <span aria-hidden="true">${categoria.icono || ''}</span>${escapar(categoria.nombre)}
    </button>`).join('');
}

function renderCarta() {
  const contenedor = $('[data-carta]');
  const categorias = estado.categoriaActiva === 'todo'
    ? estado.carta.categorias
    : estado.carta.categorias.filter((categoria) => categoria.id === estado.categoriaActiva);

  contenedor.innerHTML = categorias.map((categoria) => {
    const productos = estado.carta.productos.filter((producto) => producto.categoria === categoria.id);
    if (!productos.length) return '';
    return `
      <section class="seccion" id="cat-${escapar(categoria.id)}">
        <div class="seccion__cabecera">
          <h2 class="seccion__titulo display">
            ${escapar(categoria.nombre)} <small>${productos.length}</small>
          </h2>
        </div>
        <div class="grilla">${productos.map(tarjetaDeProducto).join('')}</div>
      </section>`;
  }).join('') || '<div class="vacio"><p>No hay productos en esta categoría.</p></div>';
}

/**
 * Qué tono lleva una insignia.
 *
 * El texto de la insignia lo escribe el comercio desde el panel, así que el
 * tono NO puede depender de que escriba exactamente «Más pedida». Se reconoce
 * por lo que quiso decir y, ante la duda, cae en `neutra`: una insignia que no
 * se entiende se dibuja discreta en vez de robarle el bordó a la que sí.
 */
function tipoDeInsignia(texto) {
  const t = plegar(texto);
  if (!t) return '';
  if (/mas pedid|favorit|top|clasic/.test(t)) return 'mas-pedida';
  if (/combo|promo|oferta|descuent|2x/.test(t)) return /combo/.test(t) ? 'combo' : 'promo';
  if (/nuev|novedad/.test(t)) return 'nuevo';
  return 'neutra';
}

function tarjetaDeProducto(producto) {
  const pedible = sePuedeComprar(producto);
  const agotado = estaAgotado(producto);
  const sinPrecio = precioPendiente(producto);
  // «Desde» sólo cuando alguna opción PUEDE subir el precio. Si todos los
  // deltas son cero o negativos, el precio de tarjeta es el precio real y
  // decir «desde» sería sembrar una duda que no existe.
  const tieneAumento = normalizarGrupos(producto.grupos || [])
    .some((grupo) => grupo.opciones.some((opcion) => opcion.precioDelta > 0));

  const insignias = [];
  if (producto.insignia) {
    insignias.push({ tipo: tipoDeInsignia(producto.insignia), texto: producto.insignia });
  }
  // «Quedan pocas» es un dato real del stock, no una urgencia inventada: sale
  // de que el comercio cuente ese producto y le queden menos de seis.
  if (!agotado && producto.controlaStock && Number(producto.stock) > 0 && Number(producto.stock) <= 5) {
    insignias.push({ tipo: 'neutra', texto: `Quedan ${producto.stock}` });
  }

  return `
    <button class="producto" data-producto="${escapar(producto.id)}" ${pedible ? '' : 'disabled'}
            aria-label="${escapar(producto.nombre)}${pedible ? '' : agotado ? ', agotado' : ', no disponible'}">
      ${bloqueDeFoto(producto, { clase: 'producto__foto', perezosa: true, insignias, agotado })}
      <div class="producto__cuerpo">
        <h3 class="producto__nombre">${escapar(producto.nombre)}</h3>
        ${producto.descripcion ? `<p class="producto__descripcion">${escapar(producto.descripcion)}</p>` : ''}
        <div class="producto__pie">
          ${sinPrecio
            ? '<span class="precio" data-pendiente="true">Precio a confirmar</span>'
            : `<span class="precio${tieneAumento ? ' precio--desde' : ''}">${dinero(producto.precio)}</span>`}
          ${pedible ? '<span class="producto__agregar" aria-hidden="true">+</span>' : ''}
        </div>
      </div>
    </button>`;
}

/**
 * La foto de un producto, con su `srcset` y su respaldo.
 *
 * Está en un solo lugar porque la dibujan la tarjeta, la hoja y el carrito, y
 * tres copias de la misma plantilla es cómo una de las tres se queda sin
 * `loading="lazy"` y la carta baja diecinueve fotos de golpe.
 *
 * El `alt` va VACÍO a propósito: el nombre del producto está en el `<h3>` de al
 * lado, y repetirlo hace que un lector de pantalla lo diga dos veces.
 */
function bloqueDeFoto(producto, { clase, perezosa = false, insignias = [], agotado = false } = {}) {
  const juego = juegoDeFoto(producto.imagen);
  const cuerpo = juego
    ? `<img src="${escapar(juego.src)}" srcset="${escapar(juego.srcset)}"
            sizes="(max-width: 620px) 100vw, 320px" alt=""
            ${perezosa ? 'loading="lazy" decoding="async"' : ''} />`
    : producto.imagen
      ? `<img src="${escapar(rutaDeApp(producto.imagen))}" alt=""
              ${perezosa ? 'loading="lazy" decoding="async"' : ''} />`
      : `<span class="producto__inicial" aria-hidden="true">${escapar(producto.nombre[0])}</span>`;

  return `
    <div class="${clase}" ${producto.imagen ? '' : 'data-sin-foto="true"'}>
      ${insignias.length ? `<div class="insignias">${insignias.map((insignia) => `
        <span class="insignia" data-tipo="${escapar(insignia.tipo || 'neutra')}">${escapar(insignia.texto)}</span>`).join('')}</div>` : ''}
      ${cuerpo}
      ${agotado ? '<div class="velo-agotado"><span>Se agotó</span></div>' : ''}
    </div>`;
}

// ── Hoja del producto ────────────────────────────────────────────────────────

/*
 * `origen` es la TARJETA que abrió la hoja, no su identificador.
 *
 * Desde que existen los destacados, el mismo producto se dibuja dos veces: una
 * en el carrusel de arriba y otra en su categoría. Buscar la tarjeta por
 * `[data-producto="..."]` al cerrar devuelve la PRIMERA, así que cerrar la ficha
 * abierta desde la carta mandaba el foco al carrusel del principio de la
 * página. Con teclado eso es perder el lugar en una carta de diecinueve
 * productos; con lector de pantalla, no saber dónde quedó uno.
 */
function abrirHoja(productoId, origen = null) {
  const producto = estado.carta.productos.find((candidato) => candidato.id === productoId);
  if (!producto || !sePuedeComprar(producto)) return;
  estado.hoja = {
    producto,
    origen,
    seleccion: seleccionPorDefecto(producto.grupos || []),
    cantidad: 1,
    notas: '',
  };
  renderHoja();
  const hoja = $('[data-hoja-producto]');
  hoja.hidden = false;
  $('[data-hoja-barra-titulo]').textContent = producto.nombre;
  // Cada apertura arranca arriba: si no, la hoja hereda el desplazamiento de la
  // anterior y el producto nuevo aparece por la mitad de sus opciones.
  const scroll = $('[data-hoja-scroll]');
  scroll.scrollTop = 0;
  $('[data-hoja-barra]').dataset.compacta = 'false';
  scroll.addEventListener('scroll', alDesplazarLaHoja, { passive: true });
  document.body.style.overflow = 'hidden';
  // El foco entra a la hoja: si se queda atrás, el teclado sigue navegando la
  // carta que está tapada.
  $('[data-cerrar-hoja]').focus();
}

function alDesplazarLaHoja(evento) {
  // 52 px es el alto de la barra: el título aparece justo cuando la cabecera
  // grande —donde ya estaba el nombre— termina de irse.
  $('[data-hoja-barra]').dataset.compacta = String(evento.currentTarget.scrollTop > 52);
}

function cerrarHoja() {
  $('[data-hoja-scroll]')?.removeEventListener('scroll', alDesplazarLaHoja);
  $('[data-hoja-producto]').hidden = true;
  document.body.style.overflow = '';
  const origen = estado.hoja?.origen;
  const productoId = estado.hoja?.producto?.id;
  estado.hoja = null;
  // Devolver el foco a la tarjeta EXACTA de donde se abrió, no al principio del
  // documento: perder el lugar en una carta larga es perder la venta.
  // `isConnected` porque entre abrir y cerrar la carta pudo repintarse.
  if (origen?.isConnected) origen.focus();
  else if (productoId) $(`[data-producto="${CSS.escape(productoId)}"]`)?.focus();
}

function renderHoja() {
  const { producto, seleccion, cantidad, notas } = estado.hoja;
  const grupos = normalizarGrupos(producto.grupos || []);
  const resuelta = resolverSeleccion(grupos, seleccion);
  const unitario = precioUnitarioConfigurado(producto.precio, resuelta.deltaTotal);

  $('[data-hoja-cuerpo]').innerHTML = `
    ${bloqueDeFoto(producto, {
      clase: 'hoja__foto producto__foto',
      insignias: producto.insignia
        ? [{ tipo: tipoDeInsignia(producto.insignia), texto: producto.insignia }]
        : [],
    })}
    <div class="hoja__cabecera">
      <h2 class="hoja__titulo display">${escapar(producto.nombre)}</h2>
      ${producto.descripcion ? `<p class="hoja__descripcion">${escapar(producto.descripcion)}</p>` : ''}
      <p class="precio" style="margin-top:var(--e3)">${dinero(producto.precio)}</p>
    </div>
    ${grupos.map((grupo) => bloqueDeGrupo(grupo, seleccion)).join('')}
    <div class="grupo">
      <div class="grupo__cabecera"><span class="grupo__nombre">Aclaraciones</span></div>
      <textarea class="notas-linea" data-notas-linea rows="2"
        placeholder="Ej: cortala al medio">${escapar(notas)}</textarea>
    </div>
    ${resuelta.problemas.length ? `
      <div class="grupo">
        <div class="aviso" data-tono="alerta" style="margin:0">
          <ul>${resuelta.problemas.map((p) => `<li>${escapar(p)}</li>`).join('')}</ul>
        </div>
      </div>` : ''}`;

  $('[data-cantidad]').textContent = String(cantidad);
  $('[data-precio-configurado]').textContent = dinero(unitario * cantidad);
  $('[data-agregar-al-carrito]').disabled = !resuelta.valida;
  $('[data-cantidad-menos]').disabled = cantidad <= 1;
}

function bloqueDeGrupo(grupo, seleccion) {
  const elegidas = new Set(seleccion[grupo.id] || []);
  const unico = grupo.maximo === 1;
  const alTope = !unico && elegidas.size >= grupo.maximo;

  return `
    <div class="grupo">
      <div class="grupo__cabecera">
        <div>
          <div class="grupo__nombre">${escapar(grupo.nombre)}</div>
          ${grupo.ayuda ? `<div class="grupo__ayuda">${escapar(grupo.ayuda)}</div>` : ''}
        </div>
        <span class="grupo__marca" data-obligatorio="${grupo.obligatorio}">
          ${grupo.obligatorio ? 'Obligatorio' : 'Opcional'}
        </span>
      </div>
      <div class="opciones" role="${unico ? 'radiogroup' : 'group'}" aria-label="${escapar(grupo.nombre)}">
        ${grupo.opciones.map((opcion) => {
          const marcada = elegidas.has(opcion.id);
          // Una opción sin precio confirmado se ve, pero no se puede elegir: el
          // servidor la va a rechazar y es mejor decirlo acá que en el checkout.
          const bloqueada = !opcion.disponible || opcion.precioPendiente || (alTope && !marcada);
          return `
            <label class="opcion">
              <input type="${unico ? 'radio' : 'checkbox'}" name="grupo-${escapar(grupo.id)}"
                     value="${escapar(opcion.id)}" data-grupo="${escapar(grupo.id)}"
                     ${marcada ? 'checked' : ''} ${bloqueada ? 'disabled' : ''} />
              <span class="opcion__nombre">${escapar(opcion.nombre)}</span>
              ${etiquetaDeDelta(opcion)}
            </label>`;
        }).join('')}
      </div>
    </div>`;
}

function etiquetaDeDelta(opcion) {
  if (opcion.precioPendiente) {
    return '<span class="opcion__delta" data-pendiente="true">a confirmar</span>';
  }
  if (!opcion.disponible) return '<span class="opcion__delta" data-pendiente="true">sin stock</span>';
  if (opcion.precioDelta === 0) return '';
  const signo = opcion.precioDelta < 0 ? 'menos' : 'mas';
  const prefijo = opcion.precioDelta < 0 ? '−' : '+';
  return `<span class="opcion__delta" data-signo="${signo}">${prefijo} ${dinero(Math.abs(opcion.precioDelta))}</span>`;
}

// ── Carrito ──────────────────────────────────────────────────────────────────

function renderBarraDelCarrito() {
  const items = cantidadDeItems(estado.carrito);
  const barra = $('[data-barra-carrito]');
  // La barra se esconde en las vistas donde estorbaría: el carrito ya ES el
  // carrito, y el checkout tiene su propio botón de confirmar.
  const visible = items > 0 && ['carta'].includes(estado.vista);
  barra.dataset.visible = String(visible);

  // El carrito del encabezado (sólo escritorio) se muestra con el mismo dato
  // pero en TODAS las vistas de compra: en un monitor la barra de abajo queda
  // lejos del ojo y el contador de arriba es lo que confirma que algo entró.
  const enCabecera = $('[data-ir-al-carrito].encabezado__carrito');
  if (enCabecera) {
    enCabecera.hidden = items === 0 || estado.vista === 'carrito';
    $('[data-encabezado-cantidad]').textContent = String(items);
  }

  if (!visible) return;
  const resumen = resumenDelCarrito(estado.carrito, { modoEntrega: 'pickup' });
  $('[data-carrito-cantidad]').textContent = String(items);
  $('[data-carrito-total]').textContent = dinero(resumen.subtotal);
}

function renderCarrito() {
  const contenedor = $('[data-carrito-cuerpo]');
  const { lineas } = estado.carrito;

  if (!lineas.length) {
    contenedor.innerHTML = `
      <div class="vacio">
        <div class="vacio__icono" aria-hidden="true">🍔</div>
        <h2>Todavía no elegiste nada</h2>
        <p>Volvé a la carta y armá tu pedido.</p>
        <button class="boton boton--principal boton--alto" data-volver-a-carta
                style="margin-top:var(--e5)">Ver la carta</button>
      </div>`;
    return;
  }

  const resumen = resumenDelCarrito(estado.carrito, { modoEntrega: 'pickup' });
  contenedor.innerHTML = `
    ${(estado.avisosDelCarrito || []).length ? `
      <div class="aviso" data-tono="alerta">
        <strong>Algo cambió desde la última vez:</strong>
        <ul>${estado.avisosDelCarrito.map((texto) => `<li>${escapar(texto)}</li>`).join('')}</ul>
      </div>` : ''}
    <div>${lineas.map(filaDeCarrito).join('')}</div>
    <div class="totales">
      <div class="totales__fila"><span>Subtotal</span><span>${dinero(resumen.subtotal)}</span></div>
      <div class="totales__fila"><span>Envío</span><span>se calcula con tu dirección</span></div>
    </div>
    <button class="boton boton--principal boton--ancho boton--alto boton--cta" data-ir-al-checkout
            style="margin-top:var(--e5)">
      <span>Continuar</span><span class="boton__precio">${dinero(resumen.subtotal)}</span>
    </button>
    <button class="boton boton--fantasma boton--ancho" data-volver-a-carta
            style="margin-top:var(--e2)">Seguir agregando</button>`;
}

function filaDeCarrito(linea) {
  const opciones = (linea.opciones || []).filter((opcion) => opcion.grupoTipo !== 'variante');
  // La variante SÍ se muestra, pero pegada al nombre: «Doble Bacon Cheese» se
  // lee de un vistazo y «+ Doble» como un extra más, no.
  const variante = (linea.opciones || []).find((opcion) => opcion.grupoTipo === 'variante');
  const producto = estado.carta.productos.find((candidato) => candidato.id === linea.productoId);
  const juego = producto ? juegoDeFoto(producto.imagen) : null;

  return `
    <div class="linea-carrito">
      <div class="linea-carrito__foto" aria-hidden="true">
        ${juego ? `<img src="${escapar(juego.src)}" alt="" loading="lazy" decoding="async" />` : ''}
      </div>
      <div class="linea-carrito__cuerpo">
        <div class="linea-carrito__nombre">
          ${escapar(linea.nombre)}${variante ? ` · ${escapar(variante.opcionNombre)}` : ''}
        </div>
        ${opciones.length ? `
          <div class="linea-carrito__opciones">
            ${opciones.map((opcion) => `
              <span class="linea-carrito__opcion" data-quitado="${opcion.grupoTipo === 'quitar'}">
                ${opcion.grupoTipo === 'quitar' ? '−' : '+'} ${escapar(opcion.opcionNombre)}
              </span>`).join('')}
          </div>` : ''}
        ${linea.notas ? `<div class="linea-carrito__notas">“${escapar(linea.notas)}”</div>` : ''}
        <div class="linea-carrito__acciones">
          <div class="contador contador--chico">
            <button type="button" data-linea-menos="${escapar(linea.clave)}" aria-label="Quitar uno">−</button>
            <output>${linea.cantidad}</output>
            <button type="button" data-linea-mas="${escapar(linea.clave)}" aria-label="Agregar uno">+</button>
          </div>
          <button class="boton boton--fantasma" style="min-height:34px;padding:0;font-size:var(--texto-sm)"
                  data-linea-quitar="${escapar(linea.clave)}">Quitar</button>
        </div>
      </div>
      <div class="linea-carrito__precio">${dinero(linea.subtotal)}</div>
    </div>`;
}

// ── Checkout ─────────────────────────────────────────────────────────────────

function renderCheckout() {
  const select = $('[data-barrios]');
  if (!select.options.length) {
    select.innerHTML = ['<option value="">Elegí tu barrio</option>',
      ...BARRIOS_NEUQUEN.map((barrio) => `<option value="${escapar(barrio)}">${escapar(barrio)}</option>`)].join('');
  }
  /*
   * Los medios de pago son TARJETAS, no un desplegable.
   *
   * Un `<select>` esconde las opciones detrás de un toque, y el medio de pago
   * es de las primeras cosas que alguien quiere confirmar antes de cargar sus
   * datos. Además una tarjeta tiene lugar para el detalle («Pagás al recibir»),
   * que es lo que responde la duda sin tener que preguntar por WhatsApp.
   */
  const pagos = $('[data-medios-de-pago]');
  const habilitados = MEDIOS_DE_PAGO.filter((medio) => medio.habilitado);
  if (!pagos.children.length) {
    pagos.innerHTML = habilitados.map((medio, indice) => `
      <label class="medio">
        <input type="radio" name="medioDePago" value="${escapar(medio.id)}" ${indice === 0 ? 'checked' : ''} />
        <span class="medio__icono" aria-hidden="true">${iconoDePago(medio.id)}</span>
        <span class="medio__cuerpo">
          <span class="medio__titulo">${escapar(medio.etiqueta)}</span>
          <span class="medio__detalle">${escapar(medio.detalle)}</span>
        </span>
      </label>`).join('');
  }

  const modo = modoDeEntregaElegido();
  $('[data-bloque-direccion]').hidden = modo === 'pickup';
  const retiro = $('input[name="modoEntrega"][value="pickup"]');
  retiro.disabled = !estado.disponibilidad?.abiertoRetiro;

  actualizarPasos();
  renderTotalesDelCheckout();
}

/**
 * Marca los pasos del checkout que ya están completos.
 *
 * No hace de validador —eso lo hace `validarCheckout` al confirmar— sino de
 * respuesta a «¿cuánto falta?». Un paso se da por hecho cuando tiene lo mínimo
 * para seguir, no cuando está perfecto: marcarlo recién cuando el teléfono pasa
 * la validación completa hace que la barra parezca rota mientras se escribe.
 */
function actualizarPasos() {
  const modo = modoDeEntregaElegido();
  const hechos = [
    modo === 'pickup' || Boolean($('#calle')?.value.trim() && $('#numero')?.value.trim() && $('#barrio')?.value),
    Boolean($('#nombre')?.value.trim() && $('#telefono')?.value.trim()),
    Boolean($('input[name="medioDePago"]:checked')),
  ];
  // El paso actual es el primero que falta; si no falta ninguno, el último.
  const actual = hechos.findIndex((hecho) => !hecho);
  for (const [indice, nodo] of $$('[data-pasos-checkout] li').entries()) {
    nodo.dataset.hecho = String(hechos[indice]);
    const esActual = indice === (actual === -1 ? hechos.length - 1 : actual);
    if (esActual) nodo.setAttribute('aria-current', 'step');
    else nodo.removeAttribute('aria-current');
  }
}

function renderTotalesDelCheckout() {
  const modo = modoDeEntregaElegido();
  const barrio = $('#barrio')?.value || '';
  const entrega = modo === 'delivery' ? estado.entrega : null;
  const cubierta = modo === 'pickup' || entrega?.cubierta === true;
  const costoEnvio = modo === 'delivery'
    ? (cubierta ? Number(entrega?.costoEnvio ?? 0) : null)
    : 0;
  const resumen = resumenDelCarrito(estado.carrito, { modoEntrega: modo, costoEnvio: costoEnvio ?? 0 });

  const filas = [{ etiqueta: 'Subtotal', valor: dinero(resumen.subtotal) }];
  if (modo === 'delivery') {
    filas.push({
      etiqueta: 'Envío',
      // Sin barrio elegido el envío todavía NO se sabe. Mostrar $ 0 sería
      // prometer envío gratis y después cobrarlo.
      valor: !barrio
        ? 'elegí tu barrio'
        : estado.entrega === null && barrioConsultado === String(barrio).trim().toLowerCase()
          ? 'fuera de zona'
          : costoEnvio == null ? 'consultando…' : dinero(costoEnvio),
    });
  }
  filas.push({
    etiqueta: 'Total',
    valor: modo === 'delivery' && costoEnvio == null ? '—' : dinero(resumen.total),
    destacada: true,
  });

  $('[data-checkout-totales]').innerHTML = filas.map((fila) => `
    <div class="totales__fila" ${fila.destacada ? 'data-destacada="true"' : ''}>
      <span>${escapar(fila.etiqueta)}</span><span>${escapar(fila.valor)}</span>
    </div>`).join('');

  const minimo = Number(entrega?.minimoSubtotal ?? 0);
  const bajoMinimo = modo === 'delivery' && minimo > 0 && resumen.subtotal < minimo;
  /*
   * El botón se apaga SÓLO mientras se está enviando.
   *
   * Antes se apagaba también por falta de barrio, por estar fuera de zona y por
   * no llegar al mínimo. El resultado era un botón muerto: quien no había
   * completado el nombre tocaba «Confirmar», no pasaba nada y nada explicaba por
   * qué. Un botón inerte no enseña; un botón que al tocarlo dice qué falta, sí.
   * Las tres condiciones siguen frenando el pedido, pero desde `confirmarPedido`,
   * con un mensaje al lado del campo que las causa.
   */
  $('[data-confirmar]').disabled = estado.enviando;

  // El total va DENTRO del CTA: se confirma con el número a la vista, que es lo
  // que evita la sorpresa del importe recién en la pantalla de pago.
  $('[data-confirmar-total]').textContent =
    modo === 'delivery' && costoEnvio == null ? '' : dinero(resumen.total);

  $('[data-checkout-avisos]').innerHTML = bajoMinimo
    ? `<div class="aviso" data-tono="alerta">El mínimo para envío a ${escapar(barrio)} es ${dinero(minimo)}.
       Te faltan ${dinero(minimo - resumen.subtotal)}.</div>`
    : (modo === 'delivery' && barrio && costoEnvio == null
      ? `<div class="aviso" data-tono="error">Todavía no llegamos a ${escapar(barrio)}.
         Podés retirarlo en el local.</div>` : '');
}

/*
 * LA COBERTURA LA RESUELVE EL BACKEND, NO EL NAVEGADOR.
 *
 * La versión anterior buscaba en `repositorio._estado.zonas`, que es el estado
 * interno del backend de demo. Contra Supabase ese objeto no existe y el
 * checkout se rompía con «Cannot read properties of undefined (reading
 * zonas)» — y, peor que romperse, si hubiera existido habría decidido la
 * cobertura en el cliente, que es exactamente lo que el servidor tiene que
 * decidir.
 *
 * Ahora se pregunta a `disponibilidad_comercial`, que devuelve costo y mínimo
 * de la zona de ESA dirección. El resultado se guarda en `estado.entrega` y la
 * vista sólo lo dibuja.
 */
let barrioConsultado = null;

async function consultarEntrega(barrio) {
  const clave = String(barrio || '').trim().toLowerCase();
  if (clave === barrioConsultado) return estado.entrega;
  barrioConsultado = clave;

  if (!clave) {
    estado.entrega = null;
    return null;
  }
  try {
    const disponibilidad = await repositorio.disponibilidad({ barrio });
    estado.entrega = disponibilidad?.entrega ?? null;
  } catch (_) {
    // Sin respuesta no se inventa una cobertura: se deja sin resolver y el
    // checkout lo dice.
    estado.entrega = null;
  }
  return estado.entrega;
}

async function confirmarPedido(evento) {
  evento.preventDefault();
  if (estado.enviando) return;

  const datos = Object.fromEntries(new FormData(evento.target));
  const modo = datos.modoEntrega === 'pickup' ? 'pickup' : 'delivery';
  const errores = validarCheckout(datos, modo);

  // La cobertura y el mínimo se comprueban acá y no apagando el botón, para que
  // el motivo llegue al campo que lo causa en vez de dejar un control inerte.
  if (modo === 'delivery' && datos.barrio) {
    // Se vuelve a consultar al confirmar: entre que se eligió el barrio y se
    // apretó el botón, el comercio pudo cambiar la tarifa o cerrar la zona.
    const entrega = await consultarEntrega(datos.barrio);
    if (!entrega?.cubierta) {
      errores.barrio = `Todavía no llegamos a ${datos.barrio}. Podés retirarlo en el local.`;
    } else {
      const minimo = Number(entrega.minimoSubtotal ?? 0);
      const subtotal = resumenDelCarrito(estado.carrito, { modoEntrega: 'pickup' }).subtotal;
      if (minimo > 0 && subtotal < minimo) {
        errores.barrio = `El mínimo para envío a ${datos.barrio} es ${dinero(minimo)}.`;
      }
    }
  }

  pintarErrores(errores);
  if (Object.keys(errores).length) {
    $(`[data-error="${Object.keys(errores)[0]}"]`)?.closest('.campo')?.scrollIntoView({ block: 'center' });
    return;
  }

  const validacion = validarParaCheckout(estado.carrito, estado.carta.productos, { modoEntrega: modo });
  if (!validacion.ok) {
    estado.carrito = validacion.carrito;
    estado.avisosDelCarrito = validacion.problemas;
    guardarCarrito();
    irA('carrito');
    return;
  }

  estado.enviando = true;
  $('[data-confirmar]').disabled = true;
  // Se escribe en el SPAN, no en el botón: `textContent` sobre el botón borra
  // el total que vive adentro y el CTA pierde el número justo al confirmar.
  $('[data-confirmar-texto]').textContent = 'Enviando…';

  try {
    const pedido = await repositorio.crearPedido({
      modoEntrega: modo,
      clienteNombre: datos.clienteNombre,
      clienteTelefono: datos.clienteTelefono,
      medioDePago: datos.medioDePago,
      notas: datos.notas,
      direccion: modo === 'pickup' ? null : {
        calle: datos.calle, numero: datos.numero, barrio: datos.barrio,
        piso: datos.piso, referencia: datos.referencia,
      },
      lineas: lineasParaElServidor(estado.carrito),
    });

    estado.pedido = pedido;
    tokenDelPedido = pedido.tokenDeSeguimiento || '';
    estado.carrito = carritoVacio();
    estado.avisosDelCarrito = [];
    guardarCarrito();
    // Se guarda el TOKEN además del id: es la única llave con la que un cliente
    // sin cuenta puede volver a leer su pedido.
    safeStorageSet(localStorage, CLAVE_PEDIDO,
      JSON.stringify({ id: pedido.id, token: pedido.tokenDeSeguimiento || '' }));
    estado.carta = await repositorio.obtenerCarta();
    irA('seguimiento');
    escucharElPedido();
  } catch (error) {
    const mensaje = error instanceof ErrorDePedido
      ? error.message
      : 'No pudimos tomar el pedido. Probá de nuevo en un momento.';
    $('[data-checkout-avisos]').innerHTML = `<div class="aviso" data-tono="error">${escapar(mensaje)}</div>`;
    $('[data-checkout-avisos]').scrollIntoView({ block: 'center' });
  } finally {
    estado.enviando = false;
    $('[data-confirmar-texto]').textContent = 'Confirmar pedido';
    $('[data-confirmar]').disabled = false;
    /*
     * Acá NO se vuelve a pintar el checkout.
     *
     * `renderTotalesDelCheckout()` reescribe `[data-checkout-avisos]`, así que
     * llamarlo desde el `finally` borraba el mensaje que el `catch` acababa de
     * escribir: el pedido fallaba y la pantalla no decía nada. El diagnóstico
     * quedaba invisible justo cuando más falta hacía.
     */
  }
}

function validarCheckout(datos, modo) {
  const errores = {};
  const nombre = validateCustomerName(datos.clienteNombre);
  if (!nombre.ok) errores.clienteNombre = nombre.message;
  if (!isValidArgentinePhone(datos.clienteTelefono)) {
    errores.clienteTelefono = 'Ingresá un teléfono válido con característica.';
  }
  if (modo === 'delivery') {
    if (!String(datos.calle || '').trim()) errores.calle = 'Ingresá la calle.';
    if (!String(datos.numero || '').trim()) errores.numero = 'Ingresá el número.';
    if (!String(datos.barrio || '').trim()) errores.barrio = 'Elegí tu barrio.';
  }
  return errores;
}

function pintarErrores(errores) {
  for (const nodo of $$('[data-error]')) {
    const campo = nodo.dataset.error;
    nodo.textContent = errores[campo] || '';
    nodo.closest('.campo')?.setAttribute('data-invalido', String(Boolean(errores[campo])));
  }
}

// ── Seguimiento ──────────────────────────────────────────────────────────────

const PASOS_VISIBLES = ['submitted', 'preparing', 'ready', 'on_the_way', 'delivered'];

function renderSeguimiento() {
  const pedido = estado.pedido;
  const contenedor = $('[data-seguimiento]');
  if (!pedido) {
    contenedor.innerHTML = '<div class="vacio"><p>No hay ningún pedido en curso.</p></div>';
    return;
  }

  const vista = seguimientoDelCliente(pedido);
  const flujo = pedido.modoEntrega === 'pickup'
    ? PASOS_VISIBLES.filter((paso) => paso !== 'on_the_way')
    : PASOS_VISIBLES;
  const indiceActual = flujo.indexOf(pedido.estado);
  const cumplidos = new Map((pedido.historial || []).map((entrada) => [entrada.estado, entrada.en]));

  /*
   * LO PRIMERO GRANDE ES QUÉ ESTÁ PASANDO, NO EL CÓDIGO.
   *
   * Antes el título era `HB-0042`, que a quien compró no le dice nada: es un
   * identificador nuestro. Lo que quiere leer es «Estamos cocinando tu pedido».
   * El código sigue estando —hace falta para reclamar en el local— pero como
   * dato de apoyo y no como encabezado.
   */
  contenedor.innerHTML = `
    <div class="seguimiento__tapa">
      <p style="color:var(--tinta-suave);font-size:var(--texto-sm)">Tu pedido</p>
      <h1 class="seguimiento__estado display">${escapar(vista.titulo)}</h1>
      ${vista.cancelado
        ? `<p class="seguimiento__detalle">
             Cancelado${pedido.motivoCancelacion ? `: ${escapar(pedido.motivoCancelacion)}` : ''}.</p>`
        : `<p class="seguimiento__detalle">
             ${pedido.modoEntrega === 'pickup'
               ? `Lo retirás en el local. Listo en ~${pedido.minutosPreparacion} minutos.`
               : `Te lo llevamos a ${escapar(pedido.direccion?.calle || '')} ${escapar(pedido.direccion?.numero || '')}.`}
           </p>`}
      <p class="seguimiento__codigo">
        <small>Código</small>
        <!-- El código en su propio elemento: quien lo lea —una prueba, un
             copiar-pegar del cliente— no se lleva la etiqueta pegada adelante. -->
        <span data-codigo-pedido>${escapar(pedido.codigo)}</span>
      </p>
    </div>

    ${vista.cancelado ? '' : `
      <div class="pasos">
        ${flujo.map((paso, indice) => `
          <div class="paso" data-estado="${indice < indiceActual ? 'hecho' : indice === indiceActual ? 'actual' : 'pendiente'}">
            <span class="paso__marca" aria-hidden="true">${indice < indiceActual ? '✓' : indice + 1}</span>
            <div>
              <div class="paso__titulo">${escapar(ETIQUETAS_PARA_EL_CLIENTE[paso])}</div>
              ${cumplidos.has(paso) ? `<div class="paso__momento">${hora(cumplidos.get(paso))}</div>` : ''}
            </div>
          </div>`).join('')}
      </div>`}

    <div class="totales">
      <div class="totales__fila" style="color:var(--tinta);font-weight:var(--peso-fuerte)">
        <span>Qué pediste</span><span></span>
      </div>
      ${pedido.lineas.map((linea) => `
        <div class="totales__fila">
          <span>${linea.cantidad}× ${escapar(linea.nombre)}</span>
          <span>${dinero(linea.subtotal)}</span>
        </div>`).join('')}
      <div class="totales__fila"><span>Subtotal</span><span>${dinero(pedido.totales.subtotal)}</span></div>
      ${pedido.modoEntrega === 'delivery'
        ? `<div class="totales__fila"><span>Envío</span><span>${dinero(pedido.totales.costoEnvio)}</span></div>` : ''}
      <div class="totales__fila" data-destacada="true">
        <span>Total</span><span>${dinero(pedido.totales.total)}</span>
      </div>
    </div>

    ${LOCAL.whatsappVerificado && LOCAL.whatsapp ? `
      <a class="boton boton--secundario boton--ancho" style="margin-top:var(--e4)"
         href="https://wa.me/${escapar(LOCAL.whatsapp.replace(/\D/g, ''))}?text=${encodeURIComponent(`Hola! Consulto por el pedido ${pedido.codigo}`)}">
        💬 Escribir al local
      </a>` : ''}

    <button class="boton boton--fantasma boton--ancho" data-volver-a-carta
            style="margin-top:var(--e3)">Volver a la carta</button>`;
}

let dejarDeEscuchar = null;
let latidoDelSeguimiento = null;

/*
 * Cada 20 s, igual que la página de seguimiento con token. No es polling
 * agresivo: es UNA función que devuelve un pedido, y sólo mientras hay un
 * pedido en curso.
 */
const LATIDO_MS = 20_000;

function escucharElPedido() {
  // El sandbox avisa por suscripción; contra Supabase el mismo enganche lo hace
  // Realtime. La vista no sabe cuál de los dos la despertó.
  //
  // Se cancela la anterior antes de abrir otra: sin esto, cada pedido nuevo
  // dejaba viva la suscripción del anterior y la pantalla se repintaba una vez
  // por cada pedido que hubo en la sesión.
  dejarDeEscuchar?.();
  // `recargar: false`: al cliente le alcanza con que le avisen. Leer la bandeja
  // del comercio no puede —`orders` le está denegado— y no la necesita: acto
  // seguido relee SU pedido, que sí tiene permitido por su token.
  dejarDeEscuchar = repositorio.suscribir(async () => {
    if (!estado.pedido) return;
    const actualizado = await releerElPedido(estado.pedido.id).catch(() => null);
    if (!actualizado) return;
    estado.pedido = actualizado;
    if (estado.vista === 'seguimiento') renderSeguimiento();
  }, { recargar: false });

  /*
   * REALTIME NO LE LLEGA A QUIEN COMPRÓ SIN CUENTA, Y ESO ESTÁ BIEN.
   *
   * `postgres_changes` respeta la RLS: para recibir un evento de `orders` hay
   * que poder leer `orders`, y `anon` no puede —a propósito—. El canal se
   * suscribe, informa `SUBSCRIBED`, y no llega nada. Es el modo de fallo más
   * engañoso que hay, porque todo parece funcionar.
   *
   * Con token no hace falta el socket: se vuelve a preguntar cada tanto por la
   * puerta pública, que es exactamente lo que hace la página de seguimiento. Un
   * pedido tarda media hora y un latido de 20 segundos lo cubre de sobra.
   *
   * Sólo para el caso con token: con sesión, Realtime sí entrega y un latido
   * encima sería una consulta al pedo.
   */
  clearInterval(latidoDelSeguimiento);
  if (tokenDelPedido) {
    const latir = async () => {
      if (!estado.pedido || document.visibilityState === 'hidden') return;
      const actualizado = await releerElPedido(estado.pedido.id).catch(() => null);
      if (!actualizado) return;
      // Se repinta sólo si algo cambió: reescribir la vista cada 20 segundos
      // pierde el foco de quien esté leyendo el detalle.
      if (actualizado.estado === estado.pedido.estado
        && actualizado.estadoDePago === estado.pedido.estadoDePago) return;
      estado.pedido = actualizado;
      if (estado.vista === 'seguimiento') renderSeguimiento();
    };
    latidoDelSeguimiento = setInterval(latir, LATIDO_MS);
    // Volver a la pestaña es cuando alguien mira: se consulta ya.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') latir();
    });
  }
}

// ── Eventos ──────────────────────────────────────────────────────────────────

function cablearEventos() {
  document.addEventListener('click', async (evento) => {
    const objetivo = evento.target;

    const tarjeta = objetivo.closest?.('[data-producto]');
    if (tarjeta) return abrirHoja(tarjeta.dataset.producto, tarjeta);

    const categoria = objetivo.closest?.('[data-categoria]');
    if (categoria) {
      estado.categoriaActiva = categoria.dataset.categoria;
      renderCategorias();
      renderCarta();
      return;
    }

    if (objetivo.closest?.('[data-cerrar-hoja]')) return cerrarHoja();
    if (objetivo.closest?.('[data-ir-al-carrito]')) return irA('carrito');
    if (objetivo.closest?.('[data-volver-a-carta]')) return irA('carta');
    if (objetivo.closest?.('[data-ir-al-checkout]')) return irA('checkout');

    if (objetivo.closest?.('[data-cantidad-mas]')) {
      estado.hoja.cantidad = Math.min(20, estado.hoja.cantidad + 1);
      return renderHoja();
    }
    if (objetivo.closest?.('[data-cantidad-menos]')) {
      estado.hoja.cantidad = Math.max(1, estado.hoja.cantidad - 1);
      return renderHoja();
    }
    if (objetivo.closest?.('[data-agregar-al-carrito]')) return agregarDesdeLaHoja();

    const mas = objetivo.closest?.('[data-linea-mas]');
    if (mas) return mutarCarrito((carrito) => cambiarCantidad(carrito, mas.dataset.lineaMas,
      (carrito.lineas.find((l) => l.clave === mas.dataset.lineaMas)?.cantidad || 0) + 1));

    const menos = objetivo.closest?.('[data-linea-menos]');
    if (menos) return mutarCarrito((carrito) => cambiarCantidad(carrito, menos.dataset.lineaMenos,
      (carrito.lineas.find((l) => l.clave === menos.dataset.lineaMenos)?.cantidad || 0) - 1));

    const quitar = objetivo.closest?.('[data-linea-quitar]');
    if (quitar) return mutarCarrito((carrito) => quitarLinea(carrito, quitar.dataset.lineaQuitar));

    // Clic en el fondo de la hoja: cerrar. Es lo que espera cualquiera que use
    // un teléfono, y es más rápido que buscar la cruz.
    if (objetivo === $('[data-hoja-producto]')) return cerrarHoja();
  });

  document.addEventListener('change', async (evento) => {
    const entrada = evento.target;
    if (entrada.dataset?.grupo && estado.hoja) return cambiarSeleccion(entrada);
    if (entrada.id === 'barrio') {
      // Se pinta enseguida —con «consultando…»— y se repinta al volver la
      // respuesta. Esperar en silencio parece una pantalla trabada.
      renderCheckout();
      await consultarEntrega(entrada.value);
      return renderTotalesDelCheckout();
    }
    if (entrada.name === 'modoEntrega') return renderCheckout();
  });

  document.addEventListener('input', (evento) => {
    if (evento.target.matches('[data-notas-linea]') && estado.hoja) {
      estado.hoja.notas = evento.target.value;
    }
    // Los pasos del checkout se marcan mientras se escribe. Repintar sólo esa
    // barra y no el formulario entero: reescribir el formulario con `innerHTML`
    // mientras alguien tipea le saca el foco y le come la letra.
    if (estado.vista === 'checkout' && evento.target.closest('[data-formulario-checkout]')) {
      actualizarPasos();
    }
  });

  // Escape cierra la hoja. Sin esto, con el teclado no hay salida.
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && estado.hoja) cerrarHoja();
  });

  $('[data-formulario-checkout]').addEventListener('submit', confirmarPedido);
}

function cambiarSeleccion(entrada) {
  const grupoId = entrada.dataset.grupo;
  const grupo = normalizarGrupos(estado.hoja.producto.grupos || []).find((g) => g.id === grupoId);
  const actuales = new Set(estado.hoja.seleccion[grupoId] || []);

  if (grupo.maximo === 1) {
    estado.hoja.seleccion[grupoId] = [entrada.value];
  } else if (entrada.checked) {
    actuales.add(entrada.value);
    estado.hoja.seleccion[grupoId] = [...actuales];
  } else {
    actuales.delete(entrada.value);
    estado.hoja.seleccion[grupoId] = [...actuales];
  }
  renderHoja();
}

function agregarDesdeLaHoja() {
  const { producto, seleccion, cantidad, notas } = estado.hoja;
  const resultado = agregarAlCarrito(estado.carrito, producto, { seleccion, cantidad, notas });
  if (!resultado.ok) {
    // Un fallo acá es información, no un callejón: se muestra en la hoja misma.
    $('[data-hoja-cuerpo]').insertAdjacentHTML('beforeend', `
      <div class="grupo"><div class="aviso" data-tono="error" style="margin:0">
        ${resultado.problemas.map(escapar).join('<br>')}
      </div></div>`);
    return;
  }
  estado.carrito = resultado.carrito;
  guardarCarrito();
  cerrarHoja();
  render();
}

function mutarCarrito(transformar) {
  estado.carrito = transformar(estado.carrito);
  guardarCarrito();
  render();
}

function irA(vista) {
  estado.vista = vista;
  estado.avisosDelCarrito = vista === 'carta' ? [] : estado.avisosDelCarrito;
  window.scrollTo({ top: 0, behavior: 'instant' });
  render();
}

// ── Persistencia ─────────────────────────────────────────────────────────────

function guardarCarrito() {
  safeStorageSet(localStorage, CLAVE_CARRITO, JSON.stringify(estado.carrito));
}

function restaurarCarrito() {
  const guardado = safeJsonParse(safeStorageGet(localStorage, CLAVE_CARRITO), null);
  if (guardado?.lineas) estado.carrito = guardado;
}

function restaurarUltimoPedido() {
  const guardado = safeJsonParse(safeStorageGet(localStorage, CLAVE_PEDIDO), null);
  if (!guardado?.id && !guardado?.token) return;
  tokenDelPedido = guardado.token || '';
  releerElPedido(guardado.id).then((pedido) => {
    if (!pedido) return;
    estado.pedido = pedido;
    escucharElPedido();
    if (estado.vista === 'seguimiento') renderSeguimiento();
  }).catch(() => {
    // Un pedido viejo que ya no se puede leer no rompe la tienda: se olvida y
    // el cliente ve la carta, que es lo que vino a hacer.
  });
}

/*
 * POR QUÉ PUERTA SE LEE EL PEDIDO PROPIO.
 *
 * Con token, por `seguimiento_publico`: es la única otorgada a `anon`, y quien
 * compra sin registrarse es `anon`. Con sesión —o sin token, para un pedido
 * guardado antes de que esto existiera— por `obtenerPedido`.
 *
 * Antes se usaba SIEMPRE `obtenerPedido`, que está otorgada sólo a
 * `authenticated`. El permiso estaba bien puesto y respondía 401; lo que estaba
 * mal era la puerta. El efecto no era una fuga sino algo peor de ver: el
 * seguimiento del cliente quedaba clavado en «Recibimos tu pedido» mientras la
 * cocina lo preparaba, lo terminaba y salía a la calle.
 */
let tokenDelPedido = '';

async function releerElPedido(id) {
  if (tokenDelPedido && typeof repositorio.seguirPorToken === 'function') {
    const porToken = await repositorio.seguirPorToken(tokenDelPedido);
    if (porToken) return porToken;
  }
  return id ? repositorio.obtenerPedido(id) : null;
}

function modoDeEntregaElegido() {
  return $('input[name="modoEntrega"]:checked')?.value === 'pickup' ? 'pickup' : 'delivery';
}

// ── Utilidades ───────────────────────────────────────────────────────────────

/**
 * Escapa para HTML. Se aplica a TODO lo que entra a una plantilla, incluso a lo
 * que hoy sale de una constante del propio proyecto: el día que el nombre de un
 * producto venga del panel, ese dato lo escribió una persona.
 */
function escapar(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function plegar(texto) {
  return String(texto ?? '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function hora(iso) {
  try {
    return new Date(iso).toLocaleTimeString(CIUDAD.locale, { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

iniciar();
