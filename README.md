# Climate World

Plataforma meteorológica mundial de ClimateProyectar.

Este repositorio crea una visualización meteorológica global con:

- globo 3D y mapa plano mediante MapLibre GL JS;
- mapa base de OpenFreeMap / OpenStreetMap;
- imágenes satelitales globales de NASA GIBS;
- pronóstico NOAA GFS mundial;
- precipitación;
- temperatura;
- presión;
- nubosidad;
- velocidad del viento;
- partículas animadas de viento;
- línea temporal y reproducción automática;
- despliegue estático mediante GitHub Pages.

## Importante

Este proyecto es un módulo profesional independiente. No modifica ninguno de estos repositorios:

- `climate-observations`
- `climate-forecasts`
- `climate-satellite`
- `climate-radar`
- `climate-alerts`
- `climateproyectar-v2`

## Repositorio

```text
mtgproyect/climate-world
```

No hace falta crear otra cuenta de GitHub. `climate-world` queda aislado de los módulos existentes y después podrá integrarse con `climateproyectar-v2`.

## Primer despliegue

1. Crear un repositorio público vacío llamado `climate-world`.
2. Subir todo el contenido de este paquete respetando las carpetas.
3. Abrir:

```text
Settings → Pages → Source → GitHub Actions
```

4. Abrir:

```text
Actions → Build world weather and deploy → Run workflow
```

5. Para la primera publicación dejar los valores predeterminados:

```text
forecast_hours: 0,3,6,9,12,15,18,21,24
force_deploy: true
```

6. Esperar que finalicen los trabajos:

```text
Generar datos globales
Publicar GitHub Pages
```

7. La dirección será:

```text
https://mtgproyect.github.io/climate-world/
```

## Funcionamiento del workflow

El workflow:

1. busca el ciclo NOAA GFS más reciente disponible;
2. descarga solo las variables y niveles necesarios;
3. convierte GRIB2 a imágenes transparentes y datos compactos de viento;
4. construye `docs/data/latest.json`;
5. publica la carpeta `docs` como artefacto de GitHub Pages.

Los datos generados se incluyen en el artefacto publicado, pero no se agregan al
historial Git. Esto evita que el repositorio crezca en cada actualización.

## Fuente NOAA

Producto inicial:

```text
GFS 1,00°
```

Variables:

```text
UGRD 10 m       viento zonal
VGRD 10 m       viento meridional
TMP 2 m         temperatura
PRATE superficie precipitación
PRMSL nivel del mar presión
TCDC atmósfera   nubosidad
```

La resolución de 1 grado se eligió para la prueba porque permite procesar el
planeta completo con poco almacenamiento. Después de validar la arquitectura
se podrá evaluar GFS 0,25° por regiones o una infraestructura de teselas.

## Actualización externa

El workflow conserva únicamente:

```yaml
workflow_dispatch:
```

Más adelante se puede invocar desde cron-job.org. Para la primera publicación debe
ejecutarse manualmente.

## Prueba local del frontend

Sin generar NOAA, puede abrirse con:

```bash
python -m http.server 8000 --directory docs
```

Luego visitar:

```text
http://localhost:8000
```

El mapa base y el satélite funcionan directamente. Las capas GFS aparecen
después de ejecutar el workflow.

## Prueba local completa

Requiere Python 3.11 o superior:

```bash
python -m pip install -r requirements.txt
python scripts/update_gfs.py --hours 0,3,6,9,12
python -m http.server 8000 --directory docs
```

## Atribuciones

- Pronóstico: NOAA/NCEP Global Forecast System.
- Satélite: NASA EOSDIS GIBS.
- Motor cartográfico: MapLibre GL JS.
- Mapa base: OpenFreeMap, OpenMapTiles y OpenStreetMap.

Consultar `DATA_SOURCES.md` y `LICENSE`.
