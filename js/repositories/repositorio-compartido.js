/*
 * ─────────────────────────────────────────────────────────────────────────────
 * PERSISTENCIA Y SINCRONÍA ENTRE PESTAÑAS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * EL PROBLEMA. La tienda, el panel y el repartidor son tres páginas distintas.
 * Cada una crearía su propio repositorio en memoria y no vería los pedidos de
 * las otras: se podría tomar un pedido en la tienda y la cocina no se enteraría
 * nunca. Sin esto, la vertical no se puede ni demostrar.
 *
 * LA SOLUCIÓN. Un envoltorio que guarda el estado en `localStorage` y avisa por
 * `BroadcastChannel`. Las tres pantallas comparten origen, así que comparten
 * almacenamiento; y el canal les da el empujón en vivo que en producción da
 * Supabase Realtime.
 *
 * POR QUÉ ES UN ENVOLTORIO Y NO ESTÁ ADENTRO DEL SANDBOX
 * El sandbox es dominio puro: se prueba con `node --test`, sin navegador, y no
 * sabe que existe `localStorage`. Meterle persistencia lo ataría al navegador y
 * volvería las pruebas dependientes de un entorno. Acá la persistencia es una
 * capa de afuera, exactamente como en producción lo es Supabase.
 *
 * ESTO NO ES UNA BASE DE DATOS. `localStorage` no tiene transacciones y dos
 * pestañas escribiendo a la vez pueden pisarse. Para una demo de un local con
 * un operador alcanza y sobra; para producción está Supabase, que es a lo que
 * apunta el mismo código cambiando el repositorio. La diferencia está declarada
 * acá para que nadie la descubra en el peor momento.
 */

import { crearRepositorioSandbox } from './repositorio-sandbox.js';
import { safeJsonParse, safeStorageGet, safeStorageSet } from '../core/storage.js';

const CLAVE = 'hburg.backend.v1';
const CANAL = 'hburg.backend';

export function crearRepositorioCompartido(opciones = {}) {
  const base = crearRepositorioSandbox(opciones);
  const guardado = safeJsonParse(safeStorageGet(localStorage, CLAVE), null);

  // Se restauran pedidos, secuencia y stock. La carta y las zonas vienen de la
  // configuración: si mañana el comercio agrega un producto, el estado guardado
  // no puede resucitar la carta vieja.
  if (guardado) {
    base._estado.pedidos = Array.isArray(guardado.pedidos) ? guardado.pedidos : [];
    base._estado.secuencia = Number(guardado.secuencia) || 0;
    for (const [id, stock] of Object.entries(guardado.stock || {})) {
      const producto = base._estado.productos.find((candidato) => candidato.id === id);
      if (producto?.controlaStock) producto.stock = stock;
    }
    if (guardado.comercio) Object.assign(base._estado.comercio, guardado.comercio);
    for (const [id, cambios] of Object.entries(guardado.productos || {})) {
      const producto = base._estado.productos.find((candidato) => candidato.id === id);
      if (producto) Object.assign(producto, cambios);
    }
  }

  const canal = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CANAL) : null;
  const oyentes = new Set();
  let escribiendo = false;

  function persistir() {
    const stock = {};
    const productos = {};
    for (const producto of base._estado.productos) {
      if (producto.controlaStock) stock[producto.id] = producto.stock;
      // Sólo lo que el panel puede editar. Guardar el producto entero haría que
      // un cambio en la carta semilla nunca llegara a una pestaña ya usada.
      productos[producto.id] = {
        precio: producto.precio,
        disponible: producto.disponible,
        agotado: producto.agotado,
        estadoPrecio: producto.estadoPrecio,
      };
    }
    escribiendo = true;
    safeStorageSet(localStorage, CLAVE, JSON.stringify({
      pedidos: base._estado.pedidos,
      secuencia: base._estado.secuencia,
      comercio: base._estado.comercio,
      stock,
      productos,
    }));
    escribiendo = false;
    canal?.postMessage({ tipo: 'cambio' });
  }

  async function recargar() {
    const nuevo = safeJsonParse(safeStorageGet(localStorage, CLAVE), null);
    if (!nuevo) return;
    base._estado.pedidos = Array.isArray(nuevo.pedidos) ? nuevo.pedidos : [];
    base._estado.secuencia = Number(nuevo.secuencia) || 0;
    if (nuevo.comercio) Object.assign(base._estado.comercio, nuevo.comercio);
    for (const [id, stock] of Object.entries(nuevo.stock || {})) {
      const producto = base._estado.productos.find((candidato) => candidato.id === id);
      if (producto?.controlaStock) producto.stock = stock;
    }
    for (const [id, cambios] of Object.entries(nuevo.productos || {})) {
      const producto = base._estado.productos.find((candidato) => candidato.id === id);
      if (producto) Object.assign(producto, cambios);
    }
    avisar();
  }

  function avisar() {
    for (const oyente of oyentes) {
      try {
        oyente(base._estado.pedidos.map((pedido) => structuredClone(pedido)));
      } catch (_) { /* un oyente roto no tumba a los demás */ }
    }
  }

  canal?.addEventListener('message', recargar);
  // `storage` cubre a los navegadores sin BroadcastChannel y a las pestañas que
  // el canal no alcanzó. `escribiendo` evita releer lo que uno mismo escribió.
  globalThis.addEventListener?.('storage', (evento) => {
    if (evento.key === CLAVE && !escribiendo) recargar();
  });

  // Cada mutación del sandbox persiste y avisa. Se envuelve por nombre para no
  // olvidarse ninguna: agregar un método nuevo al sandbox sin envolverlo acá
  // sería un cambio que no se guarda.
  const mutaciones = ['crearPedido', 'cambiarEstado', 'asignarRepartidor'];
  const envuelto = { ...base, modo: 'compartido' };
  for (const nombre of mutaciones) {
    envuelto[nombre] = async (...args) => {
      const resultado = await base[nombre].call(base, ...args);
      persistir();
      avisar();
      return resultado;
    };
  }

  envuelto.actualizarProducto = async (productoId, cambios) => {
    const producto = base._estado.productos.find((candidato) => candidato.id === productoId);
    if (!producto) throw new Error('Producto inexistente.');
    // Sólo campos que el panel tiene derecho a tocar. Sin esta lista, un error
    // de tipeo en el panel podría reescribir el id o los grupos del producto.
    for (const campo of ['precio', 'disponible', 'agotado', 'estadoPrecio', 'stock']) {
      if (campo in cambios) producto[campo] = cambios[campo];
    }
    persistir();
    avisar();
    return structuredClone(producto);
  };

  envuelto.actualizarComercio = async (cambios) => {
    Object.assign(base._estado.comercio, cambios);
    persistir();
    avisar();
    return { ...base._estado.comercio };
  };

  envuelto.suscribir = (oyente) => {
    oyentes.add(oyente);
    return () => oyentes.delete(oyente);
  };

  envuelto.reiniciar = async () => {
    base._estado.pedidos = [];
    base._estado.secuencia = 0;
    persistir();
    avisar();
  };

  return envuelto;
}
