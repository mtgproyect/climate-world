(() => {
  "use strict";

  class WindOverlay {
    constructor(map, canvas) {
      this.map = map;
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", { alpha: true });
      this.data = null;
      this.currentUrl = null;
      this.particles = [];
      this.running = false;
      this.animationFrame = null;
      this.lastTime = 0;
      this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.map.getContainer());
      this.resize();

      this.map.on("movestart", () => this.clear());
      this.map.on("zoom", () => this.clear());
    }

    resize() {
      const rect = this.map.getContainer().getBoundingClientRect();
      this.canvas.width = Math.max(1, Math.round(rect.width * this.pixelRatio));
      this.canvas.height = Math.max(1, Math.round(rect.height * this.pixelRatio));
      this.canvas.style.width = `${rect.width}px`;
      this.canvas.style.height = `${rect.height}px`;
      this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
      this.resetParticles();
    }

    clear() {
      const width = this.canvas.width / this.pixelRatio;
      const height = this.canvas.height / this.pixelRatio;
      this.ctx.clearRect(0, 0, width, height);
    }

    decodeSignedInt8(base64) {
      const binary = atob(base64);
      const result = new Int8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        const value = binary.charCodeAt(index);
        result[index] = value > 127 ? value - 256 : value;
      }
      return result;
    }

    async load(url) {
      if (this.currentUrl === url && this.data) {
        return;
      }

      this.stop();
      this.clear();

      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`No se pudo descargar viento (${response.status}).`);
      }

      const payload = await response.json();
      if (payload.encoding !== "signed-int8-base64") {
        throw new Error("Formato de viento no compatible.");
      }

      this.currentUrl = url;

      this.data = {
        nx: payload.nx,
        ny: payload.ny,
        lonStart: payload.lon_start,
        lonStep: payload.lon_step,
        latStart: payload.lat_start,
        latStep: payload.lat_step,
        scale: payload.scale,
        u: this.decodeSignedInt8(payload.u),
        v: this.decodeSignedInt8(payload.v),
      };

      this.resetParticles();
    }

    setVisible(visible) {
      this.canvas.style.display = visible ? "block" : "none";
      if (visible && this.data) {
        this.start();
      } else {
        this.stop();
        this.clear();
      }
    }

    start() {
      if (!this.data || this.running) return;
      this.running = true;
      this.lastTime = performance.now();
      this.animationFrame = requestAnimationFrame((time) => this.animate(time));
    }

    stop() {
      this.running = false;
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }
    }

    resetParticles() {
      const rect = this.map.getContainer().getBoundingClientRect();
      const count = Math.max(
        580,
        Math.min(2300, Math.round((rect.width * rect.height) / 720))
      );

      this.particles = Array.from({ length: count }, () => this.spawnParticle());
      this.clear();
    }

    spawnParticle() {
      const zoom = this.map.getZoom();
      const center = this.map.getCenter();
      let lon;
      let lat;

      if (zoom < 1.7) {
        lon = Math.random() * 360 - 180;
        lat = Math.asin(Math.random() * 2 - 1) * (180 / Math.PI);
      } else {
        const bounds = this.map.getBounds();
        const south = Math.max(-84, bounds.getSouth());
        const north = Math.min(84, bounds.getNorth());
        let west = bounds.getWest();
        let east = bounds.getEast();

        if (east < west) east += 360;
        lon = west + Math.random() * (east - west);
        lon = ((lon + 180) % 360 + 360) % 360 - 180;
        lat = south + Math.random() * Math.max(1, north - south);
      }

      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        lon = center.lng + Math.random() * 120 - 60;
        lat = center.lat + Math.random() * 70 - 35;
      }

      return {
        lon: ((lon + 180) % 360 + 360) % 360 - 180,
        lat: Math.max(-84, Math.min(84, lat)),
        age: Math.floor(Math.random() * 85),
        maxAge: 50 + Math.floor(Math.random() * 80),
      };
    }

    sample(lon, lat) {
      if (!this.data) return null;

      const normalizedLon = ((lon + 180) % 360 + 360) % 360 - 180;
      const x = (normalizedLon - this.data.lonStart) / this.data.lonStep;
      const y = (lat - this.data.latStart) / this.data.latStep;

      if (y < 0 || y >= this.data.ny - 1) return null;

      let x0 = Math.floor(x);
      if (x0 < 0) x0 += this.data.nx;
      x0 %= this.data.nx;
      const x1 = (x0 + 1) % this.data.nx;
      const y0 = Math.floor(y);
      const y1 = Math.min(y0 + 1, this.data.ny - 1);
      const tx = x - Math.floor(x);
      const ty = y - y0;

      const index = (xx, yy) => yy * this.data.nx + xx;
      const interpolate = (array) => {
        const a = array[index(x0, y0)] * this.data.scale;
        const b = array[index(x1, y0)] * this.data.scale;
        const c = array[index(x0, y1)] * this.data.scale;
        const d = array[index(x1, y1)] * this.data.scale;
        const top = a + (b - a) * tx;
        const bottom = c + (d - c) * tx;
        return top + (bottom - top) * ty;
      };

      const u = interpolate(this.data.u);
      const v = interpolate(this.data.v);
      return { u, v, speed: Math.hypot(u, v) };
    }

    isFrontSide(lon, lat) {
      const projection = this.map.getProjection?.();
      if (!projection || projection.type !== "globe" || this.map.getZoom() >= 3) {
        return true;
      }

      const center = this.map.getCenter();
      const toRadians = Math.PI / 180;
      const lat1 = center.lat * toRadians;
      const lat2 = lat * toRadians;
      const deltaLon = (lon - center.lng) * toRadians;
      const cosine =
        Math.sin(lat1) * Math.sin(lat2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
      const angle = Math.acos(Math.max(-1, Math.min(1, cosine))) / toRadians;
      return angle < 98;
    }

    animate(time) {
      if (!this.running || !this.data) return;

      const deltaMs = Math.min(40, Math.max(8, time - this.lastTime));
      this.lastTime = time;

      const width = this.canvas.width / this.pixelRatio;
      const height = this.canvas.height / this.pixelRatio;
      const ctx = this.ctx;

      ctx.save();
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = "rgba(0, 0, 0, 0.91)";
      ctx.fillRect(0, 0, width, height);
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = 0.95;
      ctx.lineCap = "round";

      const simulationSeconds = 1050 * (deltaMs / 16.67);

      for (let index = 0; index < this.particles.length; index += 1) {
        let particle = this.particles[index];

        if (particle.age > particle.maxAge) {
          particle = this.spawnParticle();
          this.particles[index] = particle;
          continue;
        }

        const wind = this.sample(particle.lon, particle.lat);
        if (!wind || wind.speed < 0.08 || !this.isFrontSide(particle.lon, particle.lat)) {
          particle.age = particle.maxAge + 1;
          continue;
        }

        const previous = this.map.project([particle.lon, particle.lat]);
        const cosLat = Math.max(0.18, Math.cos((particle.lat * Math.PI) / 180));
        const nextLat = particle.lat + (wind.v * simulationSeconds) / 111320;
        let nextLon =
          particle.lon + (wind.u * simulationSeconds) / (111320 * cosLat);
        nextLon = ((nextLon + 180) % 360 + 360) % 360 - 180;

        if (nextLat < -85 || nextLat > 85) {
          particle.age = particle.maxAge + 1;
          continue;
        }

        const next = this.map.project([nextLon, nextLat]);
        const dx = next.x - previous.x;
        const dy = next.y - previous.y;

        if (
          previous.x >= -20 &&
          previous.x <= width + 20 &&
          previous.y >= -20 &&
          previous.y <= height + 20 &&
          next.x >= -40 &&
          next.x <= width + 40 &&
          next.y >= -40 &&
          next.y <= height + 40 &&
          Math.abs(dx) < 70 &&
          Math.abs(dy) < 70
        ) {
          const alpha = Math.min(0.90, 0.28 + wind.speed / 60);
          ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(previous.x, previous.y);
          ctx.lineTo(next.x, next.y);
          ctx.stroke();
        }

        particle.lon = nextLon;
        particle.lat = nextLat;
        particle.age += 1;
      }

      ctx.restore();
      this.animationFrame = requestAnimationFrame((nextTime) =>
        this.animate(nextTime)
      );
    }
  }

  window.WindOverlay = WindOverlay;
})();
