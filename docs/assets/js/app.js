(() => {
  "use strict";

  const state = {
    config: null,
    manifest: null,
    frames: [],
    frameIndex: 0,
    activeLayer: "precipitation",
    opacity: 0.72,
    projection: "globe",
    playing: false,
    playTimer: null,
    satelliteVisible: false,
    baseStyle: "dark",
    windAnimationVisible: true,
  };

  const elements = {
    statusCard: document.getElementById("status-card"),
    statusTitle: document.getElementById("status-title"),
    statusMessage: document.getElementById("status-message"),
    sourceLabel: document.getElementById("source-label"),
    projectionButton: document.getElementById("projection-button"),
    locateButton: document.getElementById("locate-button"),
    panelButton: document.getElementById("panel-button"),
    panel: document.getElementById("layer-panel"),
    panelClose: document.getElementById("panel-close"),
    satelliteToggle: document.getElementById("satellite-toggle"),
    windAnimationToggle: document.getElementById("wind-animation-toggle"),
    opacityRange: document.getElementById("opacity-range"),
    opacityOutput: document.getElementById("opacity-output"),
    legendTitle: document.getElementById("legend-title"),
    legendUnit: document.getElementById("legend-unit"),
    legendGradient: document.getElementById("legend-gradient"),
    legendLabels: document.getElementById("legend-labels"),
    playButton: document.getElementById("play-button"),
    timelineRange: document.getElementById("timeline-range"),
    timelineTicks: document.getElementById("timeline-ticks"),
    validTime: document.getElementById("valid-time"),
    cycleTime: document.getElementById("cycle-time"),
    coordinates: document.getElementById("coordinates"),
    zoomReadout: document.getElementById("zoom-readout"),
  };

  let map;
  let windOverlay;

  const styles = {
    dark: "https://tiles.openfreemap.org/styles/dark",
    liberty: "https://tiles.openfreemap.org/styles/liberty",
  };

  const INITIAL_VIEW = {
    center: [-64.5, -38.5],
    desktopZoom: 3.15,
    mobileZoom: 2.55,
  };

  const defaultOpacityByStyle = {
    dark: 86,
    liberty: 76,
  };

  const rasterAdjustments = {
    precipitation: { contrast: 0.24, saturation: 0.30, resampling: "linear" },
    wind: { contrast: 0.13, saturation: 0.18, resampling: "linear" },
    temperature: { contrast: 0.11, saturation: 0.15, resampling: "linear" },
    pressure: { contrast: 0.08, saturation: 0.08, resampling: "linear" },
    clouds: { contrast: 0.12, saturation: -0.10, resampling: "linear" },
  };

  function applyFactoryDefaults() {
    // Configuración de arranque:
    // precipitación seleccionada y viento animado visible.
    state.activeLayer = "precipitation";
    state.windAnimationVisible = true;

    if (elements.windAnimationToggle) {
      elements.windAnimationToggle.checked = true;
    }

    document.querySelectorAll(".layer-button").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.layer === "precipitation"
      );
    });
  }

  function getInitialZoom() {
    return window.matchMedia("(max-width: 820px)").matches
      ? INITIAL_VIEW.mobileZoom
      : INITIAL_VIEW.desktopZoom;
  }

  function applyDefaultOpacityForStyle() {
    const value = defaultOpacityByStyle[state.baseStyle] ?? 80;
    state.opacity = value / 100;
    elements.opacityRange.value = String(value);
    elements.opacityOutput.textContent = `${value}%`;
  }

  function layerSearchText(layer) {
    return `${layer?.id || ""} ${layer?.["source-layer"] || ""}`.toLowerCase();
  }

  function isPoliticalBoundaryLayer(layer) {
    if (layer?.type !== "line") return false;

    const text = layerSearchText(layer);
    const boundary =
      /(boundary|boundaries|admin[_ -]?[01]|country|state|province|region)/.test(text);
    const unrelated =
      /(road|street|rail|waterway|building|aeroway|contour|path|route)/.test(text);

    return boundary && !unrelated;
  }

  function isPrimaryBoundaryLayer(layer) {
    return /(country|admin[_ -]?0|boundary[_ -]?country)/.test(
      layerSearchText(layer)
    );
  }

  function isPlaceLabelLayer(layer) {
    if (layer?.type !== "symbol") return false;
    return /(country|state|province|region|city|town|village|place|settlement|capital)/.test(
      layerSearchText(layer)
    );
  }

  function removeBoundaryCasings() {
    const layers = map?.getStyle()?.layers || [];

    for (const layer of [...layers].reverse()) {
      if (
        String(layer.id).startsWith("climate-boundary-casing-") &&
        map.getLayer(layer.id)
      ) {
        map.removeLayer(layer.id);
      }
    }
  }

  function enhanceBaseMapStyle() {
    if (!map || !map.isStyleLoaded()) return;

    removeBoundaryCasings();

    const layers = [...(map.getStyle()?.layers || [])];
    const darkMode = state.baseStyle === "dark";
    let casingIndex = 0;

    for (const layer of layers) {
      if (isPoliticalBoundaryLayer(layer)) {
        const primary = isPrimaryBoundaryLayer(layer);

        const whiteWidth = primary
          ? ["interpolate", ["linear"], ["zoom"], 0, 0.70, 3, 1.15, 6, 1.70]
          : ["interpolate", ["linear"], ["zoom"], 0, 0.28, 3, 0.62, 6, 1.05];

        const casingWidth = primary
          ? ["interpolate", ["linear"], ["zoom"], 0, 1.70, 3, 2.45, 6, 3.30]
          : ["interpolate", ["linear"], ["zoom"], 0, 0.95, 3, 1.45, 6, 2.05];

        if (layer.source && layer["source-layer"]) {
          const casingId = `climate-boundary-casing-${casingIndex}`;
          casingIndex += 1;

          const casingLayer = {
            id: casingId,
            type: "line",
            source: layer.source,
            "source-layer": layer["source-layer"],
            minzoom: layer.minzoom,
            maxzoom: layer.maxzoom,
            filter: layer.filter,
            layout: {
              visibility: layer.layout?.visibility || "visible",
              "line-cap": "round",
              "line-join": "round",
            },
            paint: {
              "line-color": darkMode
                ? "rgba(0,0,0,0.94)"
                : "rgba(30,35,40,0.78)",
              "line-width": casingWidth,
              "line-opacity": primary ? 0.92 : 0.66,
              "line-blur": 0.15,
            },
          };

          try {
            map.addLayer(casingLayer, layer.id);
          } catch (error) {
            console.debug("No se agregó casing de límite:", layer.id, error);
          }
        }

        try {
          map.setPaintProperty(layer.id, "line-color", "#ffffff");
          map.setPaintProperty(layer.id, "line-width", whiteWidth);
          map.setPaintProperty(
            layer.id,
            "line-opacity",
            primary ? 0.96 : darkMode ? 0.72 : 0.82
          );
          map.setPaintProperty(layer.id, "line-blur", 0.05);
        } catch (error) {
          console.debug("No se pudo reforzar el límite:", layer.id, error);
        }
      }

      if (isPlaceLabelLayer(layer)) {
        try {
          map.setPaintProperty(
            layer.id,
            "text-color",
            darkMode ? "#ffffff" : "#17212b"
          );
          map.setPaintProperty(
            layer.id,
            "text-halo-color",
            darkMode ? "rgba(0,0,0,0.96)" : "rgba(255,255,255,0.94)"
          );
          map.setPaintProperty(layer.id, "text-halo-width", 1.45);
          map.setPaintProperty(layer.id, "text-halo-blur", 0.28);
        } catch (error) {
          console.debug("No se pudo reforzar una etiqueta:", layer.id, error);
        }
      }
    }
  }

  function getWeatherAnchorId() {
    const layers = map?.getStyle()?.layers || [];

    return (
      layers.find((layer) =>
        String(layer.id).startsWith("climate-boundary-casing-")
      )?.id ||
      layers.find(isPoliticalBoundaryLayer)?.id ||
      layers.find((layer) => layer.type === "symbol")?.id
    );
  }

  const fallbackScales = {
    precipitation: {
      label: "Precipitación",
      unit: "mm/h",
      values: [0, 0.05, 0.3, 1, 3, 7, 15, 30, 45],
      colors: [
        "transparent",
        "#1858b8",
        "#258fe8",
        "#36cdf5",
        "#20c46f",
        "#dfe332",
        "#f59a24",
        "#e2383f",
        "#b51cb5"
      ],
    },
    wind: {
      label: "Viento",
      unit: "m/s",
      values: [0, 2, 5, 10, 15, 25, 40, 60],
      colors: ["#145596", "#197dcd", "#19b5e0", "#28cd87", "#d7d732", "#f59123", "#dc2d41", "#a719a5"],
    },
    temperature: {
      label: "Temperatura",
      unit: "°C",
      values: [-50, -30, -15, 0, 10, 20, 30, 40, 50],
      colors: ["#501482", "#282dbe", "#237de6", "#23cde0", "#41c873", "#e1d737", "#f59123", "#dc2d2d", "#911446"],
    },
    pressure: {
      label: "Presión",
      unit: "hPa",
      values: [940, 960, 980, 1000, 1015, 1030, 1050, 1070],
      colors: ["#37239b", "#2d50cd", "#239be1", "#2dcdb0", "#d2d750", "#f5a52d", "#e1412d", "#911441"],
    },
    clouds: {
      label: "Nubosidad",
      unit: "%",
      values: [0, 10, 25, 50, 75, 100],
      colors: ["transparent", "#6e879f", "#91a5b9", "#b4c3d2", "#d7e1eb", "#f5f8fc"],
    },
  };

  function showStatus(title, message, autoHide = false) {
    elements.statusTitle.textContent = title;
    elements.statusMessage.textContent = message;
    elements.statusCard.classList.remove("hidden");

    if (autoHide) {
      window.setTimeout(() => {
        elements.statusCard.classList.add("hidden");
      }, 4200);
    }
  }

  function absoluteUrl(path) {
    return new URL(path, window.location.href).href;
  }

  function dateForSatellite(daysAgo = 2) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - daysAgo);
    return date.toISOString().slice(0, 10);
  }

  function satelliteTileUrl() {
    const date = dateForSatellite(2);
    return (
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/" +
      "MODIS_Terra_CorrectedReflectance_TrueColor/default/" +
      `${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`
    );
  }

  function initializeMap() {
    return new Promise((resolve) => {
      map = new maplibregl.Map({
      container: "map",
      style: styles[state.baseStyle],
      center: INITIAL_VIEW.center,
      zoom: getInitialZoom(),
      minZoom: 0.35,
      maxZoom: 9,
      attributionControl: true,
      renderWorldCopies: true,
      canvasContextAttributes: { antialias: true },
    });

    map.addControl(
      new maplibregl.NavigationControl({
        visualizePitch: true,
        showCompass: true,
        showZoom: true,
      }),
      "top-right"
    );

    map.on("style.load", () => {
      map.setProjection({ type: state.projection });
      enhanceBaseMapStyle();

      window.setTimeout(() => {
        enhanceBaseMapStyle();

        if (windOverlay && state.frames.length) {
          updateSatelliteLayer();
          updateFrame();
        }
      }, 0);
    });

    map.on("load", () => {
      enhanceBaseMapStyle();

      windOverlay = new window.WindOverlay(
        map,
        document.getElementById("wind-canvas")
      );

      const center = map.getCenter();
      elements.coordinates.textContent =
        `${center.lat.toFixed(2)}°, ${center.lng.toFixed(2)}°`;
      elements.zoomReadout.textContent = `zoom ${map.getZoom().toFixed(1)}`;

      restoreDynamicLayers();
      resolve();
    });

    map.on("mousemove", (event) => {
      elements.coordinates.textContent =
        `${event.lngLat.lat.toFixed(2)}°, ${event.lngLat.lng.toFixed(2)}°`;
    });

    map.on("zoom", () => {
      elements.zoomReadout.textContent = `zoom ${map.getZoom().toFixed(1)}`;
    });

      map.on("error", (event) => {
        console.warn("MapLibre:", event.error || event);
      });
    });
  }

  async function loadConfiguration() {
    const [configResponse, manifestResponse] = await Promise.all([
      fetch("config/app.json", { cache: "no-store" }),
      fetch(`data/latest.json?ts=${Date.now()}`, { cache: "no-store" }),
    ]);

    if (!configResponse.ok) {
      throw new Error("No se pudo leer config/app.json.");
    }

    state.config = await configResponse.json();

    if (!manifestResponse.ok) {
      throw new Error("No se pudo leer data/latest.json.");
    }

    state.manifest = await manifestResponse.json();
    state.frames = Array.isArray(state.manifest.frames)
      ? state.manifest.frames
      : [];
  }

  function configureTimeline() {
    const hasFrames = state.frames.length > 0;

    elements.timelineRange.disabled = !hasFrames;
    elements.playButton.disabled = !hasFrames;
    elements.timelineRange.min = "0";
    elements.timelineRange.max = String(Math.max(0, state.frames.length - 1));
    elements.timelineRange.value = "0";

    elements.timelineTicks.innerHTML = "";
    if (hasFrames) {
      const indexes = new Set([
        0,
        Math.floor((state.frames.length - 1) / 2),
        state.frames.length - 1,
      ]);
      [...indexes].sort((a, b) => a - b).forEach((index) => {
        const frame = state.frames[index];
        const date = parseUtcDate(frame.valid_time);
        if (!date) return;

        const tick = document.createElement("span");
        tick.textContent = new Intl.DateTimeFormat("es-AR", {
          weekday: "short",
          hour: "2-digit",
          timeZone: "UTC",
          hour12: false,
        }).format(date) + "Z";
        elements.timelineTicks.appendChild(tick);
      });
    }

    if (hasFrames) {
      elements.sourceLabel.textContent =
        `${state.manifest.model} · ${state.manifest.grid}`;
      showStatus(
        "Datos NOAA listos",
        `${state.frames.length} cuadros del ciclo ${formatCycle(state.manifest.cycle)}.`,
        true
      );
    } else {
      elements.sourceLabel.textContent = "Todavía sin cuadros NOAA";
      showStatus(
        "Mapa base disponible",
        "Ejecutá el workflow “Build world weather and deploy” para generar las capas GFS."
      );
    }
  }

  function parseUtcDate(value) {
    if (!value) return null;

    let normalized = String(value).trim();

    // Compatibilidad con manifiestos anteriores:
    // 20260703T12:00:00Z → 2026-07-03T12:00:00Z
    const compactMatch = normalized.match(
      /^(\d{4})(\d{2})(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/
    );

    if (compactMatch) {
      const [, year, month, day, hour, minute, second] = compactMatch;
      normalized =
        `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
    }

    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatCycle(value) {
    const date = parseUtcDate(value);
    if (!date) return "desconocido";

    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      hour12: false,
    }).format(date) + " UTC";
  }

  function formatValidTime(value) {
    const date = parseUtcDate(value);
    if (!date) return "Hora no disponible";

    return new Intl.DateTimeFormat("es-AR", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      hour12: false,
    }).format(date) + " UTC";
  }

  function removeForecastLayers() {
    for (const hemisphere of ["west", "east"]) {
      const layerId = `forecast-${hemisphere}`;
      const sourceId = `forecast-${hemisphere}`;
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }
  }

  function addForecastLayers(product) {
    removeForecastLayers();
    if (!product?.west || !product?.east) return;

    for (const hemisphere of ["west", "east"]) {
      const sourceId = `forecast-${hemisphere}`;
      const layerId = `forecast-${hemisphere}`;
      const coordinates =
        product[`${hemisphere}_coordinates`];

      map.addSource(sourceId, {
        type: "image",
        url: absoluteUrl(product[hemisphere]),
        coordinates,
      });

      const adjustment =
        rasterAdjustments[state.activeLayer] || rasterAdjustments.precipitation;
      const weatherAnchor = getWeatherAnchorId();

      map.addLayer(
        {
          id: layerId,
          type: "raster",
          source: sourceId,
          paint: {
            "raster-opacity": state.opacity,
            "raster-fade-duration": 0,
            "raster-resampling": adjustment.resampling || "linear",
            "raster-contrast": adjustment.contrast,
            "raster-saturation": adjustment.saturation,
          },
        },
        weatherAnchor
      );
    }
  }

  function removeSatelliteLayer() {
    if (map.getLayer("nasa-satellite")) map.removeLayer("nasa-satellite");
    if (map.getSource("nasa-satellite")) map.removeSource("nasa-satellite");
  }

  function updateSatelliteLayer() {
    removeSatelliteLayer();
    if (!state.satelliteVisible || !map.isStyleLoaded()) return;

    map.addSource("nasa-satellite", {
      type: "raster",
      tiles: [satelliteTileUrl()],
      tileSize: 256,
      attribution: "NASA EOSDIS GIBS",
      maxzoom: 9,
    });

    const weatherAnchor = getWeatherAnchorId();

    map.addLayer(
      {
        id: "nasa-satellite",
        type: "raster",
        source: "nasa-satellite",
        paint: {
          "raster-opacity": 0.86,
          "raster-saturation": -0.08,
          "raster-contrast": 0.12,
          "raster-fade-duration": 180,
        },
      },
      weatherAnchor
    );
  }

  async function updateWind(product) {
    if (!windOverlay) return;

    const visible = state.windAnimationVisible && Boolean(product?.data);
    windOverlay.setVisible(false);

    if (!visible) return;

    try {
      await windOverlay.load(absoluteUrl(product.data));
      windOverlay.setVisible(true);
    } catch (error) {
      console.error(error);
      showStatus("Viento no disponible", error.message, true);
    }
  }

  async function updateFrame() {
    updateLegend();

    if (!map || !map.isStyleLoaded()) return;

    if (!state.frames.length) {
      removeForecastLayers();
      if (windOverlay) windOverlay.setVisible(false);
      return;
    }

    const frame = state.frames[state.frameIndex];
    const product = frame.products?.[state.activeLayer];

    elements.validTime.textContent = formatValidTime(frame.valid_time);
    elements.cycleTime.textContent =
      `Ciclo ${formatCycle(state.manifest.cycle)} · +${frame.forecast_hour} h`;
    elements.timelineRange.value = String(state.frameIndex);

    if (product) {
      addForecastLayers(product);
    } else {
      removeForecastLayers();
      showStatus(
        "Capa no disponible",
        `El cuadro seleccionado no contiene ${fallbackScales[state.activeLayer].label.toLowerCase()}.`,
        true
      );
    }

    await updateWind(frame.products?.wind);
  }

  function updateLegend() {
    const scale = fallbackScales[state.activeLayer];
    elements.legendTitle.textContent = scale.label;
    elements.legendUnit.textContent = scale.unit;
    elements.legendGradient.style.background =
      `linear-gradient(90deg, ${scale.colors.join(", ")})`;

    elements.legendLabels.innerHTML = "";
    const indexes = new Set([
      0,
      Math.floor((scale.values.length - 1) / 2),
      scale.values.length - 1,
    ]);
    [...indexes].forEach((index) => {
      const label = document.createElement("span");
      label.textContent = scale.values[index];
      elements.legendLabels.appendChild(label);
    });
  }

  function setActiveLayer(layerId) {
    if (!fallbackScales[layerId]) return;
    state.activeLayer = layerId;

    document.querySelectorAll(".layer-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.layer === layerId);
    });

    updateFrame();

    if (window.innerWidth <= 820) {
      closePanel();
    }
  }

  function setOpacity(value) {
    state.opacity = Number(value) / 100;
    elements.opacityOutput.textContent = `${value}%`;

    for (const hemisphere of ["west", "east"]) {
      const layerId = `forecast-${hemisphere}`;
      if (map?.getLayer(layerId)) {
        map.setPaintProperty(layerId, "raster-opacity", state.opacity);
      }
    }
  }

  function togglePlayback() {
    if (!state.frames.length) return;

    state.playing = !state.playing;
    elements.playButton.textContent = state.playing ? "❚❚" : "▶";
    elements.playButton.setAttribute(
      "aria-label",
      state.playing ? "Pausar" : "Reproducir"
    );

    if (state.playing) {
      state.playTimer = window.setInterval(() => {
        state.frameIndex = (state.frameIndex + 1) % state.frames.length;
        updateFrame();
      }, 1150);
    } else {
      window.clearInterval(state.playTimer);
      state.playTimer = null;
    }
  }

  function setProjection() {
    state.projection = state.projection === "globe" ? "mercator" : "globe";
    map.setProjection({ type: state.projection });

    const label = state.projection === "globe" ? "Globo" : "Mapa";
    elements.projectionButton.querySelector(".button-text").textContent = label;
    elements.projectionButton.querySelector("span").textContent =
      state.projection === "globe" ? "🌐" : "🗺️";

    if (windOverlay && state.windAnimationVisible) {
      windOverlay.clear();
      windOverlay.resetParticles();
    }
  }

  function changeBaseStyle(styleId) {
    if (!styles[styleId] || styleId === state.baseStyle) return;
    state.baseStyle = styleId;

    document.querySelectorAll(".base-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.style === styleId);
    });

    applyDefaultOpacityForStyle();
    map.setStyle(styles[styleId]);
  }

  function restoreDynamicLayers() {
    map.setProjection({ type: state.projection });
    updateSatelliteLayer();
    updateFrame();
  }

  function locateUser() {
    if (!navigator.geolocation) {
      showStatus("Ubicación no disponible", "El navegador no ofrece geolocalización.", true);
      return;
    }

    showStatus("Buscando ubicación", "Esperando autorización del navegador.");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        map.flyTo({
          center: [position.coords.longitude, position.coords.latitude],
          zoom: 5.2,
          duration: 1800,
        });
        showStatus("Ubicación encontrada", "El mapa se centró en tu posición aproximada.", true);
      },
      (error) => {
        showStatus("No se pudo ubicar", error.message, true);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  function openPanel() {
    elements.panel.classList.add("open");
    elements.panelButton.setAttribute("aria-expanded", "true");
  }

  function closePanel() {
    elements.panel.classList.remove("open");
    elements.panelButton.setAttribute("aria-expanded", "false");
  }

  function attachEvents() {
    document.querySelectorAll(".layer-button").forEach((button) => {
      button.addEventListener("click", () => setActiveLayer(button.dataset.layer));
    });

    document.querySelectorAll(".base-button").forEach((button) => {
      button.addEventListener("click", () => changeBaseStyle(button.dataset.style));
    });

    elements.opacityRange.addEventListener("input", (event) =>
      setOpacity(event.target.value)
    );

    elements.satelliteToggle.addEventListener("change", (event) => {
      state.satelliteVisible = event.target.checked;
      updateSatelliteLayer();
    });

    elements.windAnimationToggle.addEventListener("change", (event) => {
      state.windAnimationVisible = event.target.checked;
      updateWind(state.frames[state.frameIndex]?.products?.wind);
    });

    elements.timelineRange.addEventListener("input", (event) => {
      state.frameIndex = Number(event.target.value);
      updateFrame();
    });

    elements.playButton.addEventListener("click", togglePlayback);
    elements.projectionButton.addEventListener("click", setProjection);
    elements.locateButton.addEventListener("click", locateUser);
    elements.panelButton.addEventListener("click", openPanel);
    elements.panelClose.addEventListener("click", closePanel);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePanel();
      if (event.code === "Space" && event.target.tagName !== "INPUT") {
        event.preventDefault();
        togglePlayback();
      }
    });
  }

  async function boot() {
    attachEvents();
    applyFactoryDefaults();
    applyDefaultOpacityForStyle();
    updateLegend();

    try {
      await Promise.all([
        initializeMap(),
        loadConfiguration(),
      ]);

      configureTimeline();

      // La primera activación se hace únicamente cuando:
      // 1) el mapa y su estilo están listos;
      // 2) WindOverlay ya fue creado;
      // 3) el manifiesto GFS ya tiene sus cuadros.
      await updateFrame();

      // Un segundo repintado en el próximo cuadro del navegador asegura que
      // MapLibre haya incorporado las fuentes de imagen antes de animar.
      await new Promise((resolve) =>
        window.requestAnimationFrame(resolve)
      );
      await updateFrame();
    } catch (error) {
      console.error(error);
      showStatus(
        "No se cargaron los datos meteorológicos",
        `${error.message} El mapa base seguirá disponible.`
      );
    }
  }

  boot();
})();
