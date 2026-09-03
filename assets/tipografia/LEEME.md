# Tipografía

## Anton

`anton-latin.woff2` · `anton-latin-ext.woff2`

Diseñada por Vernon Adams, Kimberly Geswein, Cyreal.
**SIL Open Font License 1.1** — uso comercial permitido, incluida la
incorporación en un sitio web. https://openfontlicense.org

### Por qué está acá y no en Google Fonts

Servida desde `fonts.gstatic.com` cuesta una resolución DNS, un handshake TLS y
una conexión a un tercero antes de que se pinte el primer título. Alojada acá es
una petición más al mismo origen que ya está abierto.

Son dos archivos y no uno porque cada uno declara su `unicode-range`: el
navegador baja `latin` (18 KB) siempre y `latin-ext` (31 KB) **sólo** si la
página usa un carácter que lo necesite. Las tildes y la eñe del castellano están
en `latin`, así que en la práctica se bajan 18 KB.

### Dónde se usa

SÓLO en los títulos de display: marca, portada, títulos de sección y precios
grandes. El texto corrido usa la pila del sistema, que no cuesta ninguna
petición. Anton en un párrafo es ilegible: es una tipografía de cartel.
