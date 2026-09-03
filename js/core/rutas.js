/*
 * ─────────────────────────────────────────────────────────────────────────────
 * DÓNDE ESTÁ MONTADA LA APP
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * EL PROBLEMA QUE RESUELVE
 * Las cuatro pantallas cuelgan de rutas distintas —`/`, `/panel/`,
 * `/repartidor/`, `/seguimiento/`— y todas dibujan las mismas fotos de la carta.
 * Una ruta relativa al documento (`assets/carta/clasica.webp`) funciona en la
 * tienda y da 404 en el panel. Una absoluta (`/assets/...`) funciona en un
 * dominio propio y da 404 en GitHub Pages, donde el sitio vive bajo
 * `/hamburgueseria-neuquen-staging/`.
 *
 * LA RAÍZ SE DEDUCE DEL PROPIO MÓDULO, NO DE LA URL DE LA PÁGINA.
 * Este archivo está siempre en `<raíz>/js/core/rutas.js`, sin importar desde
 * qué pantalla se lo importe. Subir dos niveles desde `import.meta.url` da la
 * raíz y da igual el host, el subdirectorio y la pantalla.
 *
 * Es la alternativa a pasarle una base a cada pantalla, que es la clase de
 * parámetro que alguien olvida en la quinta pantalla y nadie nota hasta que la
 * carta aparece sin fotos.
 */

/** La raíz de la aplicación, absoluta. Termina en `/`. */
export const RAIZ_DE_LA_APP = new URL('../../', import.meta.url).href;

/** Resuelve una ruta relativa a la raíz de la app. */
export function rutaDeApp(ruta) {
  const limpia = String(ruta ?? '').trim();
  if (!limpia) return '';
  // Una URL ya absoluta se respeta: el día que las fotos vivan en Supabase
  // Storage o en un CDN, `image_url` va a venir con esquema y no hay que
  // resolver nada.
  if (/^(https?:)?\/\//i.test(limpia) || limpia.startsWith('data:')) return limpia;
  return new URL(limpia.replace(/^\/+/, ''), RAIZ_DE_LA_APP).href;
}

/**
 * El `srcset` de una foto de la carta.
 *
 * Cada foto se genera en dos anchos: `<id>-sm.webp` (480 px) y `<id>.webp`
 * (960 px). Un teléfono con datos móviles baja 15 KB en vez de 45, y en una
 * carta de 19 productos eso es medio megabyte de diferencia — que es la
 * diferencia entre ver la carta y cerrarla.
 *
 * Devuelve `null` cuando la ruta no sigue el patrón (una URL de CDN, por
 * ejemplo): quien llama dibuja un `src` pelado y no un `srcset` inventado.
 */
export function juegoDeFoto(imagen) {
  const ruta = String(imagen ?? '').trim();
  if (!ruta || !/\.webp$/i.test(ruta) || /^(https?:)?\/\//i.test(ruta)) return null;
  const chica = ruta.replace(/\.webp$/i, '-sm.webp');
  return {
    src: rutaDeApp(ruta),
    srcset: `${rutaDeApp(chica)} 480w, ${rutaDeApp(ruta)} 960w`,
  };
}
