/*
 * ─────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALEN LOS DATOS — UN SOLO LUGAR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PROCEDENCIA. Es la fábrica de repositorios de TABA
 * (`js/repositories/repository_factory.js`), reducida a lo que este proyecto
 * necesita hoy. La idea es la misma y es la que hace que el día del backend no
 * haya que tocar ni la tienda ni el panel ni el repartidor: las tres piden el
 * repositorio acá y no saben cuál les toca.
 *
 * CÓMO SE ELIGE
 * -------------
 * Igual que en TABA: por `runtime-config.js`, un archivo que el repositorio
 * versiona VACÍO y que el despliegue reemplaza. Sin configuración, modo demo.
 * Es fail-closed en la dirección correcta: nunca se apunta a un backend por
 * accidente.
 *
 * AISLAMIENTO DE TABA
 * -------------------
 * Este proyecto NUNCA apunta al Supabase de TABA. `scripts/check-aislamiento-taba.mjs`
 * lo comprueba en cada `npm run check`.
 */

import { crearRepositorioCompartido } from './repositories/repositorio-compartido.js';
import { crearRepositorioSupabase } from './repositories/repositorio-supabase.js';
/*
 * El cliente va VENDORIZADO, no desde un CDN.
 *
 * Un CDN en el camino crítico de una tienda es un tercero que puede caerse, ir
 * lento desde Neuquén o servir otra cosa. 216 KB desde el mismo origen se
 * cachean una vez y no dependen de nadie. Se regenera con `npm run vendor`.
 */
import { createClient } from './vendor/supabase.js';
import { cartaSemilla } from './config/carta-semilla.js';
import { SERVICIO } from './config/negocio.js';

/**
 * Zonas de arranque para el modo demo.
 *
 * Son barrios reales de Neuquén Capital con costos de EJEMPLO. Las de verdad
 * las carga el comercio; éstas existen para que la demo pueda cobrar un envío
 * en vez de mostrar $ 0, que es la mentira que este proyecto evita en todos
 * lados.
 */
export const ZONAS_DEMO = Object.freeze([
  { id: 'z-centro', nombre: 'Centro', costoEnvio: 1500, prioridad: 10, etaMinutos: 30 },
  { id: 'z-area-centro-este', nombre: 'Área Centro Este', costoEnvio: 1500, prioridad: 10, etaMinutos: 30 },
  { id: 'z-area-centro-sur', nombre: 'Área Centro Sur', costoEnvio: 1500, prioridad: 10, etaMinutos: 30 },
  { id: 'z-santa-genoveva', nombre: 'Santa Genoveva', costoEnvio: 1800, prioridad: 20, etaMinutos: 35 },
  { id: 'z-villa-farrel', nombre: 'Villa Farrel', costoEnvio: 1800, prioridad: 20, etaMinutos: 35 },
  { id: 'z-bouquet-roldan', nombre: 'Bouquet Roldán', costoEnvio: 1800, prioridad: 20, etaMinutos: 35 },
  { id: 'z-confluencia', nombre: 'Confluencia', costoEnvio: 2200, prioridad: 30, etaMinutos: 45 },
  { id: 'z-melipal', nombre: 'Melipal', costoEnvio: 2200, prioridad: 30, etaMinutos: 45 },
  { id: 'z-belgrano', nombre: 'Belgrano', costoEnvio: 2200, prioridad: 30, etaMinutos: 45 },
  { id: 'z-huiliches', nombre: 'Huiliches', costoEnvio: 2200, prioridad: 30, etaMinutos: 45 },
  { id: 'z-gran-neuquen-norte', nombre: 'Gran Neuquén Norte', costoEnvio: 2600, minimoSubtotal: 12000, prioridad: 40, etaMinutos: 55 },
  { id: 'z-gran-neuquen-sur', nombre: 'Gran Neuquén Sur', costoEnvio: 2600, minimoSubtotal: 12000, prioridad: 40, etaMinutos: 55 },
  { id: 'z-valentina-norte', nombre: 'Valentina Norte Urbana', costoEnvio: 2600, minimoSubtotal: 12000, prioridad: 40, etaMinutos: 55 },
  { id: 'z-valentina-sur', nombre: 'Valentina Sur Urbana', costoEnvio: 2600, minimoSubtotal: 12000, prioridad: 40, etaMinutos: 55 },
]);

let instancia = null;

export function obtenerRepositorio() {
  if (instancia) return instancia;

  const config = globalThis.__HAMBURGUESERIA_RUNTIME_CONFIG__;

  if (config?.repositorio === 'supabase') {
    /*
     * FALLAR RUIDOSO, NUNCA CAER A LA DEMO EN SILENCIO.
     *
     * Si la configuración pide Supabase y falta algo, lo peor que puede pasar
     * es seguir andando contra el sandbox: la tienda funciona, se toman
     * pedidos, y nadie los ve nunca porque viven en el localStorage de un
     * navegador. Por eso acá se levanta una excepción con el nombre exacto de
     * lo que falta.
     */
    const faltantes = ['supabaseUrl', 'clavePublicable', 'businessId']
      .filter((campo) => !config[campo]);
    if (faltantes.length) {
      throw new Error(`runtime-config.js incompleto para Supabase: falta ${faltantes.join(', ')}`);
    }
    // La compuerta de aislamiento también vive en tiempo de ejecución: un
    // `runtime-config.js` copiado de otro proyecto no se detecta con un chequeo
    // estático porque ese archivo no está versionado.
    const url = String(config.supabaseUrl).toLowerCase();
    for (const ajeno of ['la-taba', 'lataba', 'taba-pages', 'bitflow']) {
      if (url.includes(ajeno)) {
        throw new Error(`runtime-config.js apunta a un proyecto ajeno («${ajeno}»). Prohibido.`);
      }
    }

    instancia = crearRepositorioSupabase({
      cliente: createClient(config.supabaseUrl, config.clavePublicable, {
        auth: { persistSession: true, autoRefreshToken: true },
        realtime: { params: { eventsPerSecond: 5 } },
      }),
      businessId: config.businessId,
    });
    return instancia;
  }

  instancia = crearRepositorioCompartido({
    carta: cartaSemilla(),
    comercio: {
      aceptaPedidos: true,
      abiertoDelivery: true,
      abiertoRetiro: true,
      deliveryHabilitado: SERVICIO.envioHabilitado,
      retiroHabilitado: SERVICIO.retiroEnLocalHabilitado,
      costoEnvioPorDefecto: 1500,
      minimoPorDefecto: SERVICIO.montoMinimoEnvio,
      minutosPreparacionPorDefecto: SERVICIO.minutosPreparacionPorDefecto,
      prefijoPedido: SERVICIO.prefijoPedido,
    },
    zonas: ZONAS_DEMO.map((zona) => ({ ...zona })),
  });
  return instancia;
}
