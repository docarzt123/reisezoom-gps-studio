# Reisezoom GPS Studio — Manual de usuario

Suite multiplataforma para flujos de trabajo con GPS (macOS · Windows · Linux). **v0.3.3** — Beta.

Módulos:
- **Animator** — el track GPX como vídeo animado con mapa 3D (MP4)
- **Ruta de viaje** — la llegada como vídeo: origen/destino → trayecto calculado y animado, con el GPX cargado como ghost
- **Tour-Map** — el track GPX como PNG estático (p. ej. para miniaturas de YouTube)
- **Geotagger** — escribe las coordenadas GPS del GPX en los EXIF de JPG / RAW / vídeo
- **Inspector GPX** — repara el track punto por punto: sana valores atípicos, rellena huecos, mueve puntos, recorta inicio/final

---

## 1 · Instalación

### Descarga
Descarga la versión adecuada para tu sistema operativo:

| Plataforma | Archivo | Enlace |
|-----------|-------|------|
| macOS (Apple Silicon, M1 o posterior) | `ReisezoomGPSStudio-macos.dmg` | https://s.reisezoom.com/gps-studio-mac |
| Windows (x64) | `ReisezoomGPSStudio-windows-setup.exe` | https://s.reisezoom.com/gps-studio-win |
| Linux (x64) | desde el código fuente | consulta la sección **Linux** más abajo |

> **⚠️ macOS solo con Apple Silicon (M1/M2/M3/…).** Los **Mac Intel más antiguos no son compatibles** — la app no arranca en ellos. Para saber si tienes un Mac con Apple Silicon, ve a  → **Acerca de este Mac**: si pone «Chip: Apple M…», estás listo; si pone «Procesador: Intel», por desgracia no.

**En macOS y Windows no necesitas instalar nada adicional** — `ffmpeg` y `exiftool` vienen incluidos en la app. **Linux** se ejecuta directamente desde el código fuente (paquetes del sistema + `python app.py`, ver más abajo).

### macOS (.dmg)
1. Haz doble clic en el `.dmg`
2. Arrastra la app a la carpeta **Aplicaciones**
3. En el **primer arranque**, macOS pregunta brevemente una vez («… es una app descargada de internet. ¿Seguro que quieres abrirla?» — con la nota de que Apple la ha comprobado y **no ha encontrado malware**) → haz clic en **«Abrir»**.
4. A partir del segundo arranque basta con un doble clic normal.

> La app está **firmada y notarizada por Apple** — el antiguo bloqueo de «desarrollador no verificado» ya no existe. La pregunta puntual «¿Seguro que quieres abrirla?» la muestra macOS con **cualquier** app descargada de la red (también con las firmadas) y solo aparece la primera vez.

Si excepcionalmente macOS dice «está dañada y no se puede abrir» (p. ej. tras una descarga incompleta):
```bash
xattr -dr com.apple.quarantine "/Applications/Reisezoom GPS Studio.app"
```

### Windows
1. Haz doble clic en `ReisezoomGPSStudio-windows-setup.exe`
2. Diálogo de SmartScreen: **«Más información»** → **«Ejecutar de todas formas»**
3. Completa el asistente de instalación (elegir idioma → confirmar ruta → opcional acceso directo en el escritorio)
4. Listo — la app arranca automáticamente y crea una entrada en el menú de inicio
5. En el primer render, la app descarga Chromium (~150 MB, una sola vez, tarda 1-2 min)

> **¿Quieres ir sobre seguro?** La versión de Windows (todavía) no está firmada. Quien lo desee puede comprobar de antemano el `.exe` descargado en un servicio como [VirusTotal](https://www.virustotal.com) — las builds proceden de una pipeline automatizada de GitHub sin pasos intermedios manuales.

Desinstalar como cualquier otra app de Windows: **Panel de control → Aplicaciones y características → Reisezoom GPS Studio → Desinstalar**.

### Linux (desde el código fuente)

Para Linux **no hay un binario listo** — el backend de mapa/render (pywebview) necesita los bindings de GTK/WebKit del sistema, que no se pueden empaquetar de forma fiable en un binario único. En su lugar, la app se ejecuta directamente desde el código fuente (abierto):

**1. Paquetes del sistema** (una sola vez — incluye ffmpeg + ExifTool para el render y los metadatos de fotos):

```bash
# Fedora / RHEL
sudo dnf install git python3 python3-gobject gobject-introspection \
                 webkit2gtk4.1 python3-cairo ffmpeg perl-Image-ExifTool

# Debian / Ubuntu
sudo apt install git python3 python3-venv python3-gi python3-gi-cairo \
                 gir1.2-webkit2-4.1 libwebkit2gtk-4.1-0 ffmpeg libimage-exiftool-perl

# Arch
sudo pacman -S git python python-gobject webkit2gtk-4.1 ffmpeg perl-image-exiftool
```

**2. Obtener el repo e iniciar:**

```bash
git clone https://github.com/docarzt123/reisezoom-gps-studio.git
cd reisezoom-gps-studio
python3 -m venv --system-site-packages .venv   # --system-site-packages → el venv ve el GTK del sistema (gi)
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

En el primer render, la app descarga Chromium una sola vez (~150 MB).

Sin ExifTool, las fotos JPEG, TIFF y HEIC funcionan igualmente (mediante piexif +
pillow-heif, ambos integrados). Solo los archivos RAW (CR3, NEF, ARW, RAF, RW2, ORF,
DNG, PEF, RWL, SRW) y los metadatos de vídeo necesitan exiftool, y también la
escritura de GPS en HEIC.

---

## 2 · Primeros pasos

### Configurar el token de Mapbox 🗺️
Animator + Tour-Map necesitan un **token gratuito de Mapbox** para los mapas 3D. **El Geotagger también funciona sin él**.

En el primer arranque de la app se abre automáticamente un modal de onboarding con dos opciones:
- **Con token de Mapbox** (recomendado) — todas las funciones, gratis en 2 minutos
- **Sin token (OSM)** — funciona al instante, pero solo con el mapa estándar (sin Satellite, sin 3D)

**Así consigues un token gratuito de Mapbox:**
1. Crea una cuenta en [account.mapbox.com](https://account.mapbox.com/auth/signup)
2. Haz clic en el correo de confirmación
3. En el panel, ve a [Access tokens](https://account.mapbox.com/access-tokens/)
4. Copia el «Default public token» — empieza por `pk.eyJ…`
5. Pégalo en la app en el campo del token → Guardar

> ⚠️ **Se requiere tarjeta de crédito**: desde mediados de 2026, Mapbox exige una tarjeta de crédito al registrarse — **también para la cuenta gratuita**. Suena raro al principio, pero se ha vuelto habitual en muchos servicios en la nube. **No se cobra nada** mientras te mantengas en el nivel gratuito.
>
> 💡 **Nivel gratuito: 50 000 cargas de mapa al mes — gratis.** En la práctica alcanza para muchísimos renders. Con un uso normal de aficionado nunca verás una factura — tendrías que producir de forma realmente intensiva para llegar al límite.

**Cambiar el token después**: menú de macOS → **Reisezoom** → **Preferencias…** (o Cmd+,) — Windows/Linux: botón ⚙ arriba a la derecha.

### Cambiar de idioma 🌍
La app arranca automáticamente en el **idioma del sistema** (alemán, inglés o español — con inglés como reserva). Se cambia en el **modal de preferencias ⚙** → menú desplegable de idioma. Activo al instante, sin necesidad de reiniciar.

### Ajustar la calidad de render y la exportación (desde v0.9.245) ⭐
En el **modal de preferencias ⚙** está el bloque **«Calidad y exportación»** — se aplica globalmente a la exportación de vídeo del Animator:
- **Captura de fotogramas:** **Rápido (JPEG)** es el valor por defecto y hace el render **~10× más rápido** (la captura de los fotogramas individuales era el verdadero cuello de botella). Como el vídeo se codifica de todas formas con pérdidas, la calidad es visualmente idéntica. **Máximo (PNG, sin pérdidas)** solo hace falta si realmente necesitas fotogramas individuales sin pérdidas — bastante más lento.
- **Calidad JPEG** (solo con JPEG): por defecto 92, totalmente suficiente.
- **Códec de vídeo:** H.264 (compatible, archivo más pequeño) · H.265/HEVC (mejor compresión) · ProRes 4444 (calidad máster, archivo grande).
- **Calidad de vídeo (CRF)** y **velocidad del encoder** (velocidad ↔ tamaño de archivo).

El **modo alfa** («Sin mapa» en el Animator) usa automáticamente fotogramas PNG sin pérdidas y ProRes 4444 — ese no hace falta ajustarlo aquí.

### Lo que la app recuerda
- La última selección de módulo
- Todos los ajustes de render por módulo (estilo, pitch, resolución, color, códec, FPS, etc.)
- La última carpeta de guardado (por módulo)
- El token de Mapbox
- La selección de idioma

Archivo de ajustes:
- macOS: `~/Library/Application Support/Reisezoom GPS Studio/settings.json`
- Windows: `%APPDATA%\Reisezoom GPS Studio\settings.json`
- Linux: `~/.local/share/Reisezoom GPS Studio/settings.json`

### Sesiones y proyectos (desde v0.8) ⭐

Las **sesiones** están vinculadas al track: cada track GPX recibe automáticamente su propia sesión (reconocida mediante un hash de las coordenadas del track). Si cargas el mismo track por segunda vez, recuperas **todos los ajustes + keyframes que habías hecho** — nunca más «se perdió» al cambiar de módulo.

Los **proyectos** son variantes dentro de una sesión — p. ej. «variante estándar» + «reels en vertical» + «con inserciones de fotos». Por cada track puedes crear tantos proyectos como quieras.

**¿Dónde lo encuentro?** En la topbar arriba a la derecha — un menú desplegable de proyecto con 4 acciones:
- 🆕 **Nuevo proyecto** (con valores por defecto de fábrica)
- 📋 **Duplicar el actual** (copia todos los ajustes + keyframes)
- ✏️ **Renombrar**
- 🗑 **Eliminar** (el último proyecto de una sesión no se puede eliminar — se restaura automáticamente como «Estándar»)

Los datos de sesión se encuentran en:
- macOS: `~/Library/Application Support/Reisezoom GPS Studio/sessions/`

(Por cada hash de track, una carpeta con snapshot del GPX + projects.json con todas las variantes.)

---

## 2b · Abrir archivos de track — muchos formatos (desde v0.9.282) ⭐

No necesitas tener un **GPX**. Abre (a través de la barra GPX o mediante arrastrar y soltar) simplemente uno de estos formatos — la app lo convierte automáticamente en un GPX al cargarlo y sigue trabajando con él:

| Formato | Extensión | Suele venir de |
|---|---|---|
| **GPX** | `.gpx` | casi todas las apps (Komoot, Strava, Garmin Connect, …) |
| **FIT** | `.fit` | Garmin, Wahoo, Coros, Suunto, Strava (ciclocomputadores y relojes deportivos) |
| **NMEA 0183** | `.nmea` / `.log` | Canon EOS 6D, GPS marinos, GPS-loggers |
| **KML / KMZ** | `.kml` / `.kmz` | Google Earth, Google My Maps |
| **TCX** | `.tcx` | Garmin Training Center, exportación de Strava |
| **GeoJSON** | `.geojson` | herramientas web/OSM |

Las altitudes y las marcas de tiempo se conservan — siempre que estén presentes en el formato — (importante para el geotagging y la indicación de velocidad).

**Exportar como GPX:** a través del menú **Reisezoom → «Exportar como GPX…»** guardas el track cargado actualmente como un archivo `.gpx` real — aunque provenga de otro formato. Práctico cuando, p. ej., necesitas un GPX limpio a partir de un `.log` de cámara.

**Exportar como CSV:** a través de **Reisezoom → «Exportar como CSV…»** obtienes el mismo track como tabla (`index,lat,lon,ele,time`, tiempo en ISO-UTC). Ideal para hojas de cálculo, análisis propios o la importación en otras herramientas.

> Nota: un `.json` solo se reconoce si tiene aspecto de track GeoJSON; un `.txt` solo si contiene sentencias NMEA reales (`$GP…`).

---

## 3 · Módulo: Animator — renderizar el GPX como vídeo

### Qué hace
Carga un archivo GPX y renderiza un MP4 en el que la línea del track se dibuja animada sobre un mapa 3D de Mapbox. Usos: intro para vídeos de YouTube, loops para páginas web, animación de recuerdos.

### Flujo de trabajo
1. **Cargar GPX**: botón «📁 Seleccionar archivo GPX» o arrastrar y soltar en la ventana
2. **El track se muestra en el mapa** (vista previa en directo, en el marco letterbox WYSIWYG)
3. **Ajustar los parámetros** (ver más abajo) — todos los cambios son visibles de inmediato en la vista previa
4. Haz clic en **«▶ Renderizar vídeo»**

**El fotograma actual como imagen (snapshot, desde v0.9.412):** debajo del botón de render está **«📸 Fotograma actual como imagen»**. Desplaza la vista previa hasta un punto bonito y pulsa el botón — se guarda **exactamente ese fotograma** (el track hasta la posición actual, tu encuadre de cámara, los overlays del momento) como **imagen a resolución completa**. Perfecto para miniaturas o un fotograma fijo de un vuelo en marcha.

**Abrir como Tour-Map (desde v0.9.412):** el botón **«🗺 Abrir como Tour-Map»** cambia al Tour-Map y **adopta exactamente tu encuadre actual** (posición, zoom, rotación, inclinación) — en lugar de encajar toda la ruta como haría normalmente. Allí puedes renderizar el fotograma fijo como **PNG**; conserva el ángulo de visión adoptado. *(Un mapa interactivo para la web lo tienes en su propio módulo [«🌐 Mapa web»](#5c--módulo-mapa-web).)* Con el botón **⤢** (abajo a la derecha en el mapa) vuelves a la vista general.

5. **Diálogo de guardado**: ¿dónde va el MP4? Propuesta: `<nombre-GPX>_<WxH>_<códec>.mp4`
6. El render se ejecuta — la vista previa en directo muestra cada fotograma
7. Listo → la vista de resultado muestra el MP4 + el botón «Mostrar en el Finder»

> **¿Animar la llegada/ruta?** Para eso existe desde v0.9.205 un módulo propio **🛣 Ruta de viaje** (origen/destino → trayecto calculado). Consulta el capítulo 4.

### Ajustes

> **↩︎ Deshacer para todo (desde v0.9.322):** cualquier cambio de ajuste se puede deshacer con **⌘Z** (Mac) / **Ctrl+Z** (Windows) — en **Animator, Tour-Map, Geotagger y Animador de datos**: colores, tipografía, grosor de línea, glow, campos de overlay, keyframes, trim, offset de tiempo, etc. **Rehacer** con **⌘⇧Z** / **Ctrl+Y**. (Un arrastre de slider = un paso.)

**Mapa:**
- **Estilo**: 6 estilos de Mapbox (Satellite 3D, Satellite+Streets, Outdoors, Streets, Claro, Oscuro)
- Activar **terreno 3D** — en rutas alpinas se ve espectacular
- **Color + grosor del track** — a tu elección
- **Estilo de línea** (desde v0.6.5) — Continua / Discontinua / Punteada / Raya-punto / **Tubo**. En las variantes de raya/punto hay un slider adicional de **separación de puntos** (multiplica las longitudes de raya o punto). «Tubo» (desde v0.8.10, en el desplegable de estilo de línea desde v0.8.12) coloca una franja blanca de resalte encima de la línea → da un aspecto más plástico, como una manguera.
- **Sombra bajo el track** (desde v0.4) — hace que el track parezca una línea flotante sobre el mapa. Intensidad 0–10 px (por defecto 4). Con el terreno 3D activo, la sombra permanece en el suelo mientras el track se renderiza 150 m por encima → aspecto 3D más plástico.
- **Carteles de waypoint (desde v0.9.171, totalmente personalizables desde v0.9.179)** — coloca carteles de texto sobre la ruta (p. ej. «¡Cima alcanzada!»). Zona **«🚩 Carteles»** en la barra lateral:
  - **Colocar:** **«📍 Sobre el track»** → clic en el track (se ancla), o **«📌 Colocación libre»** → clic en **cualquier punto** del mapa (p. ej. un lugar de interés apartado de la ruta). En la colocación libre, el **momento de aparición** sigue rigiéndose por el punto del track más cercano (anclaje en el track + offset de coordenadas libre).
  - **Editar:** al hacer clic en un cartel (lista o mapa) se abre un **panel de editor flotante** — arrastrable libremente por su cabecera (⠿), también fuera del mapa. El cartel que estás editando siempre es visible (sin importar dónde esté el punto de reproducción).
  - **Aspecto (todo en directo):** forma (bocadillo · banderín de meta · chincheta · señal indicadora · sencillo), color de **fondo** + color de texto (el selector **«Fondo»** es el **único** color de la caja/bocadillo del cartel — desde v0.9.271 ya no hay un «color de acento» separado ni un «Auto»), tipografía (Sistema · Redondeada · Estrecha · Serif · Monospace · Impactante), tamaño/grosor/cursiva/alineación, texto multilínea, radio de esquinas, opacidad, borde (grosor+color), **longitud del poste** (solo en banderín de meta + señal indicadora — la longitud de los postes/mástil bajo el cartel) y sombra. **Añadir imagen** convierte el cartel en una **tarjeta de foto** (el texto pasa entonces a ser el pie de imagen); el tamaño de la imagen se ajusta por separado.
    - **Dirección de la punta del bocadillo (desde v0.9.408):** con el estilo **Bocadillo** eliges en el editor, bajo **«Dirección de la punta»**, hacia dónde apunta — **abajo, arriba, izquierda o derecha**. El bocadillo se desplaza automáticamente al lado opuesto para que la punta siempre señale el lugar. (Análogo a la elección de dirección en la señal indicadora; se aplica al Animator y al Tour-Map.)
    - **Un color en vez de dos (desde v0.9.271):** antes había «color de acento» **y** «fondo» — ambos rellenaban la misma superficie, lo cual resultaba confuso. Ahora solo existe el selector **«Fondo»** = el color del cartel (en la chincheta, también el de la gota). El **borde** lo ajustas por separado en «Borde».
    - **Fondo «Ninguno» (transparente, desde v0.9.269):** en el fondo puedes elegir ahora, además de «Auto», la opción **«Ninguno»** → la caja del cartel queda completamente **transparente**. Práctico para **tarjetas de foto sin marco de color**: entonces solo ves la imagen (más un borde opcional), en lugar de un margen de color alrededor de la foto que, junto con el borde, parecería un **doble marco**.
  - **Editar sin parpadeos (desde v0.9.255):** al arrastrar los reguladores (tamaño, esquinas, borde, sombra, longitud del poste…), la vista previa cambia de inmediato y con suavidad. En el ensayo y en el vídeo final, los carteles se mueven fluidamente con la cámara.
  - **Comportamiento y timing:** «Crecer con el zoom» sí/no, **«Mostrar todo el tiempo»** (visible de forma continua), **anticipación** de X seg. (aparece antes) + **«Visible hasta»** X seg. (desaparece más tarde; 0 = permanece hasta el final), **transición** (dura/fundido). Por lo demás, aparece en el vídeo justo cuando el marcador alcanza el punto; se muestra erguido hacia la cámara. **Desde v0.9.204:** un cartel justo al inicio del track con **anticipación** aparece ahora ya **en la intro** (anticipación = 1 seg. → surge en el último segundo de la intro, en lugar de aparecer de golpe al empezar el track).
  - **Momento de disparo (desde v0.9.259) — para trayectos de ida y vuelta:** si tu track pasa **dos veces** por el mismo lugar (p. ej. ida y vuelta), la app no puede saber solo por la posición del clic a cuál de los pasos te refieres. Solución en el bloque **«Momento de disparo»**:
    1. Desplaza el **scrubber** de la línea de tiempo exactamente al momento en que el marcador está en ese punto en el **paso deseado**.
    2. Haz clic en **🕐 «En la posición de la línea de tiempo»** → el cartel queda fijado exactamente a ese momento (línea de estado: «Momento fijo: NN %»).
    3. **«Auto»** vuelve a activar el reconocimiento automático de posición.
    Esto funciona igual en la vista previa y en el vídeo final. (En las **tarjetas de foto** ocurre automáticamente a partir de la hora de captura de la foto.)
  - **Ayuda de vista previa:** casilla **«Mostrar TODOS los carteles en la vista previa»** — muestra todos los carteles a la vez al colocarlos (solo vista previa; en el vídeo sigue rigiendo el timing).
- **Ghost-Track (desde v0.9.169)** — muestra la **ruta completa** ya semitransparente en el fondo, mientras que solo la parte animada se dibuja encima con opacidad total. Así se ve desde el principio hacia dónde va el recorrido. Ajustable: **color propio del ghost-track** (selector de color propio, independiente del color del track — p. ej. un gris discreto, desde v0.9.170) y **opacidad** (slider 5–80 %, por defecto 30 %). Funciona en la vista previa y en el render, incluido el modo alfa/transparente. Desactivado por defecto.
- **Varios colores de track (desde v0.9.435, ampliado en v0.9.448)** — la línea del track puede **cambiar de color**. El selector **«Colorear según»** decide en función de qué:
  - **Distancia (km)** — paradas de color **en km** (número), **en la posición actual del marcador** (adopta la posición del scrubber) o **en todos los waypoints del GPX** (automático). El primer color se aplica desde el km 0 (= color del track).
  - **Cualquier serie de datos de la pista** — desde la v0.9.448 aquí está **todo lo que el Animador de datos puede representar**: altitud, velocidad, pendiente y cualquier valor de sensor de archivos FIT/TCX (**pulso, potencia, cadencia, temperatura**…). La lista solo muestra **lo que la pista cargada contiene realmente**; la unidad aparece entre paréntesis.

    Las paradas de color se definen entonces **en el rango de valores de esa serie** (p. ej. «desde 145 bpm», «desde 8 %», «desde 2400 m»). **«＋ desde &lt;serie&gt; (aquí)»** adopta el valor en la posición del marcador y **«Auto (mín → máx)»** aplica una rampa azul→rojo sobre todo el rango. Se admiten valores negativos, algo importante en **pendiente** (bajadas) y **temperatura** (heladas).

  Cada parada tiene **valor + color**, 🗑 la quita. El interruptor **«Transición»** define si el color cambia **brusco** (bandas nítidas) o como un **degradado** suave. Funciona WYSIWYG en la vista previa, la prueba y el render. Desactivado por defecto. *(De momento solo animador de un track.)*
- **Mapa sin etiquetas** (desde v0.4.4) — oculta nombres de lugares, nombres de calles e iconos de POI en el mapa. Convierte el mapa en un fondo puro — un buen look si quieres que el track sea el protagonista visual en vez de una vista tipo Google Maps. Funciona con todos los estilos de mapa y también en el módulo Tour-Map.

**Overlays** (todos activables por separado, libremente colocables):
- **Caja de totales** — valores totales del track
- **Caja en directo** — valores que corren durante la animación
- **Perfil de altitud** — línea animada

**🆕 Editor de estadísticas (desde v0.9.321): tú eliges qué se muestra — y en qué orden.** Bajo la caja de totales y la caja en directo hay, en cada caso, una **lista de campos**. Marcar/desmarcar la casilla determina qué aparece; con el **tirador ⠿ arrastras los campos** al orden deseado. Valores seleccionables:
- **En directo (corre con la animación):** Recorrido, Restante, **Velocidad (km/h)**, Transcurrido, **Tiempo restante**, Altitud, **Pendiente (%)**.
  - *WYSIWYG (desde v0.9.325):* estos valores ya corren **en la vista previa** — al arrastrar el scrubber y en el ensayo cuentan exactamente igual que en el vídeo final, y el perfil de altitud se rellena hasta la posición del marcador. Así ves de antemano, fotograma a fotograma, cómo se verán las estadísticas en el render.
- **Total:** Distancia, Tiempo (tiempo total), **Tiempo en movimiento** (tiempo de desplazamiento sin pausas), **Ø Velocidad** (a partir del tiempo en movimiento), **Ø Velocidad (total)** (a partir del tiempo total), **Velocidad máx.**, Desnivel positivo, Desnivel negativo, **Punto más alto**, **Punto más bajo**.
  - *Estándar (desde v0.9.324):* los tracks nuevos muestran **Distancia · Tiempo en movimiento · Ø Velocidad · Velocidad máx. · Ascenso · Descenso**. El **tiempo en movimiento** es el tiempo que se muestra en lugar del tiempo total — ambos siguen siendo libremente seleccionables. Una vez que tengas configurada tu selección favorita, la app la recuerda con **«Guardar como valores por defecto propios»** (menú de proyecto) para **todos** los proyectos nuevos.
  - *Detección de pausas:* una pausa es un tramo en el que, a lo largo de una **ventana de 60 segundos, apenas has avanzado neto** — no cuenta la velocidad momentánea. Así, caminar despacio en fuerte pendiente (~1 km/h, pero de forma constante) cuenta como movimiento, y solo la detención real cuenta como pausa.
  - *Precisión (desde v0.9.324):* el **tiempo en movimiento** y la **velocidad máx.** se calculan sobre la **resolución completa del track** — la velocidad punta ya no se suaviza y elimina por la simplificación del render.
- **❤️ Valores de sensores (desde v0.9.330):** si tu track trae datos de sensores — como un **archivo FIT/TCX** de Garmin, Wahoo, Polar o Coros, o un **archivo GPX con extensiones de frecuencia cardíaca** —, los campos disponibles (**frecuencia cardíaca, cadencia, temperatura, potencia** y quizá otros) aparecen automáticamente **al final de la lista de campos en directo**. Marca, ordena y da estilo como a cualquier otro valor en directo; corren en el render y en la vista previa **punto por punto, sincronizados con el track** (WYSIWYG). Si tu track no tiene sensores, aquí tampoco aparece nada.
  - **✎ Renombrar y unidad (desde v0.9.334):** cada campo de sensor tiene un **✎**. Con él puedes cambiar la **etiqueta y la unidad por proyecto** — hacer legibles abreviaturas crípticas de dispositivo como `GRD_PCT` o `NGP`, renombrar «cadencia» al correr como «cadencia de zancada / spm», o indicar la velocidad en «nudos» al navegar a vela. «Restablecer» devuelve el valor por defecto.
- Los valores que tu track no proporciona (p. ej. velocidad/tiempo sin marcas de tiempo, altitud/pendiente sin datos de altitud) se **atenúan automáticamente**.

**🎨 Aspecto de las cajas de estadísticas (desde v0.9.321):** al final de la sección de overlays eliges **tipografía** (Sistema, Nunito, Quicksand, Fredoka, Oswald, Bebas Neue), **color de texto**, **color de fondo** y **opacidad del fondo** — se aplica a todas las cajas, con vista previa en directo en el mapa.

**Posiciones (desde v0.9.284):** las cajas de estadísticas en una **cuadrícula de 3×3** — las cuatro esquinas más **arriba (↥)**, **abajo (↧)**, **izquierda (⇤)**, **derecha (⇥)** centradas y **centro (✛)** (p. ej. para un rótulo de título/apertura). El **perfil de altitud** es más estrecho y ofrece además **arriba ancho / abajo ancho** (a lo largo de todo el ancho).

**📊 Gráficos en el vídeo (desde v0.9.443):** en la sección de overlays, debajo del perfil de altitud sencillo, está el apartado **📊 Gráficos**. Con él superpones **tantos** gráficos de series de datos totalmente diseñados como quieras directamente sobre el vídeo del mapa — altitud, pulso, velocidad, potencia y cualquier otra serie que ofrezca tu track, incluyendo **zonas de color** y un **segundo eje Y**.

![Dos gráficos en el vídeo final: el perfil de altitud a lo ancho abajo y la curva de velocidad a su derecha — ambos van sincronizados con la posición en el mapa.](img/diagramme-im-video.jpg)

- **«＋ Añadir gráfico»** crea una tarjeta. Por cada gráfico eliges la **serie de datos**, la **posición** (9 esquinas/centros), el **ancho** y el **alto**, además de una **ventana temporal** (desde/hasta el segundo del vídeo).
- **Opacidad de primer plano y de fondo por separado (desde v0.9.445):** con **«Opacidad del gráfico»** controlas la curva y las etiquetas, y con **«Opacidad del fondo»** la caja que hay detrás. Si bajas el **fondo a 0 %**, el mapa se transparenta por completo y solo la línea de datos flota sobre el vídeo. La vista previa lo muestra ahora **WYSIWYG** (transparencia real en lugar de una caja blanca).
- **Ejes por gráfico (desde v0.9.447):** cada tarjeta de gráfico tiene sus propios controles **«Ejes»** y **«Fuente de ejes»** (8–60 px). Prevalecen sobre el estilo adoptado del Animador de datos, de modo que una superposición pequeña puede llevar etiquetas grandes o prescindir por completo de los ejes. Importante: el tamaño de fuente se refiere a la **resolución del vídeo**, no a la caja del gráfico. Hasta la v0.9.446 las etiquetas se encogían con la caja (un gráfico de 270 px daba texto de 5 px); eso está corregido.

![La tarjeta de gráfico en la barra lateral: serie de datos, posición, ancho/alto, opacidad separada para el gráfico (primer plano) y el fondo, y «Adoptar del Animador de Datos».](img/diagramme-sidebar.png)

- **El aspecto lo diseñas en el Animador de Datos** (color de línea, área, zonas de color, barra de información, marcador, segunda serie …) y luego pulsas **«🎨 Adoptar del Animador de Datos»** en el gráfico — después el gráfico se ve exactamente igual. Así puedes, por ejemplo, configurar un gráfico de pulso elaborado, adoptarlo y colocar un segundo para la altitud al lado.
- Cada gráfico **va sincronizado con el punto del mapa**: el marcador se sitúa justo sobre la posición actual — ya lo ves en la vista previa al arrastrar el scrubber y en el ensayo.
- Funciona también en la **exportación alfa** (ProRes 4444 .mov transparente): los gráficos quedan entonces como una capa de overlay propia sobre tu vídeo en Premiere / Final Cut / DaVinci.
- El **perfil de altitud sencillo de siempre** permanece sin cambios — los gráficos son una herramienta adicional, no un sustituto.

**⏱ Ventana temporal por caja** (desde v0.9.228): bajo cada caja de overlay puedes
ajustar **a partir de qué segundo y hasta qué segundo del vídeo** se muestra
— p. ej. mostrar la caja en directo solo a partir del segundo 2, u ocultar la caja de totales
después del segundo 8. Dos campos «desde … s» / «hasta … s», contados sobre el
**vídeo completo** (intro + animación + hold). **Vacío o 0** = como hasta ahora (visible todo
el tiempo). La aparición/desaparición ya la ves en el **ensayo**, antes de
renderizar.

**Cámara:**
- **🎥 Cámara estable (terreno 3D)** (casilla, arriba del todo en la sección, **por defecto: desactivada**) — *contra el rebote arriba-abajo de la cámara sobre terreno montañoso.* En vuelos de cámara con keyframes sobre terreno 3D, la cámara normalmente «cabalga» sobre las montañas y rebota hacia arriba en cada subida y hacia abajo en el valle (sobre todo con inclinación fuerte). Marca esta casilla y la cámara vuela **desacoplada por el espacio, como un dron** — en tus keyframes acierta exactamente el encuadre configurado, y entre ellos se mueve de forma estable, sin el rebote del terreno. **Por defecto está desactivada** (comportamiento clásico); actívala solo si el rebote sobre las montañas te molesta. Se aplica tanto en el **ensayo** como en el **render** final (lo que ves es lo que obtienes). *Consejo:* si un proyecto concreto con la cámara estable activada se ve raro alguna vez (p. ej. una aproximación desde la vista mundial), simplemente desmárcala de nuevo.
- **Inclinación (Pitch)** 0–80° — lo oblicuo que mira la cámara
- **Rotación** 0–60° — barrido de la cámara durante el vídeo. Con 0 = sin rotación. Con 20° gira 20° de forma uniforme a lo largo de la duración del vídeo.
- **La cámara sigue el track** — la cámara permanece en el punto en movimiento en lugar de en toda la ruta.
  - **Inercia de la cámara** (aparece entonces) — seguimiento suave en vez de un pegado duro al punto (contra el temblor del GPS).
- **Exageración del terreno** 0–4× — lo pronunciadas que parecen las montañas

**Tiempo y tamaño:**
- **Duración de la animación** en segundos — cuánto tiempo se dibuja el track
- **Hold** en segundos — cuánto permanece la imagen final al terminar
- **Resolución**: 4K (3840×2160), 1080p, 4K↕ y 1080↕ (vertical para Shorts/Reels), o personalizada
- **FPS**: 24 (cine) · 25 (PAL/TV europea) · 30 (estándar) · 50 (PAL HFR) · 60
- **Códec**: H.264 (universalmente compatible) o H.265 (HEVC, ~30 % más pequeño)

**Rendimiento y salida (desde v0.4):**
- **Suavidad del track (densidad de puntos)** — lo fino que se dibuja el track:
  - **Baja** (100 puntos) — render más rápido, bueno para vista previa
  - **Media** (250 puntos) — valor por defecto recomendado
  - **Alta** (500 puntos) — curvas más finas con muchas eses
  - **Máxima** — todos los puntos originales del GPX (más lento, rara vez necesario)
  
  ℹ️ El tiempo de render depende **mucho más** de **duración × FPS × resolución** que del número de puntos. Si un render tarda demasiado: reduce primero FPS/resolución.

- **Animación sin mapa (canal alfa)** ⭐ **Para composición en editor de vídeo**:
  - Activa la casilla → renderiza **solo track + punto + overlays de estadísticas** sobre fondo transparente.
  - La salida es un archivo **`.mov`** (ProRes 4444 con canal alfa, más grande que un MP4 pero apto para NLE).
  - En **Premiere Pro, Final Cut Pro, DaVinci Resolve, CapCut Pro** puedes superponer este archivo directamente **sobre vídeo real** — el track aparece como overlay animado sobre tu material de dron, GoPro o vlog.
  - En este modo **no se requiere** un token de Mapbox (no se renderiza ningún mapa).
  - El estilo de mapa, el terreno, la inclinación y el códec se ignoran en el modo alfa.

**Posición manual del mapa (WYSIWYG):**
Puedes **desplazar** el mapa de la vista previa con el ratón (clic+arrastrar) y hacer **zoom** con la rueda de scroll. El render adopta tu posición 1:1 — lo que ves en la vista previa es lo que sale en el vídeo.

Cuando quieras volver a centrar el track: botón **⤢** abajo a la derecha.

### Camera-Keyframes (barra de línea de tiempo, desde v0.7) ⭐

> **Desde v0.8.16 es una función Pro opcional.** Por defecto en los proyectos nuevos: solo una casilla «🎥 Editor de keyframes» en la barra lateral. Solo al activarla: aparece la barra de línea de tiempo bajo el mapa, el editor de detalle se hace accesible en la barra lateral, se dibujan los pines en el mapa. Los proyectos existentes con keyframes se activan automáticamente.

Con la barra de línea de tiempo **bajo** la vista previa del mapa puedes diseñar el flujo de cámara de forma dinámica — fijando libremente inclinación, giro y zoom en cualquier punto del track. El motor interpola limpiamente entre los keyframes (igual que en Premiere o Final Cut).

**Estructura de la barra:**
- **Eje de tiempo 0–100 %** — duración total del render (animación **+** hold)
- Un **separador vertical naranja** marca el **final de la fase de animación**. A su izquierda corre el track, a su derecha está la fase de hold (el punto final del track permanece quieto, pero la cámara puede seguir interpolando).
- La **zona de hold** está rayada en naranja con la etiqueta «HOLD» encima
- Un **marcador 🎥** por cada keyframe fijado (con borde amarillo si está seleccionado). Los keyframes también se pueden colocar en la fase de hold — p. ej. «al final alejar el zoom hasta toda la ruta» mientras el track ya ha terminado.
- **Scrubber** (línea amarilla) — muestra la posición actual de la vista previa
- **Indicador de posición**: `Punto 234 / 1500 · 15.6 %` más un indicador de modo:
  - `🎥 en keyframe #2` — el editor de detalle en la barra lateral está activo
  - `libre (📍 = nuevo keyframe)` — el mapa se puede manipular libremente, sin modificar keyframes
  - `⏸ Hold` — el scrubber está en la fase de hold, el punto final del track permanece quieto

**Flujo de snapshot** (el núcleo):
1. Arrastra el mapa con el ratón como de costumbre, haz scroll para el zoom
2. **<kbd>Cmd</kbd> + arrastrar** (Mac) o **clic derecho + arrastrar** inclina el mapa (Pitch + Bearing a la vez)
3. Cuando el mapa esté como lo quieres → pulsa **«📍 Keyframe aquí»**
4. Posición, Pitch, Bearing y Zoom se fijan todos automáticamente
5. Repite para más puntos del track

**Modo libre vs. modo edición:**
- **Sobre un keyframe** (con el scrubber justo encima) → aparece el editor de detalle en la barra lateral con 4 sliders (Anchor, Pitch, Bearing, Zoom-Δ) para afinar. Las ediciones del mapa NO se adoptan automáticamente en el keyframe — para eso pulsa «📍 Keyframe aquí» otra vez (eso actualiza el existente) o el botón «Actualizar con la vista actual del mapa» en el editor.
- **Entre keyframes** → el editor desaparece. El mapa está **libre** — desplazar/zoom/cmd-arrastrar no modifica NINGÚN keyframe existente. «📍 Keyframe aquí» crea uno nuevo en esa posición.

**Ensayo:** el **botón ▶** reproduce todo el track en tu duración de animación real (o sea, si has configurado 12 s, el ensayo dura 12 s). Un segundo clic (o <kbd>Espacio</kbd>) lo detiene al instante. Es una función de vista previa pura, no hace falta renderizar.

**Navegación por teclado** (como en un NLE):
| Tecla | Acción |
|---|---|
| <kbd>←</kbd> / <kbd>→</kbd> | Un punto GPS adelante/atrás |
| <kbd>⇧</kbd> + <kbd>←</kbd>/<kbd>→</kbd> | Salto de 10 |
| <kbd>Inicio</kbd> / <kbd>Fin</kbd> | Inicio / final del track |
| <kbd>Espacio</kbd> | Iniciar/detener ensayo |
| <kbd>Supr</kbd> / <kbd>Retroceso</kbd> | Eliminar el keyframe seleccionado |

Solo funciona si ningún slider/campo tiene el foco en ese momento. Si acabas de mover un slider y las teclas de flecha no responden → haz clic una vez en el mapa.

**Eliminar un keyframe** se hace de 4 maneras:
1. **Editor de detalle** → botón «🗑 Eliminar este keyframe» abajo
2. **Clic derecho** sobre el marcador 🎥 en la barra o sobre el pin del mapa
3. Tecla <kbd>Supr</kbd>/<kbd>Retroceso</kbd> con el keyframe seleccionado
4. Botón «🗑 Eliminar todos» (quita TODOS → vuelta al comportamiento clásico)

**Anclaje en la línea de tiempo (desde v0.8.11):** los keyframes cuelgan de una **posición en la línea de tiempo completa** (animación + hold), en el rango 0..100 %. Con, p. ej., 12 s de animación + 5 s de hold, el final del track está en ~70,6 % — los keyframes anteriores corren con el track, los posteriores solo mueven la cámara (el punto final del track permanece quieto).

Con eso funciona, p. ej., **«al final alejar el zoom hasta toda la ruta»**: un keyframe al inicio hace zoom sobre el punto de partida, un keyframe al final del track vuelve al zoom normal, un keyframe al final del todo en la fase de hold aleja el zoom hasta toda la ruta → un outro cinematográfico.

**Vuelta al comportamiento clásico:** si no hay keyframes fijados, todo funciona como antes de v0.7 — pitch estático (del slider de la barra lateral) + barrido lineal de bearing (del slider de rotación). En cuanto fijas el primer keyframe, los dos sliders de la barra lateral reciben un aviso amarillo «⏱ Controlado por los keyframes de la línea de tiempo» y pasan a segundo plano visualmente. «🗑 Eliminar todos» los devuelve al control principal.

### Rotación del mundo — la Tierra gira de camino al track (desde v0.9.136) ⭐

Si al principio quieres mostrar **todo el globo terráqueo** y que gire una o varias veces al hacer zoom hacia el track, eso funciona ahora — igual que con la **Insta360** — directamente a través de la **longitud** de la posición del mapa. Ya no hay una pista separada de «rotación del mundo»; la rotación está en el propio valor de longitud.

**Cómo funciona:** cada keyframe tiene en el editor dos campos nuevos **Lon** (longitud) y **Lat** (latitud) — slider más campo numérico editable con clic, igual que Pitch/Giro/Zoom. La longitud está **desenrollada**: valores por encima de ±180° significan vueltas completas de la Tierra de camino desde el keyframe anterior.

- Longitud `10` y en el siguiente KF `370` → la Tierra da **una vuelta completa** y vuelve a aterrizar en la longitud 10.
- `10` → `730` → **dos vueltas completas**, luego aterrizaje en 10.
- `10` → `380` → una vuelta **más** 10° hacia el este.

**Flujo para «la Tierra gira, luego zoom hacia dentro»:**

1. **KF1 al principio** (anchor 0): zoom a ~0 (globo visible), Pitch=0. Opcionalmente el botón **Centrar el mundo** para valores por defecto sensatos.
2. **KF2 al final** (anchor 1): zoom a, p. ej., 14 (detalle del track), y la **longitud** en la longitud del track **más 360°** (una vuelta) o **+720°** (dos vueltas).

La Tierra gira uniformemente entre los dos KF y termina exactamente en el track — el vuelo de zoom/barrido se mantiene limpio (sin «vuelo salvaje»), porque las vueltas completas se calculan por separado de la curva de vuelo.

**Al arrastrar el mapa, el valor cuenta automáticamente hacia arriba:** si giras la Tierra con el ratón más allá de la línea de cambio de fecha, la longitud no salta de vuelta a −180°, sino que sigue contando (181°, 182°, … 370°, …). Da simplemente tantas vueltas como quieras y luego pulsa el botón de snapshot — el valor se adopta con todas las vueltas.

**Trucos de slider:**
- **Hacer clic en la etiqueta Lon** → teclea el número directamente en lugar de arrastrar el slider
- También se permiten valores **fuera del rango del slider** (p. ej. `1090` para 3 vueltas)
- La etiqueta Lon muestra automáticamente el **contador de vueltas**: `370° (1↻)`, `730° (2↻)`
- Funciona igual para todos los demás sliders de KF (Pitch, Bearing, Zoom, Lat)

> **Nota para proyectos antiguos:** los proyectos de versiones anteriores con la vieja pista de «rotación del mundo» siguen cargándose, pero la vieja pista de rotación se ignora. Vuelve a fijar la rotación si es necesario a través de la longitud.

### Limitar la zona de render — tiradores de trim (desde v0.9.41) ⭐
A veces quieres renderizar solo un **tramo del track** en lugar de todo el recorrido. Ejemplo: una ruta de 30 km, pero quieres solo la sección de montaña como vídeo.

En la barra de línea de tiempo encuentras **dos deslizadores** con tirador gris — el tirador de trim izquierdo y el derecho. Arrástralos hacia dentro para acortar la zona de render. La zona seleccionada queda resaltada en naranja claro; las zonas atenuadas permanecen a la izquierda/derecha.

- **Tirador de trim izquierdo** = dónde arranca el track del render
- **Tirador de trim derecho** = dónde termina el track del render
- Los **keyframes fuera** siguen siendo visibles (discretos), actúan como configuración de «impulso»: la interpolación de cámara pasa por ellos, pero el propio marcador del track solo arranca en el tirador izquierdo
- El **ensayo + render** reproducen solo la zona recortada (la longitud de la salida del render sigue siendo la misma, porque la duración de la animación es fija)

### Intro / Animación / Hold (desde v0.9.59) ⭐
Tres campos de entrada en el bloque «Tiempo y tamaño» controlan cuánto dura tu vídeo de render:

| Campo | Qué ocurre |
|---|---|
| **Intro** | Segundos ANTES de que el track arranque. El marcador está en el tirador de trim izquierdo, los keyframes de cámara corren → para planos de configuración (p. ej. globo → zoom al inicio de la ruta) |
| **Animación** | Segundos en los que se recorre el track |
| **Hold** | Segundos DESPUÉS del final del track. El marcador está en el tirador de trim derecho, los keyframes de cámara corren → para el outro (p. ej. «alejar el zoom hasta toda la ruta») |

La **línea de tiempo lo visualiza** en tres zonas:
- 🔵 **Región INTRO azul claro** a la izquierda (visible si intro > 0)
- ⚪ **Región de animación** en el centro (entre los tiradores de trim)
- 🟠 **Región HOLD naranja** a la derecha (visible si hold > 0)

Valores por defecto: Intro 0 / Animación 12 / Hold 5. En total, pues, 17 segundos de vídeo de salida.

### Mostrar el track antes del inicio del trim (desde v0.9.55) ⭐
Si renderizas solo una parte del track, puedes elegir si la **línea del track previa** permanece visible (como línea de fondo tenue para orientación) o si la línea empieza recién en el tirador de trim izquierdo. Casilla en el modal de ajustes de overlay («🧭 Estadísticas de la zona de trim» / «🧭 Mostrar el track antes del inicio del trim»). Por defecto activada.

### Vista previa en directo del render
Durante el render ves el fotograma que se está generando en ese momento en la ventana de vista previa. Si la combinación de estilo y ángulo de cámara no te convence: haz clic en **«⨯ Cancelar»** — entonces el archivo a medias se elimina de inmediato y puedes reconfigurar sin haber esperado 5 min a un render que luego no vale.

### 📷 Fotos en el mapa (desde v0.9.74) ⭐

Las fotos con EXIF GPS aparecen como pequeñas miniaturas en su posición de captura. Perfecto para vlogs de viaje: el track corre a lo largo, y los puntos de foto son visibles como polaroids en el mapa.

**Flujo de trabajo:**

1. **Elegir la fuente de fotos:**
   - **«Elegir carpeta»** → selector de carpetas nativo. La app escanea todas las fotos de la carpeta (JPEG/HEIC/RAW).
   - **Arrastrar y soltar** en el panel «📷 Fotos» (varios archivos o una carpeta).
   - **«Adoptar del Geotagger»** — si has pasado antes las fotos por el módulo Geotagger (con tags GPS recién escritos), la lista viene con un clic.

2. **Qué ocurre:** las fotos con GPS aterrizan como miniatura en el mapa. Las fotos sin GPS se omiten — recibes un aviso «X de Y fotos cargadas, Z omitidas».

3. **Ajustar el tamaño:** el slider **Tamaño** (24–80 px) regula lo grandes que aparecen las miniaturas en el mapa. Actúa de inmediato en directo en la vista previa y en el render final.

4. La casilla **«Mostrar en el mapa»** oculta todos los pines sin borrar la lista — práctico si solo los quieres para el Tour-Map y no en el vídeo del Animator.

5. **«🗑 Eliminar todas»** vacía por completo la lista del proyecto actual.

**Lista en la barra lateral:** muestra cada foto con miniatura + nombre de archivo + coordenadas. Al hacer clic, el mapa vuela hasta la foto.

**Compartido entre Animator y Tour-Map:** la lista de fotos reside a nivel de proyecto. Lo que cargues en el Animator está también de inmediato en el Tour-Map (y viceversa). El tamaño es independiente por módulo — el vídeo puede tener pines más pequeños que el mapa de impresión.

**Persistencia:** las rutas + coordenadas GPS se guardan en el proyecto. En la siguiente apertura, las miniaturas se generan automáticamente de nuevo (caché en disco, por eso es rápido). Si entretanto has movido o eliminado un archivo de foto, este cae en silencio de la lista — sin ningún crash.

**En el render:** los pines de foto aparecen **en cuanto el marcador animado alcanza su posición** (desde v0.9.187 — antes eran visibles por error desde el primer fotograma) y permanecen luego hasta el final. La posición es exactamente la posición EXIF GPS (aunque no esté sobre el track, p. ej. una foto de cumbre junto al sendero).

---

## 4 · Módulo: Ruta de viaje — la llegada como vídeo 🛣️ (desde v0.9.205)

### Qué hace
Anima la **llegada** a una ruta: indicas origen y destino, a partir de ahí se calcula un trayecto y se anima como un track — p. ej. como intro antes del vídeo de senderismo propiamente dicho. El GPX cargado (la caminata) se muestra mientras tanto como **ghost** en el fondo.

Ruta de viaje es un **clon de pleno derecho del Animator**: todo lo que se puede hacer allí (estilo de mapa, keyframes, carteles, opciones de render) se puede hacer aquí igual — solo que en lugar de un GPX se anima la ruta calculada. Ajustes propios y carteles propios (independientes del Animator).

### Flujo de trabajo
1. **Cargar GPX** (la caminata) — como de costumbre a través de la barra GPX. En la pestaña de Ruta de viaje aparece automáticamente como **ghost** (línea tenue).
2. Zona **«🛫 Ruta / Llegada»**: elegir el **estilo** — **🛣️ Seguir carretera** (ruta de Mapbox) o **✈️ Ruta aérea (círculo máximo)** (el camino más corto sobre el globo, como los vuelos reales — se curva en el mapa hacia los polos).
3. Indicar las **estaciones** — **origen, tantos puntos intermedios como quieras y destino**. Teclea cada estación como **dirección/lugar** (p. ej. «Dresden Hauptbahnhof»), fíjala con **📍 clic en el mapa**, o como `lat,lon`. **«➕ Punto intermedio»** inserta una estación antes del destino; **✕** elimina una. Con **«📍 Modo de clic»** simplemente haces clic en las estaciones **una tras otra en el mapa** — cada clic aparece como una nueva estación en la lista (Esc finaliza). Práctico cuando el trayecto real (p. ej. un ferry) no sigue el camino directo.
4. Con «Seguir carretera»: **medio de transporte** (coche/pie/bici) + slider de **nivel de detalle** (fino → grueso). Grueso crea una línea deliberadamente **curvada y simplificada** que se orienta de forma laxa por la ruta (no tan detallada como una caminata real). La animación se mantiene siempre fluida.
5. **«Calcular ruta»** → el trayecto se carga como track animado, la caminata permanece como ghost detrás. La distancia + el tiempo de viaje figuran debajo del botón.
6. Sigue como en el Animator: ensayo, cámara, carteles, **renderizar vídeo**.

> **El nivel de detalle solo actúa en el siguiente «Calcular ruta»** — mueve el slider, luego recalcula.

### Configurar el GPX-Ghost
Zona **«👻 GPX-Ghost»**: mostrar sí/no, **color**, **opacidad**, **grosor de línea**, **discontinua**. Actúa en directo en la vista previa y en el vídeo renderizado. (En el módulo Ruta de viaje, los overlays de estadísticas están ocultos para esto.)

### Qué se guarda
Todas las estaciones (origen, puntos intermedios, destino), estilo, nivel de detalle, perfil **y la última ruta calculada** se guardan en el proyecto — tras un reinicio todo vuelve a estar ahí (la ruta aparece sin volver a calcular).

### Necesita un token de Mapbox
Las rutas por carretera + la búsqueda de direcciones funcionan a través de Mapbox (el mismo token que el mapa, ver Primeros pasos). La ruta aérea (círculo máximo) no necesita ninguna llamada a la API.

## 5 · Módulo: Tour-Map — PNG de mapa estático

### Qué hace
Como el Animator, pero **una única imagen en lugar de un vídeo**. Salida: PNG en cualquier resolución. Usos: miniaturas de YouTube, publicaciones de Instagram, portadas de blog, imágenes para galerías de Komoot.

El Tour-Map es **la misma interfaz que el Animator** — solo que en **modo imagen fija**: todo lo que solo tiene sentido para un vídeo en movimiento (línea de tiempo, keyframes, estadísticas en directo, trim, vuelo de cámara, FPS/duración) está oculto. Lo que ves en el mapa es **exactamente** el PNG renderizado (WYSIWYG).

### Flujo de trabajo
1. **Cargar GPX** (igual que en el Animator)
2. **Elegir formato**: YouTube 16:9 (1920×1080) · 4K · Shorts 9:16 (1080×1920) · Instagram 1:1 (1080×1080) · o personalizado
3. **Estilo + cámara** como en el Animator — estilo de mapa, aspecto de la línea, inclinación, nivel de zoom, carteles/fotos
4. **Afinar el encuadre** con los reguladores de cámara (ver más abajo) o directamente con desplazar/zoom en el mapa
5. **«🗺 Renderizar el mapa como PNG»** → diálogo de guardado → el PNG está listo en 3-5 segundos

### Reguladores de cámara en modo imagen fija (desde v0.9.310)
En la sección **Cámara** hay tres reguladores que solo aparecen en el modo imagen fija — todos actúan **de inmediato en directo en la vista previa**:
- **Orientación** (−180…180°) — gira el mapa (qué dirección de la brújula queda arriba)
- **Margen** (0–30 %) — cuánto aire queda entre el track y el borde de la imagen
- **Marca de inicio/destino** (sí/no) — dos puntos: **inicio en blanco** con borde del color del track, **destino en el color del track** con borde blanco

Además, como en el Animator: **inclinación** (Pitch) y **nivel de zoom**. La sección **«Ajustes de imagen»** solo contiene ya la resolución.

### Vista de resultado
Tras el render: imagen de vista previa grande, «Mostrar en el Finder», «Copiar ruta», «Nuevo mapa».

### Elegir el estilo de mapa — también OpenStreetMap (desde v0.9.406) ⭐
En el desplegable de **estilo de mapa**, en el módulo Tour-Map están disponibles, además de los estilos de Mapbox (Satélite, Streets…), cuatro **estilos de OpenStreetMap**: **OSM estándar, OpenTopoMap, CyclOSM, Humanitarian** — y ello **también cuando tienes un token de Mapbox guardado**. Si eliges un estilo OSM, la vista previa lo muestra de inmediato. *(Los estilos OSM no necesitan token.)*

> **¿Un mapa interactivo para la web?** El Tour-Map genera una **imagen fija (PNG)**. Si necesitas un **mapa con zoom/desplazable para tu blog**, usa el módulo propio **«🌐 Mapa web»** (desde v0.9.422) — consulta la [sección 5c](#5c--módulo-mapa-web).

---

## 5c · Módulo: Mapa web 🌐 — mapa interactivo para el blog (desde v0.9.422) ⭐

### Qué hace
Una pestaña propia, deliberadamente **ligera**, para **mapas interactivos para la web/blog** — completamente separada del Tour-Map. El track se dibuja automáticamente a partir del GPX cargado, y encima colocas **etiquetas de texto directamente sobre el mapa**. El resultado es un archivo HTML ligero y autónomo (~40 KB) con un mapa de OpenStreetMap sin token — para hacer zoom y desplazar en el navegador, como los mapas incrustados en las entradas del blog de Reisezoom. La vista previa en la app es **exactamente** la exportación.

*(Si en su lugar quieres una imagen fija de alta calidad con satélite/3D/carteles/fotos, usa el [Tour-Map](#5--módulo-tour-map).)*

### Flujo de trabajo
1. **Cargar GPX** (barra GPX global arriba). El track aparece de inmediato y se encaja.
2. **Color/grosor del track** y **estilo de mapa** se ajustan a la izquierda.
3. **Colocar etiquetas:** haz clic en **«＋ Añadir etiqueta»** → toca en el mapa. En la **lista de etiquetas** de debajo ajustas por cada entrada **texto, color y tamaño** y la eliminas con 🗑. En el mapa, cada etiqueta se puede **arrastrar** (desplazar); un clic sobre ella salta a la fila correspondiente en la lista. El color del texto (claro/oscuro) se elige automáticamente acorde al color escogido.
4. Opcionalmente activa el **botón RGPD** (ver más abajo).
5. **«🌐 Exportar como HTML»** → ventana con las opciones de salida.

### Varios tracks (desde v0.9.432) ⭐
Puedes mostrar varios tracks GPX en **un** mapa — p. ej. varias etapas de una ruta o los tramos de ida y vuelta. El **primer track viene del GPX cargado** (barra GPX global). Los demás los añades en la sección de la barra lateral **«Más tracks»** con **«＋ Añadir track»** y eliges un GPX por archivo. Para cada track ajustas **nombre, color, grosor** y **pines de inicio/fin**; lo quitas de nuevo con 🗑. El mapa se ajusta automáticamente a **todos** los tracks juntos, y la vista previa es, como siempre, **exactamente** la exportación.

### Botón RGPD (opcional)
Con la casilla **«Botón de consentimiento RGPD»**, el mapa recibe una capa de consentimiento previa — las teselas externas del mapa (y con ellas la transmisión de la IP a OpenStreetMap) se cargan **solo tras el clic**. El texto de consentimiento y la etiqueta del botón son libremente editables y vienen prellenados de forma sensata. Detrás del texto hay una **imagen de vista previa difuminada de tu mapa**, que está **incrustada de forma fija en el HTML** (sin recarga externa) — así el gate no parece vacío y sigue siendo conforme al RGPD. *(La exportación con el consentimiento activo tarda unos segundos más, porque para ello el mapa se renderiza una vez.)*

### Fuente de Leaflet (desde v0.9.430)
En la zona de exportación eliges **de dónde carga Leaflet el mapa incrustado**:
- **CDN (unpkg)** — estándar, archivo más pequeño; Leaflet viene del CDN público (con el botón RGPD activo, solo tras «Cargar mapa»).
- **Autoalojado (URL)** — indicas una URL base (p. ej. `https://tublog.es/leaflet/`); el HTML carga `leaflet.css` + `leaflet.js` desde ahí. Tú mismo colocas ambos archivos en tu servidor.
- **Incrustar en el HTML** — Leaflet se escribe por completo en el archivo: **ninguna consulta externa** (limpio de RGPD, funciona offline), el archivo crece ~160 KB.

### Tras la exportación
- **▶ Abrir en el navegador** — muestra el mapa de inmediato en el navegador estándar. *(Un doble clic en el archivo abre, según el sistema, solo un editor — por eso usa este botón.)*
- **Copiar snippet (sin subida):** un **snippet `<iframe>`** listo para un **bloque «HTML personalizado»** de WordPress. Todo el mapa está en el snippet (`srcdoc`) — sin necesidad de subir un archivo aparte.
- **Mostrar en el Finder:** encuentra el `.html` en el disco para subirlo a tu propio servidor.

**Deliberadamente minimalista:** solo track + etiquetas de texto. Sin fotos, sin gráficos de carteles, sin 3D/overlay — esta es la exportación ligera de «mapa de blog».

---

## 5b · Módulo: Animador de datos — mediciones como vídeo 📊

> **Novedad en v0.9.437:** este módulo se llamaba antes **Animator de altitud** y solo podía con la altitud. Ahora anima **cualquier serie de datos de tu track** — de ahí el nuevo nombre. Tus proyectos existentes siguen funcionando igual y arrancan con la altitud, como siempre.

### Qué hace
Construye a partir de tu track un **vídeo en el que una curva de medición se va formando en directo** — un marcador que corre muestra el valor actual y la distancia. Ideal como rótulo en el montaje (también con **fondo transparente** vía ProRes-4444-alfa).

### Elegir la serie de datos (desde v0.9.437) ⭐
Arriba del todo en la barra lateral está **«Serie de datos»**. Ahí eliges qué se anima:
- **Siempre disponibles:** **altitud**, **velocidad** y **pendiente** — la app las deduce del propio track.
- **De archivos FIT/TCX** (p. ej. Garmin, Wahoo, Suunto): **frecuencia cardíaca**, **cadencia**, **potencia**, **temperatura** y otros valores de sensor.

La lista solo ofrece **lo que tu track realmente contiene**. Si cargas un GPX sencillo sin datos de sensor, quedan altitud/velocidad/pendiente. Las etiquetas del eje, el marcador y la barra de información adoptan el nombre y la unidad automáticamente — con el pulso pone «139 bpm» en vez de «1240 m».

Dos indicaciones son propias de la altitud y solo aparecen en la serie **Altitud**: el icono de montaña ⛰ y todo lo relativo al **desnivel y la pendiente**. En pulso o potencia no tendrían sentido, así que se ocultan.

### Dos series a la vez (desde v0.9.438) ⭐
Justo bajo el primer selector está **«Segunda serie de datos (eje derecho)»**. Si eliges algo ahí, corren **dos curvas a la vez** — lo clásico: **altitud a la izquierda, pulso a la derecha**.

La segunda serie recibe **su propio eje en el borde derecho**, autoescalado a su rango de valores. Va rotulado en el color de línea de la segunda curva, para que quede claro qué eje corresponde a qué curva — el color y el grosor se ajustan al lado. El marcador muestra ambos valores.

Los ejes separados son intencionados: la altitud (m) y el pulso (bpm) no comparten rango — en un solo eje, una de las dos curvas quedaría como una línea plana. La segunda curva se dibuja **solo como línea** (sin área ni zonas de color), porque dos áreas rellenas superpuestas serían ilegibles. Sin segunda serie, todo queda como antes.

### Flujo de trabajo
1. Cargar GPX/FIT/TCX (barra GPX global arriba). La vista previa se reproduce de inmediato.
2. Elegir la **serie de datos** (por defecto: altitud).
3. Ajustar aspecto, barra de información y puntos (ver más abajo). Todo funciona **WYSIWYG** en la vista previa.
4. Con los **tiradores de trim** bajo la curva, delimita la zona animada (opcional).
5. **▶ Renderizar vídeo** — elige códec/alfa, el progreso corre a la par.

### Barra de información objetiva (desde v0.9.394) ⭐
Sobre el perfil muestras una **barra de valores** — en la sección **«Barra de información»** activable/desactivable y seleccionable por campo: **distancia, metros de desnivel ↑/↓, Ø pendiente, pendiente máx. (↑/↓), altitud (máx/mín/Ø)**. Además, el **callout del marcador** muestra la **pendiente actual** (p. ej. «↗ +6.2 %» / «↘ −4.7 %») junto a altitud y distancia — desactivable con «Mostrar pendiente % en el marcador».

### Puntos en el recorrido (desde v0.9.394) ⭐
En la sección **«Puntos en el recorrido»** colocas marcadores etiquetados en el perfil — de cuatro fuentes, activables por separado:
- **Colocar tú mismo:** haz clic en **«Colocar punto en el perfil»**, luego clic en la curva. Introduce el nombre, elige color, y luego renombra o elimina.
- **De las fotos:** las fotos ubicadas en el proyecto aparecen en su posición del track (nombre = nombre de archivo).
- **Waypoints GPX:** los POI `<wpt>` del archivo GPX (p. ej. de Komoot/Garmin) se adoptan.
- **Marcadores automáticos:** el punto más alto/más bajo, así como el ascenso y el descenso más empinados, se detectan y etiquetan automáticamente.

Cada punto **aparece animado en cuanto la línea lo alcanza**. Puedes ocultar/mostrar puntos individuales de una fuente en la lista con 👁. Tus puntos manuales + todos los ajustes se guardan **por proyecto**.

**Ejes totalmente configurables (desde v0.9.447):** debajo del interruptor «Mostrar etiquetas de ejes» hay ahora un bloque de detalle. Allí activas o desactivas por separado el **eje X**, el **eje Y izquierdo** y el **eje Y derecho** (segunda serie de datos), eliges el **tamaño de fuente** (8–60 px) y defines **cuántos valores** se etiquetan por eje (1–12). Si un eje está desactivado, su margen se reduce al mínimo y la curva gana ese espacio. El interruptor principal de arriba sigue apagándolo todo de una vez.

**Colores (desde v0.9.395):** en la sección «Aspecto» eliges ahora, además del fondo y el color de línea, también el **color de la cuadrícula** (rejilla auxiliar) y el **color de las etiquetas** (ejes, barra de información, callout del marcador).

**Suavizado (desde v0.9.400):** el regulador **«Suavizado»** en la sección de aspecto (0–20) hace más suaves los perfiles dentados — útil en tracks con muchos puntos GPS y pequeños saltos de altitud. Aplica una media móvil sobre los datos de altitud; 0 = datos en bruto, valores más altos = más suave. El suavizado actúa WYSIWYG sobre todo: línea, área, barra de información, la pendiente en el marcador y las altitudes de los puntos — igual en la vista previa, el render de vídeo y la exportación HTML.

**Área bajo la línea (desde v0.9.402):** en la sección **«Área bajo la línea»** determinas **si** el área bajo la curva se rellena, con qué **color de relleno** y con qué **opacidad** (0–100 %).
Debajo puedes crear **zonas de color por altitud**: con «**Añadir altitud**» defines una altitud (en metros) más un color — **a partir de esa altitud** cambia el color de relleno. Así surge el clásico aspecto de mapa de relieve (p. ej. verde en el valle, marrón en cotas medias, blanco en la cumbre). Por debajo de la zona más baja rige el color de relleno normal. Con **transición de color** eliges entre **degradado suave** (los colores se funden entre sí) y **bandas duras** (el color salta en cada altitud). Sin zonas se usa simplemente el color de relleno para toda el área.

**Crear niveles de altitud automáticamente (desde v0.9.403):** en lugar de fijar cada zona a mano, indicas en **«Número de niveles»** una cifra (p. ej. 4) y haces clic en **«Crear niveles»** — el rango de altitud de tu track se divide entonces automáticamente en tantos niveles iguales y se rellena con una rampa de color de terreno (verde → marrón → blanco). Los niveles generados los puedes seguir editando después con toda normalidad (cambiar altitud/color, eliminar, añadir).

**Niveles de altitud para el fondo y la línea (desde v0.9.403):** las mismas zonas de color por altitud existen además en las secciones **«Niveles de altitud del fondo»** y **«Niveles de altitud de la línea»**. Con ellas coloreas el **fondo** o la **línea de altitud** según la altitud — en cada caso con el mismo generador, editor de zonas e interruptor suave/duro. El color base es el color de base respectivo de la sección de aspecto («Fondo» o «Color de línea»).

**Punto y caja de información separados (desde v0.9.405):** en la sección «Marcador» hay dos interruptores independientes: **«Mostrar punto (dibuja la línea)»** controla el punto en movimiento en la punta de la animación, **«Mostrar caja de información»** controla la caja de información a su lado. Con eso puedes, p. ej., desactivar por completo la caja de información y conservar aun así el punto (o al revés). El color y el tamaño del punto de arriba se aplican al punto.

**Fondo solo en el diagrama (desde v0.9.404):** en la sección «Niveles de altitud del fondo» está la casilla **«Solo en la zona del diagrama (dentro de los ejes)»**. Si está activa, el degradado de color por altitud del fondo se dibuja solo **dentro del marco de los ejes** (exactamente donde están la línea de altitud y el área) — el margen alrededor conserva el color de fondo normal. Sin la marca, el degradado colorea como hasta ahora toda la imagen.

**Configurar el marcador (desde v0.9.396):** la sección propia **«Marcador»** hace el punto en movimiento y su caja de información completamente personalizables: **color + tamaño del punto**; para la caja, **color de fondo + opacidad, color y grosor del borde, tamaño de fuente**; y qué valores figuran dentro — **símbolo ⛰, altitud, pendiente (%), distancia** activables/desactivables individualmente (la caja adapta su tamaño automáticamente).

**Deshacer:** **⌘Z / Ctrl+Z** revierte **todo** en el Animador de datos — aspecto, colores, campos de la barra de información, waypoints e interruptores de fuente (una pulsación por paso).

**Exportar como HTML (blog/web, desde v0.9.397):** bajo el botón de render de vídeo está **«Exportar como HTML»**. Eso genera un archivo **`.html` que se ejecuta por sí solo** — la misma animación que en el vídeo, pero corre **completamente en el navegador** (HTML puro, sin vídeo), con auto-loop y un botón de repetición **«↻»**. Ideal para una entrada de blog. Tras la exportación se abre una **ventana en el centro de la pantalla** con estas opciones:
- **▶ Abrir en el navegador** — muestra la animación terminada de inmediato en el navegador estándar. *(Un doble clic en el archivo en el Finder inicia, según el sistema, solo un editor — entonces solo ves código fuente; por eso usa este botón.)*
- **Copiar snippet (sin subida):** un **snippet `<iframe>`** listo — insértalo en un **bloque «HTML personalizado»** de WordPress. Toda la animación está en el snippet (`srcdoc`), limpiamente aislada del tema.
- **Mostrar en el Finder:** encuentra el `.html` en el disco; súbelo a tu servidor e incrústalo con `<iframe src="…">`.
No hace falta plugin de WordPress; sin Mapbox/CDN — el archivo funciona de forma autónoma.

**Los ajustes se conservan (desde v0.9.399):** colores, ajustes de marcador, resolución, duración, etc. se guardan **por proyecto** y se restauran en la siguiente apertura.

---

## 6 · Módulo: Geotagger — etiquetar fotos con GPS

> **El Geotagger existe desde v0.9.331 en tres variantes:**
> 1. **En GPS Studio** (este módulo) — junto con Animator, Tour-Map y compañía.
> 2. **Como app en solitario propia «Reisezoom Geotagger»** — ligera, solo para el etiquetado de fotos, con **mapa de OpenStreetMap sin token de Mapbox** (sin el tema de la tarjeta de crédito). Ideal si *solo* quieres ubicar fotos.
> 3. **Como herramienta web en el navegador** — etiqueta fotos **JPEG** de forma completamente local (nada se sube), sin instalación. Para RAW/HEIC/vídeo necesitas la app de escritorio.
>
> Las tres usan la misma lógica. Los siguientes pasos del flujo de trabajo valen para las variantes de escritorio (1 + 2).

### Qué hace
Lee la hora de captura de los datos EXIF de cada foto y busca en el track GPX el punto del track que le corresponde. Escribe las coordenadas GPS como tag EXIF en la foto. **Funciona con JPG, RAW (CR3/NEF/ARW/RAF/RW2/ORF/DNG/PEF/RWL/SRW/HEIC) y vídeo (MP4/MOV/INSV)** (herramienta web: solo JPG).

### Flujo de trabajo
1. **Cargar GPX** — el mapa muestra el track
2. **Seleccionar fotos** — o bien «📁 Seleccionar fotos», «📁 Cargar carpeta entera», o arrastrar y soltar
3. Los **mosaicos de foto** aparecen en el centro con miniaturas. Los marcadores en el mapa muestran dónde se ha asignado cada foto en función de la hora de captura. **Arrastrar más fotos o cargar otra carpeta amplía la lista** (desde v0.9.176 — se *añade*, no se reemplaza; los duplicados se omiten). Para vaciar, usa **«🗑 Eliminar todas»**.
4. **Comprobar el offset** (ver «Zonas horarias» más abajo) — normalmente cuadra directamente
5. **«Escribir GPS en las fotos»** → **elegir carpeta de destino** → las **copias** ya etiquetadas aterrizan ahí, tus **originales quedan intactos** → listo, la carpeta se abre

### Así se guardan las fotos etiquetadas (desde v0.9.372)
- **Tus originales nunca se tocan.** Al escribir eliges **una vez una carpeta de destino**; ahí la app escribe las **copias** ya etiquetadas. Los originales quedan así conservados como respaldo — ya no hay un ZIP de backup aparte (innecesario).
- **Un flujo unificado**, tanto si has cargado las fotos con **arrastrar y soltar** como con **«Elegir carpeta»**: siempre surge una carpeta limpia con las imágenes etiquetadas. El diálogo de finalización muestra **«Guardado en …»** + **«Abrir carpeta»**.
- **¿Etiquetar los originales directamente?** Simplemente elige como destino la **carpeta de tus originales**. Entonces la app pregunta **«¿Sobrescribir realmente los originales aquí? (sin backup)»** — si lo confirmas, se etiqueta in situ. Sin confirmación, la app **nunca** sobrescribe un original.

### La magia de las zonas horarias
La app lee el tag EXIF `OffsetTimeOriginal` de cada foto y convierte la hora de captura a UTC. Con eso, el track cuadra en el 95 % de los casos **de fábrica**, sin que tengas que ajustar el offset manualmente.

Si aun así no (p. ej. porque el reloj de la cámara estaba mal):
- **Slider de offset** en el panel izquierdo — ±2h por defecto, con opciones desplegables de ±3 / ±6 / ±12h
- **Fijar foto de referencia** — clic en un mosaico de foto, luego clic en el mapa sobre la posición de captura real. La app calcula el offset por sí misma.
- **Elegir la zona horaria de la cámara** (✎ → «Introducir offset exacto») — algunas cámaras (muchas Olympus/OM, GoPro) **no** guardan ninguna zona horaria en la foto. Si viajas, p. ej., a Vietnam (UTC+7), las imágenes quedan entonces 7 horas desplazadas respecto al track. En el diálogo de offset ajusta simplemente la **zona horaria del reloj de la cámara** — una vez fijada, todo cuadra. Las fotos que han guardado su zona horaria por sí mismas (móviles, etc.) quedan intactas, así que puedes etiquetar sin problema fotos de móvil y de cámara del mismo viaje juntas. La zona horaria activa figura bajo el valor de offset.
- **Offset por cámara (desde v0.9.354)** — si etiquetas fotos de **dos cámaras a la vez** y solo una tiene el reloj mal, puedes dar a cada cámara su propio desfase:
  1. Arriba en la vista general, haz clic en el **botón de cámara** de la cámara afectada (filtra solo sus fotos).
  2. Ahora el **slider de offset** y la **imagen de referencia** valen solo para esa cámara. Ajusta el desfase (slider o foto de referencia).
  3. Si hace falta, filtra a la segunda cámara y ajústala ahí por separado.
  4. Vuelve a poner el filtro en **«Todas»** — ambas cámaras conservan su propio offset.
  El botón de cada cámara muestra su offset fijado como una pequeña insignia (p. ej. `📷 OM-3 +1h`). Sin filtro de cámara («Todas») ajustas el **estándar global**, que vale para todas las cámaras sin offset propio. Los offsets por cámara quedan guardados y actúan también en la corrección opcional de la hora de captura.

### Opciones
- **No hace falta backup** (desde v0.9.372) — los originales nunca se tocan (las copias etiquetadas aterrizan en la carpeta de destino elegida), por eso ya no hay una casilla de backup.
- **Cuando una foto ya tiene datos** (desde v0.9.339) — tres modos:
  - **Conservar, solo completar lo que falta** (por defecto): el GPS existente queda intacto, solo se completa lo que falta (p. ej. dirección, orientación de la vista). Ideal para lotes mixtos (fotos de móvil con GPS propio + fotos de cámara sin él). **Una ubicación guardada en la foto tiene aquí prioridad sobre la asignación por tiempo** — una foto que ya tiene «Oporto» como GPS se ubica en Oporto, no en el punto del track alcanzado por la hora.
  - **Sobrescribir todo**: reemplaza también los datos existentes por los valores del track.
  - **Omitir por completo las fotos con GPS**: no toca las fotos con GPS propio.
- **Ajustar también la hora de captura de la foto con el offset** (por defecto desactivado)

### Orientación de la vista del Reisezoom Logger 🧭 (desde v0.9.336)
Si tu track GPX se grabó con la app **Reisezoom Logger** (Android), contiene por cada punto la **orientación real de la cámara** (brújula, norte verdadero). El Geotagger la escribe como **GPSImgDirection** en la foto — así, p. ej., Lightroom o Apple Fotos saben después en qué dirección fotografiaste (una flecha en el mapa).

- Cada mosaico de foto muestra un **chip 🧭** con la dirección y la fuente:
  - **(Cámara)** — la foto ya tenía la dirección guardada por sí misma (cámara con brújula) → queda intacta
  - **(registrada)** — adoptada del Reisezoom Logger → se escribe en la foto
  - **(movimiento)** — estimada de forma aproximada a partir de la dirección de movimiento → **no** se escribe en la foto (solo se muestra como indicación)
- No tienes que ajustar nada: si hay una dirección registrada, se escribe automáticamente junto con el «Escribir GPS en las fotos» normal.
- Funciona igual en el **Geotagger del Studio y en el Solo**.

### Fijar tú mismo la dirección de captura — brújula del mapa 🧭 (desde v0.9.337)
Puedes determinar la orientación de la vista de cada foto **directamente en el mapa**:
- **Selecciona una foto** → aparece en el mapa una **brújula** con la miniatura de la foto en el centro.
- **Arrastra el anillo** para girar la dirección (marcas N/E/S/O + indicación en grados) — así fijas hacia dónde apuntaba la cámara.
- La **✕ roja** desactiva la dirección si no la conoces (entonces no se escribe ninguna orientación de la vista en la foto).
- Si ya hay una dirección (de la cámara o del Reisezoom Logger), se **muestra** y es corregible.
- Las direcciones fijadas manualmente se escriben al etiquetar como **GPSImgDirection** (el chip muestra «(manual)»).

### Varias fotos en el mismo punto — desplegar en abanico (desde v0.9.347)
Si dos o más fotos tienen (casi) exactamente la misma posición, sus pines en el mapa quedan uno encima de otro y al hacer clic solo aciertas el de más arriba. **Haz simplemente clic en el pin** — **despliega las fotos en abanico circular** (con pequeñas líneas guía), luego haces clic en la deseada por separado. Al seleccionar se cierra de nuevo automáticamente; un clic en el mapa vacío o mover/hacer zoom también lo cierra. (Alternativamente, llegas a cada foto también a través de la **lista de la izquierda** + las teclas de flecha ↑/↓.)

### Ver los detalles de la foto — pestañas EXIF (desde v0.9.341)
Al hacer clic en una foto (en la lista o en el pin del mapa) se abre a la derecha el panel de vista previa con dos pestañas:
- **Info** — hora de captura, coordenadas, dirección y los chips del sello de luz, **más los datos de cámara más importantes**: cámara, objetivo, distancia focal (con equivalente a formato completo, si está disponible), ISO, tiempo de exposición, apertura, corrección de exposición y flash.
- **EXIF** — la lista **completa** de todos los campos de metadatos guardados en la foto (todo lo que ExifTool puede leer), para desplazarse. Los campos de vista previa/binarios están ocultos.

**Editar campos directamente (desde v0.9.343, agrupados desde v0.9.344):** en la **pestaña EXIF** puedes **hacer clic en cualquier valor y cambiarlo** — la entrada se abre en línea, **Enter** (o ✓) lo adopta, **Esc** (o ✕) cancela. Vaciar el campo = el tag se elimina. Los campos atenuados (nombre de archivo, tamaño de archivo, dimensiones de imagen, versión de ExifTool…) **no** son editables por razones del sistema, porque ExifTool no los escribe. Consejo: cámara, objetivo, ISO, apertura, etc. los encuentras como tags editables individualmente (`Make`, `Model`, `LensModel`, `ISO`, `FNumber`, `ExposureTime`) en la pestaña EXIF.

**¿Cuándo se guarda?** Tus cambios **no se escriben de inmediato** en la foto, sino que se recopilan como **pendientes** (marcados en amarillo, con una línea de aviso + «descartar») — además aparece arriba, sobre las fotos/el mapa, un pequeño **banner de aviso amarillo** mientras haya cambios sin guardar abiertos. Se escriben recién cuando haces clic abajo en **«Escribir etiquetado»** — junto con GPS/dirección/orientación y **dentro del mismo backup ZIP**. Así hay una copia de seguridad antes de cada cambio. El botón de escritura también está activo cuando solo has editado campos EXIF (sin GPS).

### Auto-tag por reconocimiento de imagen 🔍 (desde v0.9.349, solo Mac)
En el **Mac**, el Geotagger puede reconocer automáticamente **palabras clave** para cada foto — escenas y objetos como «Exterior, Bosque, Corzo, Playa». Eso lo hace el **framework Apple Vision integrado**: completamente **en el dispositivo**, sin internet, sin cuenta, sin descarga, y rápido (fracciones de segundo por foto). Los términos frecuentes se traducen al alemán.

Así funciona: haz clic en el botón **«🔍 Auto-tag (reconocimiento de imagen)»** en la sección de escritura → la app analiza todas las fotos visibles/marcadas → las sugerencias aterrizan como **cambios pendientes** (amarillos, en el campo `Keywords`) → los repasas/corriges en la pestaña EXIF y luego los escribes con **«Escribir etiquetado»** (incl. backup). La IA solo sugiere — tú decides.

> **Windows / Linux:** esta función **no** existe ahí — Apple Vision es exclusivo de Mac, y no queríamos incluir para ello un enorme modelo de IA. El botón simplemente está oculto ahí; todo lo demás en el Geotagger funciona idéntico.

### Campos globales — autor y copyright para todo el lote (desde v0.9.346)
Algunos campos quieres **fijarlos una vez y escribirlos en todas las fotos** — nombre, copyright, etc. Para eso hay en la sección de escritura el botón **«✎ Campos globales (autor, copyright …)»**. En el formulario introduces lo que necesitas:
- **Autor** (tu nombre), **copyright**, **condiciones de uso**, **crédito**, **fuente**, **web/URL**, **correo electrónico**, **palabras clave** (separadas por comas).

Estos valores se **guardan como perfil** — tecleas nombre + copyright **una vez**, y a partir de ahí figuran ya en cada lote. Al **«Escribir etiquetado»** se escriben en **todas las fotos visibles/marcadas**, y ello por campo en varios tags de metadatos a la vez (EXIF + IPTC + XMP), para que Lightroom, Apple Fotos y compañía los encuentren en todas partes. Si en la pestaña EXIF has cambiado a mano el mismo valor en una foto, **tu cambio individual tiene prioridad** sobre el valor global. Vaciar el campo en el formulario = no se escribe (ya).

### Escribir la dirección en la foto 📍 (desde v0.9.337, automático desde v0.9.338)
En cuanto las fotos están asignadas, la app determina **automáticamente** para cada una la **dirección completa** (calle, localidad, comunidad/estado, país) y la muestra en el popup de la foto. Al etiquetar se escribe como **IPTC + XMP** en la foto — Lightroom, Apple Fotos y compañía muestran entonces localidad y país. El botón **«📍 Obtener direcciones»** solo sirve ya para **volver a obtenerlas**.

- **Astuto en vez de lento:** la búsqueda funciona como una **pirámide de 3 niveles** — primero una consulta sobre el centroide de todas las fotos (= país), luego una por cada zona de ~1 km (= localidad), luego finamente la calle. Así, todas las imágenes quedan rellenas a grandes rasgos tras pocas consultas, y la calle llega después.
- **Proveedor seleccionable** (⚙ → «Búsqueda de direcciones»): **Automático** (toma Mapbox si tienes un token guardado, si no Photon), **Mapbox** (el más rápido, necesita token), **Photon/Komoot** o **Nominatim/OpenStreetMap** — todos sin cuenta salvo Mapbox. Cada opción está explicada en el diálogo.
- **Desactivable:** en los ajustes se puede **desactivar** por completo la búsqueda de direcciones — entonces no se envía nada a internet, y tecleas las direcciones a mano si hace falta.
- **Corregible por foto:** si una dirección no cuadra, ajústala con el **✎** en el popup de la foto.

### Seleccionar qué se escribe
En la zona de escritura puedes determinar por cada pasada **qué va a la foto**: coordenadas GPS (siempre), **altitud**, **orientación de la vista** y **dirección** — cada opción activable/desactivable por separado. La selección se recuerda.

### Tocar un punto del track (desde v0.9.163) ⭐
Al hacer clic en la **línea del track** en el mapa → un pequeño popup muestra las **coordenadas GPS, la altitud y la fecha/hora (UTC)** del punto del track más cercano. Práctico para comprobar rápido cuándo/dónde estuviste en un lugar.

### Filtrar la vista general (desde v0.9.163) ⭐
La **«Vista general»** en el panel izquierdo cuenta cuántas fotos se etiquetan, quedan fuera del tiempo del track, no tienen una hora EXIF utilizable o ya tenían GPS. Detrás de cada línea hay un botón **«mostrar»**: un clic filtra la lista de fotos justo a esa categoría (p. ej. solo las que están fuera del tiempo, para revisarlas). **«Restablecer filtro»** vuelve a traer todas las fotos.

### Filtrar por cámara + etiquetar de forma dirigida (desde v0.9.164) ⭐
- **Filtro de cámara:** si tienes fotos de varias cámaras, la vista general lista cada **cámara** con su cantidad + un botón **«mostrar»**. Un clic muestra solo las imágenes de esa cámara.
- **Casilla por foto:** cada foto tiene arriba a la izquierda una casilla — **activada por defecto**. Al escribir se etiquetan **solo las fotos que están visibles en ese momento (por el filtro activo) Y marcadas**. Así etiquetas, p. ej., con el filtro de cámara solo una cámara de forma dirigida, o desmarcas imágenes sueltas que no deben etiquetarse.
- **Eliminar una foto:** la pequeña **✕** arriba a la derecha en la foto (al pasar por encima) o **Retroceso/Supr** en la foto seleccionada la quita de la lista. El archivo en sí queda intacto.

### Colocar fotos manualmente en el mapa (desde v0.9.166) ⭐
Algunas fotos **no se pueden asignar por tiempo** — p. ej. porque solo llevan la fecha de exportación y por eso quedan «fuera del tiempo del track». En lugar de rendirte con ellas, **arrástralas simplemente de la lista de fotos al mapa** — donde sueltes, se fijan y escriben las coordenadas GPS.

- **Colocación libre** (por defecto): la foto aterriza exactamente en el punto donde la sueltas. Funciona **también sin ningún track** — así puedes geoetiquetar fotos también sin GPX.
- **Anclar al track:** el interruptor **«Anclar al track»** (sección «Colocar manualmente» a la izquierda) coloca en su lugar la foto en el **punto del track más cercano** (incluida su altitud). **Mantener ⌘ pulsado** al soltar invierte brevemente el modo (libre ↔ anclar).
- **Ajuste fino:** los pines fijados manualmente son **azules** y se pueden **desplazar directamente en el mapa**. Al desplazar rige la misma lógica de anclaje (toggle + ⌘).
- Una barra de aviso en el mapa indica al arrastrar si en ese momento se coloca **libre** o **en el track**.
- **Adoptar la hora de captura del track (desde v0.9.281):** el interruptor **«Adoptar la hora de captura del track»** (justo debajo de «Anclar al track») escribe al etiquetar, para las fotos **ancladas**, además la **hora del punto del track** como momento de captura (`DateTimeOriginal`) en la foto. Perfecto para **fotos de WhatsApp de amigos**, que solo tienen una hora de reenvío incorrecta — así, tras el etiquetado, se ordenan correctamente entre tus propias fotos. Actúa **solo** sobre las fotos ancladas; las fotos emparejadas automáticamente por tiempo conservan su hora original. La hora del track (UTC) se convierte a tu zona horaria local — correcto si estuviste de ruta en tu zona horaria de casa.

> Nota: las colocaciones manuales valen para la sesión en curso. Si cambias de módulo y vuelves, quizá tengas que fijarlas de nuevo.

### Velocidad
ExifTool funciona como daemon en segundo plano — el procesamiento RAW es ~8× más rápido que con una llamada ingenua a `subprocess`. Etiquetar 200 fotos tarda ~15 segundos.

---

## 7 · Módulo: Inspector GPX — reparar el track 🔍 (desde v0.9.233)

### Qué hace
Muestra **cada punto individual** de tu track en el mapa (el track en bruto completo, no el downsample suavizado de la vista previa) y te deja reparar los puntos rotos: suavizar valores atípicos de GPS, rellenar huecos, desplazar o eliminar puntos sueltos. **No** necesita token de Mapbox (funciona también en modo OSM). Guarda como archivo nuevo `<nombre>_geheilt.gpx` — tu original queda intacto. Abre **todos los formatos importables** (GPX, FIT, KML/KMZ, TCX, GeoJSON, NMEA/`.LOG`) — los formatos ajenos se convierten automáticamente a GPX (desde v0.9.296).

> **❤️ Los sensores FIT/TCX se conservan (desde v0.9.334):** si editas un track con datos de sensores (frecuencia cardíaca, temperatura, cadencia…), el GPX sanado conserva esos valores. Los puntos sin cambios y suavizados llevan sus valores medidos reales, y los puntos de hueco recién insertados se interpolan. Así puedes usar el track sanado después con toda normalidad en el Animator con el overlay de sensores.
>
> **💾 «Guardar como…» + formato (desde v0.9.335):** al guardar se abre un diálogo de archivo — la carpeta por defecto es la de tu archivo original (ya no una carpeta oculta del sistema). Elige **GPX** (los sensores van vía `gpxtpx` directamente en el archivo) o **TCX** (formato de Garmin con frecuencia cardíaca/cadencia). Así el archivo se mantiene portable y no pierde los sensores estándar tampoco fuera de Reisezoom.

### Herramientas

**Sanar (suavizar salto)** — para picos de GPS: un punto queda un momento muy lejos (túnel, cañón urbano). Haz clic en el **ancla A** (verde, antes del salto) y el **ancla B** (roja, después), luego **🩹 Sanar**. Los puntos intermedios se colocan sobre la línea directa — **posición y altitud interpoladas, las marcas de tiempo quedan sin cambios**. Con eso, la velocidad se corrige por sí sola (antes, p. ej., «180 km/h a pie»).

**Rellenar hueco (línea recta)** — cuando entre A y B *faltan puntos*: inserta puntos nuevos sobre la recta (posición, altitud y tiempo interpolados). La distancia se ajusta con «Distancia al rellenar».

**Dibujar y rellenar un trazado** — como «Rellenar hueco», pero dibujas tú mismo el camino: elige el ancla A+B → **✏️ Dibujar y rellenar trazado** → haz clic en el mapa (el cursor pasa a ser una cruz) → **✓ Aplicar trazado**. El hueco se rellena a lo largo de la línea que has dibujado.

**Puntos sueltos:** haz clic en un punto (solo ancla A) → **🗑 Eliminar este punto** o simplemente **Supr/Retroceso**. O **desplaza el punto verde con el ratón** — p. ej. arrástralo al camino real, sin eliminarlo (tiempo + altitud se conservan, la velocidad sigue cuadrando).

**Recortar el inicio o el final (desde v0.9.320):** haz clic en un punto (solo ancla A) → **⏮ Recortar todo lo anterior** (el punto pasa a ser el nuevo **inicio**) o **⏭ Recortar todo lo posterior** (el punto pasa a ser el nuevo **final**). Justo lo adecuado cuando al final de la ruta **olvidaste detener la grabación** y el track tiene una cola sin sentido (vuelta a casa/parón) — o cuando quieres quitar la aproximación del principio. ⌘Z lo deshace.

**Info del punto / marcas de tiempo (desde v0.9.263):** en cuanto haces clic en un punto (ancla A), en la línea de selección figuran su **índice, la hora (local) y la altitud**. Si has fijado A **y** B, muestra además la **duración** entre ambos puntos — práctico para ver cuánto tiempo hay en un tramo.

**🛣 Ajustar a carretera/camino (Map Matching, desde v0.9.263):** coloca limpiamente una traza GPS ruidosa sobre la **red de caminos** (suaviza la deriva a lo largo de caminos/carreteras). Elige el perfil (**A pie / Bicicleta / Coche**), luego:
- **Trayecto A→B (seguir carretera)** — encuentra la **ruta real por carretera/camino** entre el ancla A y B (Directions). A y B se ajustan a la carretera más cercana, y entre medias se calcula la ruta → **robusto frente a cualquier deriva de GPS, sin límite de 50 m**. Ideal para un tramo que sigue un camino. La ruta encontrada se **redensifica a la densidad de puntos típica de tu track** y se retempo­riza con la **velocidad media del tramo** (en lugar de comprimirla en el viejo tiempo A→B) — con eso, el punto sanado **no corre demasiado rápido en el Animator**, y las marcas de tiempo posteriores se desplazan de forma consistente con él (desde v0.9.268).
- **Ajustar todo el track** — la traza completa por Map Matching sobre caminos cercanos (sigue la forma de la traza). Ajustable con el **radio de ajuste** (5–50 m).
Con el **radio de búsqueda** (5–50 m, slider) ajustas hasta qué distancia puede estar un punto del camino para aún ajustarse: pequeño = solo muy cerca del camino, grande = capta más deriva de GPS, pero puede saltar antes a una carretera **paralela**. La posición se ajusta, **el tiempo y la altitud se reparten sobre la nueva longitud**, y todo es **reversible** (⌘Z). Los tracks largos se descomponen automáticamente en trozos (límite de Mapbox). Si la app **no** encuentra ningún camino dentro del radio, no pasa nada y recibes un aviso claro. **Importante:** solo tiene sentido si el track realmente sigue caminos/carreteras — en **caminatas campo a través** puede falsear la traza. Necesita **internet + token de Mapbox**.

### 🩹 Auto-sanar: valores atípicos + huecos (desde v0.9.295)
En lugar de buscar a mano: **🩹 Auto-sanar** escanea todo el track y muestra como **vista previa en el mapa** lo que haría — antes de que se cambie nada:
- **🟠 Valores atípicos** (naranja) — saltos de GPS que se van *y vuelven*. Se suavizan al sanar.
- **🟣 Huecos** (magenta, línea discontinua + puntos fantasma claros) — cortes/dropouts mayores sin puntos intermedios. Se rellenan al sanar con puntos interpolados (posición, altitud y tiempo).

Con **‹ / Siguiente ›** saltas por los valores atípicos, **🩹 Sanar todo** aplica ambos de una vez. El **regulador de sensibilidad** (1–10) ajusta lo estricta que es la búsqueda (bajo = solo saltos brutos/huecos grandes, alto = también los pequeños), la **distancia de relleno** determina lo densamente que se rellenan los huecos — ambos actualizan la vista previa en directo. Todo se puede deshacer con **⌘Z**.

**Rellenar huecos como** (perfil): **Línea recta** = conexión directa (segura, solo toca el hueco). **Senderismo/Bicicleta/Coche** = busca la ruta real en la red de caminos (Mapbox). ⚠️ **Protección desde v0.9.315:** si la ruta por carretera da un gran **rodeo/bucle** (Mapbox enruta a veces en los cruces por una salida + rotonda de vuelta), se **descarta automáticamente y el hueco se rellena recto** — así una traza limpia ya no se retuerce. En el toast pone entonces «… rodeos descartados».

**Recortar un bucle/desvío:** si tienes en el track un punto que va y vuelve (p. ej. un viejo desvío de sanado o una vuelta real que no quieres en el vídeo): bajo **«Editar manualmente (A→B)»** fija el **ancla A** antes y el **ancla B** después del punto, luego **✂️ Recortar los puntos entre A→B**. A y B quedan, y la línea los conecta directamente. (⌘Z lo deshace.)

**«Ajustar todo el track a la red de caminos»** coloca el track **completo** sobre las carreteras de Mapbox y **sobrescribe tus puntos** — eso puede generar rodeos/bucles en los cruces. Por eso, desde v0.9.315, con **aviso + confirmación de 2 clics**. Para solo huecos/valores atípicos, mejor usa el **sanado** normal.

### ⛰ Corregir la altitud (mapa en lugar de GPS) — desde v0.9.292
Los valores de altitud del GPS suelen ser ruidosos — sobre todo con poca cobertura, la altitud salta unos metros de un lado a otro, y al final hay demasiados **metros de desnivel** en las estadísticas (p. ej. 1800 en lugar de 1400). Aquí puedes mezclar la **altitud lisa del terreno del mapa de Mapbox** (modelo digital de elevación) con tu altitud de GPS — y ves mientras tanto **exactamente qué ocurre**:

1. **🗺 Cargar el perfil de altitud del mapa** — la app recorre una vez brevemente todo el track (carga las teselas de altitud) y lee para cada punto la altitud del mapa.
2. **Bajo el mapa** aparece un **perfil de altitud** con tres líneas superpuestas: **GPS (naranja, fina)** = tu original, **mapa/Mapbox (azul, fina)** = el terreno liso, y la **gruesa línea de resultado verde** = lo que saldría.
3. Con el regulador **GPS ⟷ mapa** mezclas en directo: a la derecha del todo (100 %) = altitud pura del mapa (muy lisa), a la izquierda del todo (0 %) = GPS sin cambios, por defecto **70 %**. La línea verde y la indicación de metros de desnivel (GPS / mapa / resultado) se desplazan de inmediato con ello.
4. ¿Cuadra? **⛰ Adoptar esta altitud** escribe la línea verde en el track. Después **💾 guardar** — la altitud corregida aterriza en el GPX y actúa en todas partes (Animator, Tour-Map, Animador de datos).

> Necesita un **token de Mapbox** (ajustes) e internet — sin token, el botón «Cargar» está atenuado. La adopción se puede deshacer con **⌘Z**. Si después cambias puntos (eliminas/insertas), el perfil se descarta automáticamente — simplemente vuelve a cargar.

**Sincronización de zoom + puntos clicables (desde v0.9.293):** el mapa y el perfil de altitud están conectados — **si haces zoom/desplazas el mapa**, el perfil muestra automáticamente solo el tramo visible; la **rueda del ratón sobre el perfil** hace zoom, **arrastrar** desplaza, y el mapa acompaña en cada caso. **Cursor del ratón vinculado (desde v0.9.294):** si pasas el ratón por el **mapa**, una **barra vertical en el perfil de altitud** muestra dónde estás justo ahora; si pasas por el **perfil**, aparece un **anillo blanco sobre el track**. Así encuentras puntos a la velocidad del rayo, sin hacer clic.

**Un solo clic en un punto** (mapa o perfil) muestra un **pequeño campo de información justo en el punto** (sin oscurecer el fondo) con todos los datos (posición, altitud GPS + mapa, tiempo, distancia, velocidad, pendiente) y los botones «Como ancla A/B». Si haces clic en otro punto, el campo se desplaza allí. Un **doble clic** fija el ancla directamente — el camino rápido para sanar.

### Deshacer
**⌘Z** deshace cualquier edición, **⌘⇧Z** rehace (o los botones ↩︎/↪︎). Al cargar un track nuevo, el historial arranca de cero.

### Guardar
**💾 Guardar el GPX sanado** escribe `<nombre>_geheilt.gpx` y lo carga directamente como track activo — a partir de ahí, todos los módulos usan la versión limpia.

---

## 8 · Funciones generales

### Vaciar el espacio de trabajo ✕
Arriba en la cabecera del módulo, **justo al lado del nombre del GPX**, hay una **✕ roja** (tooltip «Vaciar espacio de trabajo»). Clic → breve pregunta de seguridad → **todos los datos cargados fuera, en todos los módulos a la vez**: track GPX, fotos, marcadores, vista previa, datos de match — y el nombre del GPX de arriba también desaparece. Práctico cuando editas varias rutas distintas una tras otra.

> Desde v0.9.155 hay, **en lugar de tres botones «↺ Vaciar espacio de trabajo» separados** por módulo, solo esta única ✕ central. Antes, el nombre del GPX permanecía tras vaciar — eso ya está corregido.

**Qué se conserva:** el token de Mapbox, todos los ajustes (estilo, pitch, color, etc.), la última carpeta de guardado usada.

### Diálogo de guardado antes del render
El Animator y el Tour-Map preguntan **antes del render** dónde debe aterrizar la salida. Se propone un nombre por defecto:
- Animator: `<raíz-GPX>_<WxH>_<códec>.mp4` p. ej. `Oderlandweg_1920x1080_h264.mp4`
- Tour-Map: `<raíz-GPX>_<WxH>.png` p. ej. `Oderlandweg_1920x1080.png`

En el siguiente render, el diálogo vuelve a aparecer en la misma carpeta. **Cancelar** → no se ejecuta ningún render (ahorra 5-15 min en el Animator).

### Arrastrar y soltar en todas partes
Puedes:
- Arrastrar archivos GPX a la ventana de cualquier módulo
- Arrastrar carpetas enteras con fotos al Geotagger (recursivo)
- Arrastrar fotos sueltas al Geotagger

### Logo de la app + estadísticas en la cabecera
Arriba a la izquierda: icono de la app + nombre. En el centro (cuando hay un GPX cargado): pastillas de estadísticas (distancia, tiempo, ascenso, descenso). Arriba a la derecha: **?** (ayuda) y **⚙** (ajustes).

---

## 9 · Ayuda, feedback y reportes de bugs

### Menú de ayuda
Al hacer clic en **?** arriba a la derecha (o en el menú de macOS **Ayuda**) se abre un modal con cinco acciones:

1. **📖 Manual de usuario** — abre la versión HTML de esta documentación en el navegador
2. **🔑 Configurar el token de Mapbox** — la guía paso a paso
3. **📧 Feedback / reporte de bug a Marc** — ver más abajo
4. **📋 Abrir el archivo de log** — para el diagnóstico técnico en caso de errores
5. **ℹ Acerca de la app** — versión, rutas, créditos

### Enviar reportes de bugs a Marc
Al hacer clic en **📧 Feedback / reporte de bug a Marc** (o ante un error de render) se abre un modal con:

- **Destinatario**: `marc@reisezoom.com` con botón de copiar
- **Asunto** (prellenado con la versión de la app + error breve) con botón de copiar
- **Mensaje** (prellenado con la versión de la app, el SO, la versión de Python y un extracto del log) con botón de copiar

**Lo que tienes que hacer:**
1. Copiar la dirección del destinatario (📋)
2. Cambiar a tu webmail (Gmail / Outlook / iCloud en el navegador) o programa de correo, iniciar un correo nuevo, insertar el destinatario
3. Copiar + pegar el asunto
4. Copiar + pegar el mensaje
5. En el texto del mensaje, reemplazar el marcador de posición `[hier deinen Text einfügen]` por una breve descripción — qué has hecho, qué no ha funcionado
6. Enviar

**Si tienes un programa de correo local** (Mac Mail.app, Outlook Desktop, Thunderbird): botón **«📧 Abrir el programa de correo local»** abajo a la izquierda — entonces todo está prellenado automáticamente.

### Archivo de log
Ante errores de render se abre automáticamente un modal de error con un extracto de log desplegable + los botones «Mostrar en el Finder», «Abrir log», «📧 Enviar a Marc». El archivo de log completo lo encuentras en cualquier momento en:
- macOS: `~/Library/Application Support/Reisezoom GPS Studio/logs/app.log`
- Windows: `%APPDATA%\Reisezoom GPS Studio\logs\app.log`
- Linux: `~/.local/share/Reisezoom GPS Studio/logs/app.log`

---

## 10 · FAQ

### ¿Cómo obtengo las versiones nuevas? (desde v0.9.280)
La app comprueba al arrancar, en segundo plano, si hay en GitHub una versión más reciente. Si es así, aparece arriba un banner discreto **«La nueva versión vX.Y.Z está disponible»** con un botón de **Descargar** (abre en el navegador la descarga adecuada para Mac/Windows). Con la **✕** ocultas el aviso para esa versión. También puedes hacer clic en cualquier momento manualmente en el **diálogo Acerca de** (Ayuda → Acerca de) en **«Buscar actualizaciones»**. Las actualizaciones descargadas las instalas como en la configuración inicial (DMG/instalador) — por razones de seguridad, la app no se reemplaza a sí misma.

### «No se puede abrir porque proviene de un desarrollador no verificado» (macOS)
La app no está firmada con un certificado de desarrollador de Apple de 99 $/año. Solución: **clic derecho → Abrir** en lugar de doble clic (ver Instalación).

### «El equipo ha sido protegido por Windows Defender» (Windows)
El mismo problema en Windows. **«Más información» → «Ejecutar de todas formas»**.

### En el primer render del Animator tarda mucho
En el primerísimo render, la app descarga una sola vez Chromium para la pipeline de render del mapa (~150 MB). Aparece un modal con indicación de progreso. Después, cada render posterior arranca directamente.

### «Falta el token de Mapbox» al renderizar
El Animator + el Tour-Map necesitan un token de Mapbox (el Geotagger no). Introdúcelo en el modal ⚙. Si primero quieres probar sin él: modo OSM (mapa estándar sin Satellite), pero el render del Animator queda desactivado.

### Mi formato RAW no se reconoce
Actualmente compatibles: CR3, CR2, NEF, ARW, RAF, RW2, ORF, DNG, PEF, RWL, SRW, HEIC, HEIF. Si tu formato falta: un correo a Marc, presumiblemente fácil de añadir.

**Especial HEIC:** las fotos de iPhone (HEIC) funcionan desde v0.9.57 **de fábrica** — el plugin de decodificación necesario (`pillow-heif` con libheif) está en el bundle de la app, no necesitas ninguna herramienta instalada aparte. Con los demás formatos RAW sigues necesitando **ExifTool** en el sistema (en macOS vía `brew install exiftool`, en Windows las builds standalone oficiales). Si falta ExifTool, el Geotagger lo detecta al importar las fotos y omite los archivos RAW.

### El render se come horas / parece colgado
El render del Animator a 4K con 30 fps × 17 seg = 510 fotogramas. Por fotograma ~3-5 segundos con el terreno activado = ~30 min realistas para un vídeo de 17 seg.

Desde v0.9.286 funciona además con **4K** el **supersampling (antiparpadeo)**: la imagen se calcula internamente más grande y se reduce limpiamente, para que el detalle fino de satélite no parpadee al hacer un barrido. Eso hace los renders de 4K **algo más lentos**, pero notablemente más estables. 1080p no se ve afectado — si necesitas velocidad y puedes prescindir del último retoque, renderiza en 1080p.

Al final, la fase `+faststart` de ffmpeg tarda otros 2-3 min (el tamaño del archivo se mantiene constante — **esto no es un cuelgue**, es la finalización del encoder de Mapbox).

### ¿La app recuerda mis ajustes? ¿Puedo definir valores por defecto?
Sí, en dos niveles:

- **Por track:** cada ruta recuerda sus **propios** ajustes (estilo, color, pitch, overlays, keyframes, fotos, «Suavizar mapa»…). Si abres el mismo track más tarde, todo está como la última vez. El track se reconoce por su **contenido** (no por el nombre de archivo).
- **Para tracks nuevos:** un track **nuevo** arranca normalmente con los ajustes de fábrica. Si quieres siempre el mismo look, ve a **Ajustes** → **«Guardar los ajustes actuales como valores por defecto»**. A partir de ahí, cada track nuevo adopta tu look. Con **«Restablecer los ajustes de fábrica»** vuelves al estado de entrega. Los tracks existentes quedan intactos con ello. Lo específico del track (keyframes, trim, selección de fotos) no se adopta a propósito como valor por defecto.

### Mi vídeo en 4K parpadea un poco («como si la exposición fuera incorrecta»)
Eso era un tema conocido hasta v0.9.286 y ya está corregido (fundido de teselas desactivado + supersampling + un ligero difuminado del mapa contra el parpadeo de textura). Si aún tienes un vídeo antiguo: simplemente vuelve a renderizarlo con la versión actual.

La intensidad la controlas con el regulador **«Suavizar mapa»** en los **ajustes de vídeo** (Animator). Por defecto hay un valor discreto que quita el parpadeo sin volver embarrado el mapa. Si el mapa te queda demasiado suave → baja el regulador (0 = desactivado, mapa más nítido). Si aún hay parpadeo → sube el regulador. Actúa solo en los renders de 4K; las estadísticas, los números y la línea del track quedan siempre nítidos.

### El track está mal posicionado en el mapa
Probablemente un problema de zona horaria: la hora de captura de la foto no cuadra con el tiempo del track GPX. Solución en el Geotagger:
- Desplazar el slider de offset hasta que los marcadores aterricen donde corresponden
- Elegir la **zona horaria de la cámara** en el diálogo de offset (✎) — cuando las imágenes quedan desplazadas justo por horas enteras (típico en viajes al extranjero con cámaras sin tag de zona horaria, p. ej. Olympus/OM)
- O fijar una foto de referencia (ver el flujo de trabajo del Geotagger)

### Arriba aparece «Archivo de origen no encontrado — ¿unidad montada?» (desde v0.9.305)
Tu último archivo GPX cargado no es legible en este momento — normalmente porque el **disco duro externo se ha desconectado** o el archivo se ha movido/eliminado. Vuelve a conectar el disco (el banner desaparece en la siguiente carga) o haz clic en **«Volver a elegir archivo»** y busca de nuevo el GPX. Mientras el banner esté ahí, el Tour-Map, el Animador de datos y el Geotagger no pueden construir el track.

### ¿Cómo reporto un bug?
**Ayuda → 📧 Feedback / reporte de bug a Marc** — todo prellenado (ver la sección 7).

---

## 11 · Atajos de teclado (macOS)

### General

| Atajo | Acción |
|----------|--------|
| `Cmd + ,` | Abrir ajustes |
| `Cmd + Q` | Salir de la app |
| `Cmd + M` | Minimizar la ventana |
| `Cmd + W` | Cerrar la ventana (la app sigue en segundo plano) |

### Deshacer / rehacer (desde v0.9.66/67) ⭐

| Atajo | Acción |
|----------|--------|
| `Cmd + Z` | Deshacer la última acción (Undo) |
| `Cmd + Shift + Z` | Volver adelante (Redo) |

Cada módulo tiene su **propia pila de deshacer con 50 pasos**:

- **Animator:** fijar/eliminar/desplazar keyframes, tiradores de trim, valores de intro/animación/hold, toggle del editor de keyframes.
- **Tour-Map:** todos los ajustes de la barra lateral (color de línea, grosor, glow, posición de la caja de estadísticas, tamaño de pin, estilo de mapa…).
- **Geotagger:** slider de offset de foto, punto de referencia, «Incluir subcarpetas». **No** reversible: los tags GPS ya escritos en las fotos — pero puedes estar tranquilo, porque desde v0.9.372 siempre se escribe en copias y los originales quedan intactos (salvo que elijas conscientemente la carpeta original + confirmes la sobrescritura).

Al cambiar entre proyectos se vacía la pila de deshacer del módulo afectado (no hay «deshacer» a través de los límites de proyecto).

Durante un arrastre continuo (mover un slider, desplazar el trim) se guarda **un** snapshot de deshacer por «sesión de edición» (throttle de 800 ms). Las acciones discretas como un snapshot de KF o un clic en casilla se registran de inmediato.

### Línea de tiempo del Animator

| Atajo | Acción |
|----------|--------|
| `←` / `→` | 1 punto GPS adelante/atrás |
| `Shift + ← / →` | 10 puntos GPS adelante/atrás |
| `Home` / `End` | Inicio / final del track |
| `Space` | Iniciar/detener ensayo |

En Windows/Linux, `Ctrl + …` en lugar de `Cmd + …` correspondientemente, y `Ctrl + Y` adicionalmente para rehacer.

---

## 12 · Limitaciones conocidas (Beta v0.3.x)

- **macOS**: solo Apple Silicon (M1/M2/M3/M4) — sin Mac Intel
- **La app no está firmada con código** → maniobra de primer arranque vía clic derecho → Abrir
- **Multi-track**: un GPX por render — la comparación multi-track llegará más adelante
- **Overlay de vídeo** (estadísticas en directo sobre un MP4 existente): aún no implementado
- **Geocodificación de alta resolución** (foto exacta sobre la curva del sendero): no implementada; los puntos se ajustan al punto del track más cercano
- **Fuentes/logos personalizados en el overlay**: no es posible

Roadmap completa en el repo bajo `docs/IDEAS.md`.

---

## 13 · Soporte y contacto

- **Reportes de bugs y feedback**: Ayuda → 📧 (ver la sección 7) o directamente `marc@reisezoom.com`
- **Blog y actualizaciones**: [reisezoom.com](https://reisezoom.com)
- **Canal de YouTube**: [@reisezoom](https://www.youtube.com/@reisezoom)

¡Que te diviertas renderizando! 🚀
