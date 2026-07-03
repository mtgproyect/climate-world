# Fuentes y atribuciones

## NOAA GFS

Los campos meteorológicos se descargan desde NCEP NOMADS mediante el filtro
GRIB oficial.

Fuente mostrada en la interfaz:

```text
NOAA/NCEP GFS
```

Los archivos originales no se redistribuyen. El workflow publica productos
visuales derivados y datos cuantizados de viento para uso cartográfico.

## NASA GIBS

La capa satelital utiliza el servicio WMTS de NASA EOSDIS GIBS:

```text
MODIS_Terra_CorrectedReflectance_TrueColor
```

La fecha se fija automáticamente con un retraso de dos días para aumentar la
probabilidad de disponibilidad mundial.

## MapLibre GL JS

Motor WebGL de código abierto para el mapa y la proyección de globo.

## OpenFreeMap y OpenStreetMap

El mapa base usa el estilo oscuro público de OpenFreeMap. Debe conservarse la
atribución visible incluida por el proveedor.

## Alcance

Este repositorio no consume, copia ni inspecciona conexiones internas de
Weawow. La interfaz se inspira únicamente en el concepto general de un mapa
meteorológico mundial y utiliza fuentes originales independientes.
