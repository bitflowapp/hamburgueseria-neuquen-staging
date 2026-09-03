/*
 * ─────────────────────────────────────────────────────────────────────────────
 * CONFIGURACIÓN DEL COMERCIO — ÚNICO LUGAR DONDE SE ESCRIBEN LOS DATOS DEL LOCAL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Todo lo que todavía NO está decidido comercialmente vive acá y en ningún otro
 * archivo. Nombre definitivo, dirección exacta, teléfono, horarios y logo se
 * cambian editando ESTE archivo (o, en producción, desde el panel) sin tocar una
 * sola línea de lógica.
 *
 * REGLA DE DATO NO VERIFICADO
 * ---------------------------
 * Un dato que nadie confirmó NO se inventa: se declara pendiente. Cada campo
 * sensible viene acompañado de su bandera `*Verificado`. Mientras la bandera sea
 * `false`, la superficie muestra «a confirmar» en vez de un número que parece
 * real y no lo es. Es la misma doctrina que TABA aprendió a la fuerza: un
 * `deliveryFee` sembrado por un guion se anuncia como si el comercio lo hubiera
 * fijado.
 *
 * QUIÉN MANDA EN PRODUCCIÓN
 * -------------------------
 * Esto es la SEMILLA. Con backend conectado, la autoridad es la fila de
 * `businesses` + `business_service_hours` + `delivery_zones`, editable desde el
 * panel. Estos valores sólo se usan para arrancar y para el modo demo.
 */

/** Identidad de marca. El nombre está decidido: La Reserva. */
export const MARCA = Object.freeze({
  nombre: 'La Reserva',
  nombreCorto: 'La Reserva',
  bajada: 'Hamburguesas a la parrilla · Neuquén Capital',
  claim: 'Carne, fuego y punto justo.',
  claimSecundario: 'Pedí online. Te llega caliente.',
  // Decidido. La bandera se queda porque el panel la lee para no presentar como
  // definitivo un nombre que nadie confirmó, y porque el día que el comercio se
  // renombre vuelve a ser la que avisa.
  nombreDefinitivo: true,
  // Sin logo todavía. La marca se dibuja con tipografía hasta que exista uno.
  logoUrl: '',
});

/** Datos de contacto y ubicación. Ninguno inventado. */
export const LOCAL = Object.freeze({
  // Dirección postal del local. VACÍA a propósito: todavía puede cambiar.
  direccion: '',
  direccionVerificada: false,

  // Coordenada del local. `null` y no 0,0: ver js/core/geo-point.js sobre por
  // qué la ausencia de dato nunca puede parecer una medición.
  latitud: null,
  longitud: null,
  coordenadaVerificada: false,

  telefono: '',
  whatsapp: '',
  whatsappVerificado: false,

  instagram: '',
});

/**
 * Neuquén Capital. Esto SÍ está decidido: es la ciudad de operación.
 * El encuadre del mapa cubre el ejido urbano y sirve mientras no haya
 * coordenada del local confirmada.
 */
export const CIUDAD = Object.freeze({
  nombre: 'Neuquén',
  provincia: 'Neuquén',
  pais: 'AR',
  moneda: 'ARS',
  simboloMoneda: '$',
  locale: 'es-AR',
  // IANA. Argentina no aplica horario de verano, pero la zona se declara igual:
  // el cierre de caja de TABA se firmaba con la zona del navegador hasta que
  // alguien lo miró. El huso comercial es del comercio, no del dispositivo.
  zonaHoraria: 'America/Argentina/Salta',
  // Encuadre por defecto del mapa: [[sudoeste],[noreste]] del ejido de Neuquén.
  encuadre: Object.freeze([
    Object.freeze([-38.99, -68.12]),
    Object.freeze([-38.90, -67.95]),
  ]),
});

/**
 * Servicio. Son los valores de arranque: en producción los fija el panel.
 *
 * `datosDeVentaVerificados` es la compuerta comercial. Mientras sea `false` la
 * tienda NO anuncia costo de envío ni mínimo: prefiere decir «a confirmar» antes
 * que prometer un número que el local no fijó.
 */
export const SERVICIO = Object.freeze({
  datosDeVentaVerificados: false,

  envioHabilitado: true,
  retiroEnLocalHabilitado: true,

  costoEnvioPorDefecto: 0,
  montoMinimoEnvio: 0,

  // Minutos. Es lo que la tienda promete y lo que la cocina ve como objetivo.
  minutosPreparacionPorDefecto: 25,
  minutosPreparacionOpciones: Object.freeze([15, 20, 25, 30, 40, 50, 60]),

  // Prefijo del código público de pedido. Se ve en el ticket de cocina y en el
  // seguimiento del cliente.
  prefijoPedido: 'HB',
});

/**
 * Horarios semanales de arranque, por canal.
 * 0 = domingo, igual que `extract(dow)` de PostgreSQL y que `Date#getDay()`.
 * `cierra < abre` significa que la ventana cruza la medianoche (una cocina que
 * cierra a las 00:30 es lo normal, no un error de carga).
 *
 * Vacío a propósito: los horarios reales todavía no están definidos y un horario
 * inventado hace que la tienda acepte pedidos cuando el local está cerrado.
 */
export const HORARIOS_SEMILLA = Object.freeze([]);

/**
 * Ejemplo de horario típico, para cargar de un toque desde el panel cuando el
 * comercio decida. NO se aplica solo.
 */
export const HORARIO_SUGERIDO = Object.freeze([
  ...[3, 4, 5, 6].flatMap((dia) => [
    Object.freeze({ canal: 'delivery', dia, abre: '19:30', cierra: '00:30' }),
    Object.freeze({ canal: 'pickup', dia, abre: '19:30', cierra: '00:30' }),
  ]),
  ...[0, 1, 2].flatMap((dia) => [
    Object.freeze({ canal: 'delivery', dia, abre: '20:00', cierra: '23:59' }),
    Object.freeze({ canal: 'pickup', dia, abre: '20:00', cierra: '23:59' }),
  ]),
]);

/**
 * Zonas de reparto de arranque.
 *
 * Vacío: el costo por zona es una decisión comercial sin tomar, y el backend
 * tiene el modelo completo (`delivery_zones`: barrio declarado o polígono, con
 * costo y mínimo propios y prioridad de desempate). Las zonas reales se cargan
 * desde el panel.
 */
export const ZONAS_SEMILLA = Object.freeze([]);

/**
 * Barrios de Neuquén Capital para el selector de dirección.
 * Es un vocabulario de la ciudad, no una promesa de cobertura: que un barrio
 * esté en esta lista no significa que se reparta ahí. La cobertura la resuelve
 * `delivery_zones` en el servidor.
 */
export const BARRIOS_NEUQUEN = Object.freeze([
  'Centro', 'Área Centro Este', 'Área Centro Sur', 'Alta Barda', 'Bardas Soleadas',
  'Belgrano', 'Bouquet Roldán', 'Ciudad Industrial', 'Confluencia', 'Copol',
  'Cumelén', 'Don Bosco II', 'Don Bosco III', 'El Progreso', 'Gran Neuquén Norte',
  'Gran Neuquén Sur', 'Huiliches', 'Islas Malvinas', 'La Sirena', 'Limay',
  'Mariano Moreno', 'Melipal', 'Milla Sur', 'Mudn', 'Nueva Esperanza',
  'Parque Industrial', 'Provincias Unidas', 'Rincón de Emilio', 'San Lorenzo',
  'Santa Genoveva', 'Sapere', 'Terrazas del Neuquén', 'Unión de Mayo',
  'Valentina Norte Rural', 'Valentina Norte Urbana', 'Valentina Sur Rural',
  'Valentina Sur Urbana', 'Villa Ceferino', 'Villa Farrel', 'Villa María',
]);

/** Medios de pago que el comercio acepta. */
export const MEDIOS_DE_PAGO = Object.freeze([
  Object.freeze({ id: 'cash', etiqueta: 'Efectivo', detalle: 'Pagás al recibir', habilitado: true }),
  Object.freeze({ id: 'transfer', etiqueta: 'Transferencia', detalle: 'Te pasamos el alias', habilitado: true }),
  Object.freeze({
    id: 'mercado_pago',
    etiqueta: 'Mercado Pago',
    detalle: 'Tarjeta, débito o dinero en cuenta',
    // Apagado hasta que existan credenciales productivas y el webhook esté
    // verificado. Ofrecer un botón que no puede cobrar es peor que no ofrecerlo.
    habilitado: false,
  }),
]);

/** Vista consolidada. Es lo que consume la app cuando no hay backend. */
export function configuracionSemilla() {
  return {
    marca: MARCA,
    local: LOCAL,
    ciudad: CIUDAD,
    servicio: SERVICIO,
    horarios: HORARIOS_SEMILLA,
    zonas: ZONAS_SEMILLA,
    mediosDePago: MEDIOS_DE_PAGO,
  };
}

/**
 * Qué falta decidir para poder vender de verdad.
 * El panel muestra esta lista como checklist de apertura.
 */
export function decisionesPendientes(config = configuracionSemilla()) {
  const faltantes = [];
  if (!config.marca.nombreDefinitivo) faltantes.push({ campo: 'marca.nombre', que: 'Nombre comercial definitivo' });
  if (!config.local.direccionVerificada || !config.local.direccion) faltantes.push({ campo: 'local.direccion', que: 'Dirección del local' });
  if (!config.local.coordenadaVerificada) faltantes.push({ campo: 'local.coordenada', que: 'Ubicación exacta en el mapa' });
  if (!config.local.whatsappVerificado || !config.local.whatsapp) faltantes.push({ campo: 'local.whatsapp', que: 'WhatsApp de contacto' });
  if (!config.horarios.length) faltantes.push({ campo: 'horarios', que: 'Horarios de atención' });
  if (!config.zonas.length) faltantes.push({ campo: 'zonas', que: 'Zonas de reparto y costo de envío' });
  if (!config.servicio.datosDeVentaVerificados) faltantes.push({ campo: 'servicio', que: 'Confirmar costo de envío y mínimo' });
  return faltantes;
}

/** `true` si el comercio puede aceptar pedidos reales sin prometer nada falso. */
export function puedeVender(config = configuracionSemilla()) {
  return decisionesPendientes(config).length === 0;
}
