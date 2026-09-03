/*
 * ─────────────────────────────────────────────────────────────────────────────
 * SESIÓN Y ROL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * QUÉ RESUELVE
 * El panel y el repartidor no pueden ser una URL secreta. Una URL secreta se
 * comparte por WhatsApp, queda en el historial del navegador prestado y aparece
 * en el `Referer` de cualquier recurso externo. Acá hay sesión de verdad.
 *
 * DÓNDE VIVE LA AUTORIDAD
 * NO acá. Este módulo decide qué DIBUJAR; quién puede QUÉ lo decide PostgreSQL,
 * con `business_members` y la RLS. Si alguien saltea esta pantalla —consola del
 * navegador, `fetch` a mano— se encuentra con el mismo «permission denied» que
 * si no hubiera pasado por ella.
 *
 * Eso es deliberado y es lo que hace que esta capa pueda ser simple: es una
 * comodidad, no un guardián.
 *
 * MODO DEMO
 * Sin backend configurado no hay sesión que pedir y el panel se abre igual: la
 * demo corre en el navegador de quien la mira y no hay datos de nadie. En cuanto
 * `runtime-config.js` apunta a Supabase, la sesión pasa a ser obligatoria.
 */

import { obtenerRepositorio } from './backend.js';

const ROLES = Object.freeze(['owner', 'staff', 'rider']);

/** Lo que el resto de la app necesita saber. */
let estado = {
  modo: 'demo',       // 'demo' | 'supabase'
  cargando: true,
  sesion: null,       // { userId, email }
  rol: null,          // 'owner' | 'staff' | 'rider'
  businessId: null,
  error: '',
};

const oyentes = new Set();

function avisar() {
  for (const oyente of oyentes) {
    try { oyente(estado); } catch (_) { /* un oyente roto no tumba a los demás */ }
  }
}

function actualizar(cambios) {
  estado = { ...estado, ...cambios };
  avisar();
}

export function estadoDeSesion() {
  return estado;
}

export function alCambiarSesion(oyente) {
  oyentes.add(oyente);
  oyente(estado);
  return () => oyentes.delete(oyente);
}

/**
 * Arranca la sesión y la mantiene.
 *
 * `rolesAdmitidos` es lo que ESTA pantalla necesita: el panel pide
 * owner/staff, el repartidor pide rider. Una persona con sesión pero con el rol
 * equivocado ve un mensaje claro, no una pantalla vacía.
 */
export async function iniciarSesionDeLaPantalla(rolesAdmitidos = ROLES) {
  const repositorio = obtenerRepositorio();

  if (repositorio.modo !== 'supabase') {
    actualizar({ modo: 'demo', cargando: false, rol: 'owner', businessId: repositorio.businessId ?? null });
    return estado;
  }

  const cliente = repositorio.cliente;
  actualizar({ modo: 'supabase' });

  async function resolver() {
    const { data } = await cliente.auth.getSession();
    const sesion = data?.session;
    if (!sesion) {
      actualizar({ cargando: false, sesion: null, rol: null, businessId: null, error: '' });
      return;
    }

    // El rol sale de la BASE, no del token. Un JWT lo emite Auth y no sabe nada
    // de comercios; meter el rol ahí obligaría a re-emitirlo cada vez que
    // alguien cambia de puesto.
    const { data: membresia, error } = await cliente
      .from('business_members')
      .select('business_id, role, is_active')
      .eq('user_id', sesion.user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      actualizar({ cargando: false, sesion: { userId: sesion.user.id, email: sesion.user.email },
        rol: null, businessId: null, error: 'No pudimos leer tus permisos.' });
      return;
    }

    actualizar({
      cargando: false,
      sesion: { userId: sesion.user.id, email: sesion.user.email },
      rol: membresia?.role ?? null,
      businessId: membresia?.business_id ?? null,
      error: membresia
        ? (rolesAdmitidos.includes(membresia.role) ? '' : `Tu cuenta es «${membresia.role}» y esta pantalla no es para ese rol.`)
        : 'Tu cuenta no está asociada a ningún comercio. Pedile al dueño que te dé de alta.',
    });
  }

  // Cada cambio de sesión —login, logout, renovación de token— vuelve a
  // resolver. Sin esto, cerrar sesión en otra pestaña deja ésta creyendo que
  // sigue autorizada hasta que alguien recarga.
  cliente.auth.onAuthStateChange(() => { resolver(); });
  await resolver();
  return estado;
}

export function puedeEntrar(rolesAdmitidos = ROLES) {
  if (estado.modo === 'demo') return true;
  return Boolean(estado.sesion) && Boolean(estado.rol) && rolesAdmitidos.includes(estado.rol);
}

export async function entrar(email, password) {
  const repositorio = obtenerRepositorio();
  if (repositorio.modo !== 'supabase') return { ok: true };

  const { error } = await repositorio.cliente.auth.signInWithPassword({
    email: String(email || '').trim(),
    password: String(password || ''),
  });

  if (error) {
    /*
     * El mensaje es el MISMO para «no existe ese correo» y para «la contraseña
     * está mal».
     *
     * Distinguirlos convierte el formulario en un verificador de correos: se
     * prueba una dirección y el error dice si hay cuenta. Con eso se arma la
     * lista de quién trabaja en el local.
     */
    return { ok: false, mensaje: 'Correo o contraseña incorrectos.' };
  }
  return { ok: true };
}

export async function salir() {
  const repositorio = obtenerRepositorio();
  if (repositorio.modo === 'supabase') await repositorio.cliente.auth.signOut();
  actualizar({ sesion: null, rol: null, businessId: null, error: '' });
}

/**
 * Dibuja la pantalla de acceso dentro de un contenedor.
 *
 * Devuelve `true` si la persona puede seguir. Quien llama no dibuja nada más
 * hasta que esto diga que sí.
 */
export function pintarAcceso(contenedor, { titulo, rolesAdmitidos, alEntrar }) {
  const s = estado;

  if (s.cargando) {
    contenedor.innerHTML = '<div class="acceso"><p class="acceso__cargando">Verificando tu sesión…</p></div>';
    return false;
  }

  if (puedeEntrar(rolesAdmitidos)) return true;

  const sesionPeroSinPermiso = Boolean(s.sesion) && Boolean(s.error);

  contenedor.innerHTML = `
    <div class="acceso">
      <form class="acceso__caja" data-formulario-acceso>
        <h1 class="acceso__titulo">${escapar(titulo)}</h1>
        ${sesionPeroSinPermiso ? `
          <div class="aviso" data-tono="error">
            ${escapar(s.error)}
            <div style="margin-top:var(--e3)">
              <button class="boton boton--secundario" type="button" data-salir>Salir de ${escapar(s.sesion.email)}</button>
            </div>
          </div>`
        : `
          <p class="acceso__bajada">Entrá con la cuenta que te dio el local.</p>
          <div class="campo">
            <label for="acceso-email">Correo</label>
            <input id="acceso-email" name="email" type="email" autocomplete="username" required />
          </div>
          <div class="campo">
            <label for="acceso-password">Contraseña</label>
            <input id="acceso-password" name="password" type="password" autocomplete="current-password" required />
          </div>
          <div class="aviso" data-tono="error" data-error-acceso hidden></div>
          <button class="boton boton--principal boton--ancho boton--alto" type="submit">Entrar</button>
        `}
      </form>
    </div>`;

  const formulario = contenedor.querySelector('[data-formulario-acceso]');

  contenedor.querySelector('[data-salir]')?.addEventListener('click', async () => {
    await salir();
    pintarAcceso(contenedor, { titulo, rolesAdmitidos, alEntrar });
  });

  formulario?.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const boton = formulario.querySelector('button[type="submit"]');
    const aviso = formulario.querySelector('[data-error-acceso]');
    if (!boton) return;

    boton.disabled = true;
    boton.textContent = 'Entrando…';
    aviso.hidden = true;

    const datos = new FormData(formulario);
    const resultado = await entrar(datos.get('email'), datos.get('password'));

    boton.disabled = false;
    boton.textContent = 'Entrar';

    if (!resultado.ok) {
      aviso.textContent = resultado.mensaje;
      aviso.hidden = false;
      return;
    }
    // `onAuthStateChange` ya disparó la resolución del rol; alEntrar re-dibuja.
    alEntrar?.();
  });

  return false;
}

function escapar(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
