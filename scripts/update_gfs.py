#!/usr/bin/env python3
"""Descarga GFS global de NOMADS y genera productos livianos para GitHub Pages."""

from __future__ import annotations

import argparse
import base64
import json
import math
import shutil
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import urlencode

import numpy as np
import requests
from PIL import Image
from eccodes import (
    codes_get,
    codes_get_array,
    codes_grib_new_from_file,
    codes_release,
)

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
DATA_ROOT = DOCS / "data"
GFS_ROOT = DATA_ROOT / "gfs"
WORK_ROOT = ROOT / "work"

FILTER_URL = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl"
USER_AGENT = "ClimateProyectar-World/1.0"

WEST_COORDS = [[-180, 85], [0, 85], [0, -85], [-180, -85]]
EAST_COORDS = [[0, 85], [180, 85], [180, -85], [0, -85]]

PALETTES = {
    "precipitation": {
        "values": [0.0, 0.05, 0.3, 1.0, 3.0, 7.0, 15.0, 30.0],
        "colors": [
            [0, 0, 0, 0],
            [35, 115, 210, 70],
            [30, 180, 235, 145],
            [35, 205, 125, 175],
            [225, 220, 40, 190],
            [245, 135, 25, 205],
            [220, 35, 65, 215],
            [175, 20, 180, 225],
        ],
        "unit": "mm/h",
        "label": "Precipitación",
    },
    "temperature": {
        "values": [-50, -30, -15, 0, 10, 20, 30, 40, 50],
        "colors": [
            [80, 20, 130, 185],
            [40, 45, 190, 185],
            [35, 125, 230, 180],
            [35, 205, 225, 175],
            [65, 200, 115, 170],
            [225, 215, 55, 180],
            [245, 145, 35, 195],
            [220, 45, 45, 210],
            [145, 20, 70, 220],
        ],
        "unit": "°C",
        "label": "Temperatura",
    },
    "pressure": {
        "values": [940, 960, 980, 1000, 1015, 1030, 1050, 1070],
        "colors": [
            [55, 35, 155, 175],
            [45, 80, 205, 175],
            [35, 155, 225, 170],
            [45, 205, 175, 165],
            [210, 215, 80, 165],
            [245, 165, 45, 180],
            [225, 65, 45, 195],
            [145, 20, 65, 210],
        ],
        "unit": "hPa",
        "label": "Presión",
    },
    "clouds": {
        "values": [0, 10, 25, 50, 75, 100],
        "colors": [
            [0, 0, 0, 0],
            [110, 135, 160, 45],
            [145, 165, 185, 75],
            [180, 195, 210, 110],
            [215, 225, 235, 145],
            [245, 248, 252, 185],
        ],
        "unit": "%",
        "label": "Nubosidad",
    },
    "wind": {
        "values": [0, 2, 5, 10, 15, 25, 40, 60],
        "colors": [
            [20, 85, 150, 35],
            [25, 125, 205, 85],
            [25, 180, 225, 125],
            [40, 205, 135, 150],
            [215, 215, 50, 170],
            [245, 145, 35, 190],
            [220, 45, 65, 205],
            [165, 25, 165, 220],
        ],
        "unit": "m/s",
        "label": "Viento",
    },
}


@dataclass
class GridField:
    data: np.ndarray
    lats: np.ndarray
    lons: np.ndarray


def parse_hours(raw: str) -> list[int]:
    result: list[int] = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        value = int(item)
        if value < 0 or value > 384:
            raise ValueError(f"Hora GFS fuera de rango: {value}")
        result.append(value)
    result = sorted(set(result))
    if not result:
        raise ValueError("La lista de horas está vacía.")
    return result


def candidate_cycles(now: datetime | None = None) -> Iterable[tuple[str, str]]:
    now = now or datetime.now(timezone.utc)
    for day_offset in range(0, 3):
        date = (now - timedelta(days=day_offset)).strftime("%Y%m%d")
        for cycle in ("18", "12", "06", "00"):
            cycle_time = datetime.strptime(date + cycle, "%Y%m%d%H").replace(
                tzinfo=timezone.utc
            )
            if cycle_time <= now + timedelta(hours=1):
                yield date, cycle


def build_url(date: str, cycle: str, forecast_hour: int) -> str:
    params = {
        "file": f"gfs.t{cycle}z.pgrb2.1p00.f{forecast_hour:03d}",
        "lev_10_m_above_ground": "on",
        "lev_2_m_above_ground": "on",
        "lev_surface": "on",
        "lev_mean_sea_level": "on",
        "lev_entire_atmosphere": "on",
        "var_UGRD": "on",
        "var_VGRD": "on",
        "var_TMP": "on",
        "var_PRATE": "on",
        "var_PRMSL": "on",
        "var_TCDC": "on",
        "dir": f"/gfs.{date}/{cycle}/atmos",
    }
    return FILTER_URL + "?" + urlencode(params)


def download_grib(
    session: requests.Session,
    date: str,
    cycle: str,
    forecast_hour: int,
    destination: Path,
) -> None:
    url = build_url(date, cycle, forecast_hour)
    print(f"Descargando GFS {date} {cycle}Z f{forecast_hour:03d}...")
    response = session.get(url, timeout=(20, 180))
    response.raise_for_status()

    content = response.content
    if len(content) < 100 or content[:4] != b"GRIB":
        preview = content[:160].decode("utf-8", errors="replace")
        raise RuntimeError(f"NOMADS no devolvió GRIB2: {preview!r}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)
    size_mb = len(content) / 1024 / 1024
    if size_mb >= 0.01:
        print(f"  {size_mb:.2f} MB")
    else:
        print(f"  {len(content) / 1024:.1f} KB")


def normalize_grid(
    values: np.ndarray,
    lats_flat: np.ndarray,
    lons_flat: np.ndarray,
    ni: int,
    nj: int,
) -> GridField:
    # Para GFS 1,00° global se espera aproximadamente 360 x 181 puntos.
    # Una grilla 1x1 indica que NOMADS recibió una selección regional vacía.
    if ni < 300 or nj < 170:
        raise ValueError(
            f"Grilla GFS incompleta: {ni}x{nj}. "
            "Se esperaba una grilla mundial cercana a 360x181."
        )

    expected = ni * nj
    if len(values) != expected or len(lats_flat) != expected or len(lons_flat) != expected:
        raise ValueError(
            "La cantidad de valores del GRIB no coincide con las dimensiones "
            f"de la grilla ({ni}x{nj})."
        )

    data = np.asarray(values, dtype=np.float32).reshape(nj, ni)
    lat_grid = np.asarray(lats_flat, dtype=np.float32).reshape(nj, ni)
    lon_grid = np.asarray(lons_flat, dtype=np.float32).reshape(nj, ni)

    lats = lat_grid[:, 0]
    lons = ((lon_grid[0, :] + 180.0) % 360.0) - 180.0

    lon_order = np.argsort(lons)
    lons = lons[lon_order]
    data = data[:, lon_order]

    if lats[0] < lats[-1]:
        lats = lats[::-1]
        data = data[::-1, :]

    return GridField(data=data, lats=lats, lons=lons)


def read_grib(path: Path) -> dict[str, GridField]:
    fields: dict[str, GridField] = {}

    with path.open("rb") as handle:
        while True:
            gid = codes_grib_new_from_file(handle)
            if gid is None:
                break

            try:
                short_name = str(codes_get(gid, "shortName"))
                level_type = str(codes_get(gid, "typeOfLevel"))
                level = float(codes_get(gid, "level"))

                key: str | None = None

                if short_name in {"10u", "u"} and level_type == "heightAboveGround" and math.isclose(level, 10):
                    key = "u10"
                elif short_name in {"10v", "v"} and level_type == "heightAboveGround" and math.isclose(level, 10):
                    key = "v10"
                elif short_name in {"2t", "t"} and level_type == "heightAboveGround" and math.isclose(level, 2):
                    key = "temperature"
                elif short_name in {"prate"} and level_type == "surface":
                    key = "precipitation"
                elif short_name in {"prmsl", "msl"} and level_type in {"meanSea", "meanSeaLevel"}:
                    key = "pressure"
                elif short_name in {"tcc"} and level_type in {
                    "atmosphere",
                    "entireAtmosphere",
                    "atmosphereSingleLayer",
                }:
                    key = "clouds"

                if key and key not in fields:
                    ni = int(codes_get(gid, "Ni"))
                    nj = int(codes_get(gid, "Nj"))
                    values = np.array(codes_get_array(gid, "values"), dtype=np.float32)
                    lats = np.array(codes_get_array(gid, "latitudes"), dtype=np.float32)
                    lons = np.array(codes_get_array(gid, "longitudes"), dtype=np.float32)
                    fields[key] = normalize_grid(values, lats, lons, ni, nj)
                    print(
                        f"  Campo {key}: {short_name}, {level_type}, "
                        f"{level:g}, {nj}x{ni}"
                    )
            finally:
                codes_release(gid)

    return fields


def interpolate_palette(data: np.ndarray, palette: dict) -> np.ndarray:
    values = np.asarray(palette["values"], dtype=np.float32)
    colors = np.asarray(palette["colors"], dtype=np.float32)

    safe = np.nan_to_num(data, nan=values[0], posinf=values[-1], neginf=values[0])
    flat = safe.ravel()

    channels = [
        np.interp(flat, values, colors[:, channel]) for channel in range(4)
    ]
    rgba = np.stack(channels, axis=1).reshape((*safe.shape, 4))
    return np.clip(rgba, 0, 255).astype(np.uint8)


def prepare_layer_data(name: str, field: GridField) -> np.ndarray:
    data = field.data.astype(np.float32, copy=True)

    if name == "temperature":
        data -= 273.15
    elif name == "precipitation":
        data *= 3600.0
    elif name == "pressure":
        data /= 100.0
    elif name == "clouds":
        data = np.clip(data, 0.0, 100.0)

    return data


def save_split_raster(
    name: str,
    data: np.ndarray,
    lats: np.ndarray,
    lons: np.ndarray,
    output_dir: Path,
) -> dict:
    lat_mask = (lats <= 85.0) & (lats >= -85.0)
    cropped = data[lat_mask, :]

    rgba = interpolate_palette(cropped, PALETTES[name])

    west_mask = lons < 0.0
    east_mask = ~west_mask

    output_dir.mkdir(parents=True, exist_ok=True)

    paths = {}
    for hemisphere, mask in (("west", west_mask), ("east", east_mask)):
        image = Image.fromarray(rgba[:, mask, :], mode="RGBA")
        image = image.resize((720, 680), Image.Resampling.BICUBIC)
        filename = f"{name}-{hemisphere}.png"
        image.save(output_dir / filename, optimize=True, compress_level=9)
        paths[hemisphere] = filename

    return {
        "west": paths["west"],
        "east": paths["east"],
        "west_coordinates": WEST_COORDS,
        "east_coordinates": EAST_COORDS,
        "unit": PALETTES[name]["unit"],
        "label": PALETTES[name]["label"],
        "scale": PALETTES[name]["values"],
    }


def quantize_wind(u: np.ndarray, v: np.ndarray, scale: float = 0.5) -> tuple[str, str]:
    u_quantized = np.clip(np.rint(u / scale), -127, 127).astype(np.int8)
    v_quantized = np.clip(np.rint(v / scale), -127, 127).astype(np.int8)

    return (
        base64.b64encode(u_quantized.tobytes()).decode("ascii"),
        base64.b64encode(v_quantized.tobytes()).decode("ascii"),
    )


def save_wind_json(
    u_field: GridField,
    v_field: GridField,
    output_dir: Path,
) -> dict:
    if u_field.data.shape != v_field.data.shape:
        raise ValueError("Las grillas U y V no coinciden.")

    u64, v64 = quantize_wind(u_field.data, v_field.data)
    payload = {
        "source": "NOAA/NCEP GFS",
        "nx": int(u_field.data.shape[1]),
        "ny": int(u_field.data.shape[0]),
        "lon_start": float(u_field.lons[0]),
        "lon_step": float(abs(u_field.lons[1] - u_field.lons[0])),
        "lat_start": float(u_field.lats[0]),
        "lat_step": -float(abs(u_field.lats[1] - u_field.lats[0])),
        "scale": 0.5,
        "encoding": "signed-int8-base64",
        "u": u64,
        "v": v64,
    }

    filename = "wind.json"
    (output_dir / filename).write_text(
        json.dumps(payload, separators=(",", ":")),
        encoding="utf-8",
    )
    return {"data": filename}


def process_frame(
    grib_path: Path,
    output_dir: Path,
    frame_prefix: str,
) -> dict:
    fields = read_grib(grib_path)

    if "u10" not in fields or "v10" not in fields:
        raise RuntimeError("El GRIB no contiene los campos U/V de viento a 10 m.")

    output_dir.mkdir(parents=True, exist_ok=True)
    products: dict[str, dict] = {}

    u = fields["u10"]
    v = fields["v10"]
    speed = np.sqrt(np.square(u.data) + np.square(v.data))

    products["wind"] = save_split_raster(
        "wind", speed, u.lats, u.lons, output_dir
    )
    products["wind"].update(save_wind_json(u, v, output_dir))

    for name in ("precipitation", "temperature", "pressure", "clouds"):
        field = fields.get(name)
        if field is None:
            print(f"  Advertencia: no se encontró {name}.")
            continue
        data = prepare_layer_data(name, field)
        products[name] = save_split_raster(
            name, data, field.lats, field.lons, output_dir
        )

    for product in products.values():
        for key in ("west", "east", "data"):
            if key in product:
                product[key] = f"{frame_prefix}/{product[key]}"

    return products


def write_manifest(
    date: str,
    cycle: str,
    frames: list[dict],
) -> None:
    manifest = {
        "schema_version": 1,
        "status": "ready",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": "NOAA GFS",
        "grid": "1.00 degree global",
        "cycle": f"{date}T{cycle}:00:00Z",
        "source_url": "https://nomads.ncep.noaa.gov/",
        "frames": frames,
        "available_layers": [
            {
                "id": key,
                "label": PALETTES[key]["label"],
                "unit": PALETTES[key]["unit"],
                "scale": PALETTES[key]["values"],
            }
            for key in ("precipitation", "wind", "temperature", "pressure", "clouds")
        ],
    }

    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    (DATA_ROOT / "latest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def clean_generated_data() -> None:
    if GFS_ROOT.exists():
        shutil.rmtree(GFS_ROOT)
    if WORK_ROOT.exists():
        shutil.rmtree(WORK_ROOT)
    GFS_ROOT.mkdir(parents=True, exist_ok=True)
    WORK_ROOT.mkdir(parents=True, exist_ok=True)


def find_cycle_and_first_frame(
    session: requests.Session,
    first_hour: int,
) -> tuple[str, str, Path]:
    errors = []

    for date, cycle in candidate_cycles():
        target = WORK_ROOT / f"gfs-{date}-{cycle}-f{first_hour:03d}.grib2"
        try:
            download_grib(session, date, cycle, first_hour, target)
            return date, cycle, target
        except Exception as exc:
            errors.append(f"{date} {cycle}Z: {exc}")
            print(f"  Ciclo no disponible: {date} {cycle}Z")
            time.sleep(10)

    detail = "\n".join(errors[-8:])
    raise RuntimeError(f"No se encontró un ciclo GFS utilizable.\n{detail}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--hours",
        default="0,3,6,9,12,15,18,21,24",
        help="Horas de pronóstico separadas por comas.",
    )
    args = parser.parse_args()

    try:
        hours = parse_hours(args.hours)
    except Exception as exc:
        print(f"Error en --hours: {exc}", file=sys.stderr)
        return 2

    clean_generated_data()

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    first_hour = hours[0]

    try:
        date, cycle, first_path = find_cycle_and_first_frame(session, first_hour)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1

    cycle_dt = datetime.strptime(date + cycle, "%Y%m%d%H").replace(
        tzinfo=timezone.utc
    )

    frames: list[dict] = []

    for index, forecast_hour in enumerate(hours):
        if index == 0:
            grib_path = first_path
        else:
            grib_path = (
                WORK_ROOT
                / f"gfs-{date}-{cycle}-f{forecast_hour:03d}.grib2"
            )
            try:
                download_grib(
                    session, date, cycle, forecast_hour, grib_path
                )
            except Exception as exc:
                print(
                    f"Advertencia: se omite f{forecast_hour:03d}: {exc}",
                    file=sys.stderr,
                )
                continue
            time.sleep(10)

        frame_id = f"f{forecast_hour:03d}"
        relative_prefix = f"data/gfs/{date}{cycle}/{frame_id}"
        output_dir = DOCS / relative_prefix

        try:
            products = process_frame(
                grib_path=grib_path,
                output_dir=output_dir,
                frame_prefix=relative_prefix,
            )
        except Exception as exc:
            print(
                f"Advertencia: no se pudo procesar {frame_id}: {exc}",
                file=sys.stderr,
            )
            continue

        valid_time = cycle_dt + timedelta(hours=forecast_hour)
        frames.append(
            {
                "id": frame_id,
                "forecast_hour": forecast_hour,
                "valid_time": valid_time.isoformat().replace("+00:00", "Z"),
                "products": products,
            }
        )

    if not frames:
        print("No se generó ningún cuadro.", file=sys.stderr)
        return 1

    write_manifest(date, cycle, frames)
    shutil.rmtree(WORK_ROOT, ignore_errors=True)

    print(
        f"Listo: {len(frames)} cuadros, ciclo {date} {cycle}Z, "
        f"manifest: {DATA_ROOT / 'latest.json'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
