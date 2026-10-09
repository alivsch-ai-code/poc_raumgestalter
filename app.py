"""
Raumgestalter – Proof of Concept
================================
Flask-Backend. Das Sprachmodell (Claude) *versteht* Plan, Skizze oder Foto und
liefert strukturierte Daten. Alles Messbare (Maßstab, Wandlängen, Fliesen,
Mengen) passiert im Code, nicht im Modell.

Start:  python app.py      (Port und Schlüssel stehen in .env)
"""
from __future__ import annotations

import base64
import json
import math
import os
import re
import secrets
import statistics
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
import requests
from werkzeug.middleware.proxy_fix import ProxyFix

BASE = Path(__file__).parent

# --- .env laden (python-dotenv, sonst einfacher Fallback) -----------------------------
try:
    from dotenv import load_dotenv

    load_dotenv(BASE / ".env")
except Exception:  # pragma: no cover
    env = BASE / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-5-5").strip()
CHAT_MODEL = os.getenv("CLAUDE_MODEL_CHAT", MODEL).strip()
REPLICATE_TOKEN = os.getenv("REPLICATE_API_TOKEN", "").strip()
REPLICATE_MODEL = os.getenv("REPLICATE_MODEL", "google/nano-banana").strip()
PROJECTS_DIR = Path(os.getenv("PROJECTS_DIR", BASE / "data" / "projects")).expanduser()
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "5057"))

try:
    import anthropic

    HAVE_SDK = True
except Exception:  # pragma: no cover
    anthropic = None
    HAVE_SDK = False

KEY_LOOKS_VALID = bool(API_KEY) and not API_KEY.lower().startswith(("sk-ant-xxx", "dein", "your", "<"))
LLM_READY = HAVE_SDK and KEY_LOOKS_VALID

app = Flask(__name__, static_folder=str(BASE / "static"), static_url_path="/static")
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.config["MAX_CONTENT_LENGTH"] = 14 * 1024 * 1024
app.config["JSON_AS_ASCII"] = False

CATALOG = json.loads((BASE / "data" / "catalog.json").read_text(encoding="utf-8"))
TILE_IDS = {t["id"] for t in CATALOG["tiles"]}
TILES = {t["id"]: t for t in CATALOG["tiles"]}
GROUT_IDS = {g["id"] for g in CATALOG["grouts"]}
PAINT_IDS = {p["id"] for p in CATALOG["paints"]}
TRIM_IDS = {t["id"] for t in CATALOG["trims"]}
STYLE_IDS = {s["id"] for s in CATALOG["styles"]}
PATTERN_IDS = {p["id"] for p in CATALOG["patterns"]}


# ======================================================================================
# Hilfsfunktionen
# ======================================================================================
_hits: dict[str, deque] = defaultdict(deque)


def rate_limited(limit: int = 30, window: int = 60) -> bool:
    """Sehr einfacher Schutz vor versehentlich hohen API-Kosten."""
    ip = request.remote_addr or "?"
    now = time.time()
    q = _hits[ip]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        return True
    q.append(now)
    return False


def err(message: str, status: int = 400, code: str = "error"):
    return jsonify({"error": code, "message": message}), status


def friendly_api_error(exc: Exception) -> tuple[str, int, str]:
    name = type(exc).__name__
    text = str(exc)
    if name == "AuthenticationError":
        return "Der API-Key wurde abgelehnt. Prüfe ANTHROPIC_API_KEY in der Datei .env.", 401, "bad_key"
    if name == "PermissionDeniedError":
        return "Dieser API-Key darf das gewählte Modell nicht nutzen.", 403, "forbidden"
    if name == "RateLimitError":
        return "Die KI ist gerade ausgelastet. Versuche es in einer Minute noch einmal.", 429, "rate_limit"
    if name == "NotFoundError":
        return f"Das Modell „{MODEL}“ wurde nicht gefunden. Passe CLAUDE_MODEL in .env an.", 404, "model"
    if name in ("APIConnectionError", "APITimeoutError"):
        return "Keine Verbindung zur KI. Prüfe deine Internetverbindung.", 502, "network"
    if "credit" in text.lower() or "billing" in text.lower():
        return "Das API-Guthaben ist aufgebraucht oder die Abrechnung fehlt.", 402, "billing"
    return "Die KI konnte die Anfrage nicht verarbeiten. Versuche es mit einem anderen Bild.", 502, "llm"


def parse_data_url(data_url: str) -> tuple[str, str]:
    m = re.match(r"data:(image/(?:png|jpeg|jpg|webp|gif));base64,(.+)$", data_url or "", re.S)
    if not m:
        raise ValueError("Bitte lade ein Bild (PNG, JPG oder WebP) hoch.")
    media = m.group(1).replace("image/jpg", "image/jpeg")
    b64 = m.group(2).strip()
    base64.b64decode(b64[:200] + "=" * (-len(b64[:200]) % 4), validate=False)
    if len(b64) > 7_000_000:
        raise ValueError("Das Bild ist zu groß. Bitte verkleinere es auf unter 5 MB.")
    return media, b64


# ======================================================================================
# 1) Raum aus Bild erkennen
# ======================================================================================
FIXTURE_STD = {  # Breite, Tiefe in cm (Breite = links/rechts aus Sicht von vorn)
    "badewanne": (170, 75),
    "dusche": (90, 90),
    "wc": (38, 68),
    "waschtisch": (60, 48),
    "waschmaschine": (60, 60),
    "heizkoerper": (50, 8),
    "schrank": (50, 35),
}
FACING_TO_ROT = {"unten": 0, "links": 90, "oben": 180, "rechts": 270}

ANALYZE_SYSTEM = """Du bist der Raum-Scanner einer Planungs-App für Bäder und Wohnräume.
Du bekommst ein Bild: Grundriss, Handskizze, Foto eines Plans oder Foto des Raums.
Deine Aufgabe ist AUSSCHLIESSLICH das Erkennen der Geometrie. Du rechnest keine Zentimeter aus –
das macht danach der Code. Antworte immer über das Werkzeug `submit_room`.

Regeln:
- Koordinaten: Bildkoordinaten, Ursprung oben links, y wächst nach unten. Die LÄNGERE Bildseite entspricht 1000,
  die kürzere entsprechend ihrem Seitenverhältnis weniger. x und y haben denselben Maßstab (nicht getrennt strecken).
- `polygon`: Eckpunkte der INNENSEITE der Wände im Uhrzeigersinn. Ein Rechteck hat 4 Punkte, eine L-Form 6.
  Winkel sind fast immer 90°. Erfinde keine Ecken, die nicht da sind.
- Wand i verläuft vom Punkt i zum Punkt i+1 (die letzte Wand zurück zum Punkt 0).
- `wall_labels`: Nur Maße, die im Bild WIRKLICH als Zahl stehen (z. B. „2,70 m“, „340“). Wert in Zentimetern.
  Nichts schätzen.
- `openings`: Türen und Fenster. `wall` = Wandindex, `start` und `end` = Anfang und Ende der Öffnung als Anteil
  entlang der Wand (0 bis 1, in Richtung Punkt i → i+1). Türen: `swing` = „innen“ oder „aussen“, `hinge` = Seite
  des Türbands („links“ oder „rechts“, in Laufrichtung der Wand gesehen). Unklar → „innen“ und „links“.
- `fixtures`: Badewanne, Dusche, WC, Waschtisch, Waschmaschine, Heizkörper, Schrank. `x`,`y` = Mittelpunkt.
  `facing` = Richtung, in die die Vorderseite zeigt („oben“, „unten“, „links“, „rechts“; beim WC ist die Vorderseite
  die Seite, an der man sitzt/steht, nicht der Spülkasten). `w_u` = Ausdehnung quer zur Blickrichtung, `d_u` =
  Ausdehnung in Blickrichtung, beide in Bildeinheiten. Lässt sich ein Objekt nicht sicher bestimmen: weglassen.
- Bei einem Foto des Raums rekonstruierst du selbst eine vereinfachte Draufsicht des Raums. Die Koordinaten
    beschreiben diese erzeugte Draufsicht, nicht Pixelpositionen im Foto. Erkenne sichtbare Wände, Öffnungen und
    Ausstattung; verdeckte Geometrie darfst du vorsichtig ergänzen. Setze `confidence` höchstens auf 0.65 und
    erkläre in `warnings`, was unsicher ist. Die Draufsicht wird anschließend als editierbarer 2D-Grundriss gezeigt.
- `summary`: 1–2 Sätze auf Deutsch, was du erkannt hast, in Alltagssprache.
- `warnings`: Dinge, die der Nutzer prüfen sollte (unleserliche Maße, unklare Tür, verdeckte Bereiche).
Wenn auf dem Bild kein Raum erkennbar ist, setze `plan_kind` = „unklar“ und liefere ein leeres Polygon."""

ANALYZE_TOOL = {
    "name": "submit_room",
    "description": "Liefert die erkannte Raumgeometrie in Bildkoordinaten (0–1000).",
    "input_schema": {
        "type": "object",
        "properties": {
            "plan_kind": {"type": "string", "enum": ["grundriss", "skizze", "foto", "unklar"]},
            "summary": {"type": "string"},
            "confidence": {"type": "number", "description": "0 bis 1"},
            "polygon": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"x": {"type": "number"}, "y": {"type": "number"}},
                    "required": ["x", "y"],
                },
            },
            "wall_labels": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"wall": {"type": "integer"}, "cm": {"type": "number"}},
                    "required": ["wall", "cm"],
                },
            },
            "openings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "enum": ["door", "window"]},
                        "wall": {"type": "integer"},
                        "start": {"type": "number"},
                        "end": {"type": "number"},
                        "swing": {"type": "string", "enum": ["innen", "aussen"]},
                        "hinge": {"type": "string", "enum": ["links", "rechts"]},
                    },
                    "required": ["type", "wall", "start", "end"],
                },
            },
            "fixtures": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "enum": list(FIXTURE_STD.keys())},
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "facing": {"type": "string", "enum": ["oben", "unten", "links", "rechts"]},
                        "w_u": {"type": "number"},
                        "d_u": {"type": "number"},
                    },
                    "required": ["type", "x", "y", "facing"],
                },
            },
            "warnings": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["plan_kind", "summary", "confidence", "polygon"],
    },
}


def _num(v, default=None):
    try:
        f = float(v)
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default


def scale_room(raw: dict, dims: dict) -> tuple[dict, list[str]]:
    """Rechnet die Bildkoordinaten des Modells mit den Nutzermaßen in Zentimeter um."""
    warnings: list[str] = list(raw.get("warnings") or [])
    pts = []
    for p in raw.get("polygon") or []:
        x, y = _num(p.get("x")), _num(p.get("y"))
        if x is not None and y is not None:
            pts.append((x, y))
    # doppelte Schlusspunkte entfernen
    if len(pts) > 2 and pts[0] == pts[-1]:
        pts.pop()
    if len(pts) < 3:
        raise ValueError("Ich konnte auf dem Bild keinen Raumumriss erkennen.")

    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    bw, bh = max(maxx - minx, 1e-6), max(maxy - miny, 1e-6)

    L, W = _num(dims.get("length")), _num(dims.get("width"))
    sx = sy = None
    if L and W and L > 0 and W > 0:
        a, b = max(L, W), min(L, W)
        if bw >= bh:
            sx, sy = a / bw, b / bh
        else:
            sx, sy = b / bw, a / bh
        ratio = sx / sy
        if ratio > 1.35 or ratio < 1 / 1.35:
            warnings.append(
                "Die Seitenverhältnisse deiner Maße passen nicht ganz zur Zeichnung. "
                "Ich habe den Raum auf deine Maße gestreckt. Bitte prüfe die Wandlängen."
            )
    else:
        n = len(pts)
        ratios = []
        for lab in raw.get("wall_labels") or []:
            i, cm = lab.get("wall"), _num(lab.get("cm"))
            if isinstance(i, int) and 0 <= i < n and cm and cm > 20:
                ax, ay = pts[i]
                bx, by = pts[(i + 1) % n]
                ln = math.hypot(bx - ax, by - ay)
                if ln > 1e-6:
                    ratios.append(cm / ln)
        if ratios:
            sx = sy = statistics.median(ratios)
            warnings.append("Maßstab aus den Zahlen im Plan berechnet. Bitte prüfe die Wandlängen.")
        else:
            sx = sy = 320.0 / max(bw, bh)
            warnings.append("Ohne Maße habe ich den Raum auf etwa 3,20 m Länge geschätzt. Trage die echten Maße ein.")

    poly = [{"x": round((x - minx) * sx, 1), "y": round((y - miny) * sy, 1)} for x, y in pts]
    n = len(poly)
    underlay = None
    iw, ih = _num((dims or {}).get("imgW")), _num((dims or {}).get("imgH"))
    if iw and ih and iw > 0 and ih > 0:
        k = 1000.0 / max(iw, ih)
        underlay = {"x": round(-minx * sx, 1), "y": round(-miny * sy, 1), "w": round(iw * k * sx, 1), "h": round(ih * k * sy, 1)}

    # --- Öffnungen
    openings = []
    for k, o in enumerate(raw.get("openings") or []):
        i = o.get("wall")
        if not isinstance(i, int):
            continue
        i %= n
        a, b = poly[i], poly[(i + 1) % n]
        wall_len = math.hypot(b["x"] - a["x"], b["y"] - a["y"])
        s, e = _num(o.get("start"), 0.3), _num(o.get("end"), 0.6)
        s, e = max(0.0, min(1.0, s)), max(0.0, min(1.0, e))
        if e < s:
            s, e = e, s
        width = (e - s) * wall_len
        kind = "window" if o.get("type") == "window" else "door"
        if kind == "door":
            if width < 65 or width > 140:
                width = 90
            height, sill = 205, 0
        else:
            width = min(max(width, 45), 260)
            height, sill = (120 if width >= 70 else 90), 100
        center = (s + e) / 2 * wall_len
        offset = max(0, min(wall_len - width, center - width / 2))
        openings.append(
            {
                "id": f"o{k + 1}",
                "type": kind,
                "wall": i,
                "offset": round(offset, 1),
                "width": round(width, 1),
                "height": height,
                "sill": sill,
                "swing": "aussen" if o.get("swing") == "aussen" else "innen",
                "hinge": "rechts" if o.get("hinge") == "rechts" else "links",
            }
        )

    # --- Ausstattung
    fixtures = []
    for k, f in enumerate(raw.get("fixtures") or []):
        t = f.get("type")
        if t not in FIXTURE_STD:
            continue
        x, y = _num(f.get("x")), _num(f.get("y"))
        if x is None or y is None:
            continue
        facing = f.get("facing") if f.get("facing") in FACING_TO_ROT else "unten"
        std_w, std_d = FIXTURE_STD[t]
        w, d = std_w, std_d
        wu, du = _num(f.get("w_u")), _num(f.get("d_u"))
        horizontal_front = facing in ("oben", "unten")  # Breite läuft dann entlang x
        if wu and wu > 0:
            cand = wu * (sx if horizontal_front else sy)
            if 0.7 * std_w <= cand <= 1.45 * std_w:
                w = cand
        if du and du > 0:
            cand = du * (sy if horizontal_front else sx)
            if 0.7 * std_d <= cand <= 1.45 * std_d:
                d = cand
        cx = max(0, min(poly_extent(poly, "x"), (x - minx) * sx))
        cy = max(0, min(poly_extent(poly, "y"), (y - miny) * sy))
        fixtures.append(
            {
                "id": f"f{k + 1}",
                "type": t,
                "x": round(cx, 1),
                "y": round(cy, 1),
                "w": round(w, 1),
                "d": round(d, 1),
                "rot": FACING_TO_ROT[facing],
            }
        )

    height = _num(dims.get("height"), 250) or 250
    room = {"polygon": poly, "height": max(200, min(400, height)), "openings": openings, "fixtures": fixtures}
    if underlay:
        room["underlay"] = underlay
    return room, warnings


def poly_extent(poly, axis):
    return max(p[axis] for p in poly)


@app.post("/api/analyze")
def api_analyze():
    if rate_limited():
        return err("Zu viele Anfragen. Warte kurz.", 429, "rate_limit")
    if not LLM_READY:
        reason = "Das Python-Paket „anthropic“ fehlt (pip install -r requirements.txt)." if not HAVE_SDK else (
            "Es ist noch kein API-Key hinterlegt. Trage ANTHROPIC_API_KEY in die Datei .env ein."
        )
        return err(reason, 503, "no_key")

    body = request.get_json(silent=True) or {}
    try:
        media, b64 = parse_data_url(body.get("image", ""))
    except ValueError as e:
        return err(str(e), 400, "image")

    dims = body.get("dims") or {}
    kind = body.get("kind") or "plan"
    if kind == "foto":
        dims = {key: value for key, value in dims.items() if key not in ("imgW", "imgH")}
    note = (body.get("notes") or "").strip()[:600]
    dim_txt = []
    if dims.get("length") and dims.get("width"):
        dim_txt.append(f"Der Raum ist etwa {dims['length']:.0f} cm x {dims['width']:.0f} cm groß.")
    if dims.get("height"):
        dim_txt.append(f"Raumhöhe {dims['height']:.0f} cm.")
    user_text = (
        ("Das Bild ist ein Foto des Raums. Rekonstruiere daraus eine vereinfachte Draufsicht mit geschätzten Wandverläufen. " if kind == "foto" else "Das Bild ist ein Plan oder eine Skizze. ")
        + " ".join(dim_txt)
        + (f"\nHinweis vom Nutzer: {note}" if note else "")
        + "\nBitte erkenne den Raum und rufe `submit_room` auf."
    )

    try:
        client = anthropic.Anthropic(api_key=API_KEY, timeout=90.0, max_retries=1)
        msg = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=ANALYZE_SYSTEM,
            tools=[ANALYZE_TOOL],
            tool_choice={"type": "tool", "name": "submit_room"},
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": media, "data": b64}},
                        {"type": "text", "text": user_text},
                    ],
                }
            ],
        )
    except Exception as exc:  # noqa: BLE001
        message, status, code = friendly_api_error(exc)
        app.logger.warning("Analyse fehlgeschlagen: %s", type(exc).__name__)
        return err(message, status, code)

    raw = next((b.input for b in msg.content if getattr(b, "type", "") == "tool_use"), None)
    if not raw or raw.get("plan_kind") == "unklar" and len(raw.get("polygon") or []) < 3:
        return err(
            "Auf dem Bild habe ich keinen Raum erkannt. Probiere einen klareren Grundriss "
            "oder eine Skizze mit durchgezogenen Wandlinien.",
            422,
            "no_room",
        )
    try:
        room, warnings = scale_room(raw, dims)
    except ValueError as e:
        return err(str(e), 422, "no_room")

    return jsonify(
        {
            "room": room,
            "meta": {
                "summary": str(raw.get("summary") or "")[:400],
                "confidence": min(0.65, max(0.0, min(1.0, _num(raw.get("confidence"), 0.5)))) if kind == "foto" else max(0.0, min(1.0, _num(raw.get("confidence"), 0.5))),
                "kind": "foto" if kind == "foto" else raw.get("plan_kind"),
                "warnings": ((["Aus dem Raumfoto rekonstruierte Draufsicht: Maße und verdeckte Bereiche bitte im 2D-Editor prüfen."] if kind == "foto" else []) + [str(w)[:240] for w in warnings])[:8],
                "model": MODEL,
            },
        }
    )


# ======================================================================================
# 2) Chat: Gestaltungswünsche in Aktionen übersetzen
# ======================================================================================
def catalog_brief() -> str:
    lines = []
    for t in CATALOG["tiles"]:
        w, h = t["size"]
        lines.append(f'{t["id"]} | {t["name"]} | {t["look"]} | {t["colorName"]} | {w:g}x{h:g} | {t["finish"]} | {t["use"]}')
    return "\n".join(lines)


CHAT_SYSTEM_TMPL = """Du bist der Gestaltungs-Assistent in einer Fliesen-Planungs-App. Du sprichst Deutsch, freundlich,
kurz und konkret, ohne Fachjargon (erkläre Begriffe wie „Kreuzfuge“ in einem halben Satz, falls nötig).
Der Nutzer sieht den Raum in 3D. Wenn er einen Wunsch äußert (Material, Farbe, Muster, Fugen, Höhe), rufst du
`apply_changes` auf und schreibst dazu 1–2 Sätze, was du getan hast und warum es passt. Bei Fragen oder wenn etwas
unklar ist, antwortest du nur mit Text. Nutze ausschließlich IDs aus den Listen unten. Erfinde nichts.
Boden: nur Fliesen mit Einsatz „boden“ oder „beide“. Wand: „wand“ oder „beide“. Rutschhemmung am Boden ist
im Bad wichtig; erwähne es kurz bei glänzenden Bodenfliesen. Die Preise sind Beispieldaten.

FLIESEN (id | Name | Look | Farbe | Format cm | Oberfläche | Einsatz)
{tiles}

MUSTER: {patterns}
FUGENFARBEN: {grouts}
WANDFARBEN: {paints}
ABSCHLUSSLEISTEN: {trims}
STILE (komplette Looks): {styles}

Ziele (`target`): floor = Boden, all_walls = alle Wände, wall = eine Wand (mit wall_index), everything = nur für
Wandfarbe/Leiste. Wandhöhe der Fliesen in cm (`tile_height_cm`; 0 = nicht gefliest, Raumhöhe = raumhoch)."""

CHAT_TOOL = {
    "name": "apply_changes",
    "description": "Ändert die Gestaltung des Raums. Mehrere Änderungen in einem Aufruf möglich.",
    "input_schema": {
        "type": "object",
        "properties": {
            "ops": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "target": {"type": "string", "enum": ["floor", "all_walls", "wall", "everything"]},
                        "wall_index": {"type": "integer"},
                        "tile_id": {"type": "string"},
                        "pattern": {"type": "string", "enum": sorted(PATTERN_IDS)},
                        "rotated": {"type": "boolean", "description": "true = Fliesen hochkant/gedreht"},
                        "grout_mm": {"type": "number"},
                        "grout": {"type": "string", "enum": sorted(GROUT_IDS)},
                        "tile_height_cm": {"type": "number"},
                        "paint": {"type": "string", "enum": sorted(PAINT_IDS)},
                        "trim": {"type": "string", "enum": sorted(TRIM_IDS)},
                        "style_id": {"type": "string", "enum": sorted(STYLE_IDS)},
                    },
                    "required": ["target"],
                },
            },
            "view": {"type": "string", "enum": ["eintreten", "ueberblick", "draufsicht"]},
        },
        "required": ["ops"],
    },
}


def clean_ops(ops: list[dict], wall_count: int) -> list[dict]:
    """Wirft alles weg, was nicht zum Katalog passt – egal ob von Claude oder vom Fallback."""
    out = []
    for op in ops or []:
        if not isinstance(op, dict) or op.get("target") not in ("floor", "all_walls", "wall", "everything"):
            continue
        c: dict = {"target": op["target"]}
        if op["target"] == "wall":
            i = op.get("wall_index")
            if not isinstance(i, int) or not (0 <= i < max(wall_count, 1)):
                continue
            c["wall_index"] = i
        if op.get("tile_id") in TILE_IDS:
            c["tile_id"] = op["tile_id"]
        if op.get("pattern") in PATTERN_IDS:
            c["pattern"] = op["pattern"]
        if isinstance(op.get("rotated"), bool):
            c["rotated"] = op["rotated"]
        g = _num(op.get("grout_mm"))
        if g is not None:
            c["grout_mm"] = max(1.0, min(10.0, g))
        if op.get("grout") in GROUT_IDS:
            c["grout"] = op["grout"]
        h = _num(op.get("tile_height_cm"))
        if h is not None:
            c["tile_height_cm"] = max(0.0, min(400.0, h))
        if op.get("paint") in PAINT_IDS:
            c["paint"] = op["paint"]
        if op.get("trim") in TRIM_IDS:
            c["trim"] = op["trim"]
        if op.get("style_id") in STYLE_IDS:
            c["style_id"] = op["style_id"]
        if len(c) > 1 + ("wall_index" in c):
            out.append(c)
    return out[:8]


# --- Fallback ohne KI: einfache Stichwort-Erkennung -------------------------------------
COLOR_WORDS = {
    "weiß": ["weiß", "weiss", "weisse", "weiße"], "grau": ["grau", "grauer"], "anthrazit": ["anthrazit", "dunkelgrau"],
    "schwarz": ["schwarz"], "beige": ["beige", "sand", "creme", "cremefarben"], "greige": ["greige"],
    "grün": ["grün", "gruen", "salbei", "olive"], "blau": ["blau", "petrol", "taubenblau"],
    "rosa": ["rosa", "rosé", "altrosa", "puder"], "terrakotta": ["terrakotta", "terracotta", "rostrot", "ziegel"],
    "braun": ["braun", "nussbaum", "nuss"],
}
LOOK_WORDS = {
    "marmor": ["marmor", "carrara", "calacatta", "marquina"], "beton": ["beton", "betonoptik", "industrial"],
    "holz": ["holz", "eiche", "parkett", "dielen", "nussbaum"], "terrazzo": ["terrazzo"],
    "zellige": ["zellige", "handgemacht", "handwerk", "marokkanisch"], "schiefer": ["schiefer", "naturstein"],
    "travertin": ["travertin"], "uni": ["einfarbig", "uni", "metro", "subway"],
}
PATTERN_WORDS = {
    "herring45": ["fischgrät 45", "fischgraet 45", "fischgrät diagonal"],
    "herring90": ["fischgrät", "fischgraet", "fischgrat", "zickzack"],
    "diagonal": ["diagonal", "schräg", "45°", "45 grad"],
    "half": ["versetzt", "versatz", "halber versatz", "verband", "läufer", "metro", "subway", "ziegel"],
    "third": ["drittel"], "basket": ["korb", "geflecht"],
    "grid": ["kreuzfuge", "gerade", "schachbrett", "quadratisch"],
}
STYLE_WORDS = {
    "hotel": ["hotel", "luxus", "edel"], "skandi": ["skandi", "skandinav", "nordisch"], "industrial": ["industrial", "loft"],
    "mediterran": ["mediterran", "toskana", "südlich"], "nero": ["nero", "schwarz-gold", "messing"],
    "salbei": ["salbei & terrazzo", "terrazzo und salbei"],
}


def _first_key(text: str, table: dict[str, list[str]]):
    """Schlüssel, dessen Stichwort am frühesten im Text vorkommt."""
    best, pos = None, 10**9
    for key, words in table.items():
        for w in words:
            i = text.find(w)
            if 0 <= i < pos:
                best, pos = key, i
    return best


GROUT_RE = re.compile(
    r"(wei(?:ß|ss)|hellgrau|zement\w*|anthrazit|schwarz|beige|braun)\w*\s+fuge\w*"
    r"|fuge\w*\s+(?:in\s+)?(wei(?:ß|ss)|hellgrau|zement\w*|anthrazit|schwarz|beige|braun)"
)
GROUT_MAP = {"weiß": "weiss", "weiss": "weiss", "hellgrau": "hellgrau", "anthrazit": "anthrazit",
             "schwarz": "schwarz", "beige": "beige", "braun": "braun"}


def _segment_ops(seg: str, target: str, for_floor: bool) -> dict:
    op: dict = {"target": target}
    # Fugenfarbe und -breite herausnehmen, damit sie nicht als Fliesenfarbe zählen
    had_fuge = "fuge" in seg
    gm = GROUT_RE.search(seg)
    if gm:
        word = gm.group(1) or gm.group(2)
        word = "weiss" if word.startswith("wei") else ("zement" if word.startswith("zement") else word)
        if word in GROUT_IDS:
            op["grout"] = word
        seg = seg[: gm.start()] + " " + seg[gm.end():]
    if had_fuge:
        mm = re.search(r"(\d{1,2})\s*mm", seg)
        if mm:
            op["grout_mm"] = float(mm.group(1))
            seg = seg[: mm.start()] + " " + seg[mm.end():]

    pattern = None
    for pid in ("herring45", "herring90", "diagonal", "third", "basket", "half", "grid"):
        if any(w in seg for w in PATTERN_WORDS[pid]):
            pattern = pid
            break
    if pattern:
        op["pattern"] = pattern

    look = _first_key(seg, LOOK_WORDS)
    color = _first_key(seg, COLOR_WORDS)
    size = re.search(r"(\d{1,3})\s*[x×*]\s*(\d{1,3})", seg)
    want = (float(size.group(1)), float(size.group(2))) if size else None
    best, best_score = None, 0
    for t in CATALOG["tiles"]:
        if (for_floor and t["use"] == "wand") or (not for_floor and t["use"] == "boden"):
            continue
        s = 0
        if look and t["look"] == look:
            s += 3
        if color and t["colorName"] == color:
            s += 3
        if want and sorted(t["size"]) == sorted(want):
            s += 2
        if s > best_score:
            best, best_score = t, s
    if best and best_score >= 3:
        op["tile_id"] = best["id"]

    if re.search(r"hochkant|senkrecht|vertikal|stehend", seg):
        op["rotated"] = True
    elif re.search(r"\bquer\b|waagerecht|liegend", seg):
        op["rotated"] = False

    if not for_floor:
        if re.search(r"raumhoch|bis zur decke|deckenhoch", seg):
            op["tile_height_cm"] = 9999
        elif "halbhoch" in seg or "spritzschutz" in seg:
            op["tile_height_cm"] = 120
        elif "sockel" in seg:
            op["tile_height_cm"] = 15
        else:
            hm = re.search(r"(\d{2,3})\s*cm\s*hoch|bis\s*(\d{2,3})\s*cm", seg)
            if hm:
                op["tile_height_cm"] = float(hm.group(1) or hm.group(2))
    return op


def fallback_chat(message: str, wall_count: int) -> dict:
    m = message.lower()

    # Stil-Komplettlooks
    for sid, words in STYLE_WORDS.items():
        if any(w in m for w in words) and not re.search(r"\b(boden|wand|wände|waende)\b", m):
            st = next(s for s in CATALOG["styles"] if s["id"] == sid)
            return {
                "reply": f"Ich habe den Stil „{st['name']}“ angewendet: {st['blurb']}",
                "ops": [{"target": "everything", "style_id": sid}],
                "mode": "fallback",
            }

    # Satz in Abschnitte je Ziel (Boden / Wände) teilen
    marks = [(mt.start(), "floor") for mt in re.finditer(r"\bboden\w*", m)]
    marks += [(mt.start(), "all_walls") for mt in re.finditer(r"\bw(?:and|ände|aende|änden)\b", m)]
    marks.sort()
    segs: list[tuple[str, str]] = []
    if marks:
        prefix = m[: marks[0][0]]
        for k, (pos, tg) in enumerate(marks):
            stop = marks[k + 1][0] if k + 1 < len(marks) else len(m)
            segs.append((tg, (prefix + " " if k == 0 else "") + m[pos:stop]))
    elif re.search(r"\balles\b|\bkomplett\b|\bbad\b|\braum\b", m):
        segs = [("floor", m), ("all_walls", m)]
    else:
        segs = [("floor", m)]

    ops = [_segment_ops(seg, tg, tg == "floor") for tg, seg in segs]
    ops = clean_ops(ops, wall_count)
    if not ops:
        return {
            "reply": "Das habe ich nicht verstanden. Ohne KI-Verbindung kenne ich nur einfache Wünsche, z. B. "
            "„Boden Beton hell 60x60“, „Wände weiß glänzend halbhoch“ oder „Fischgrät am Boden“. "
            "Mit eingetragenem API-Key verstehe ich freie Sprache.",
            "ops": [],
            "mode": "fallback",
        }
    return {"reply": "Erledigt. (Einfacher Modus ohne KI – mit API-Key verstehe ich auch freie Wünsche.)", "ops": ops, "mode": "fallback"}


@app.post("/api/chat")
def api_chat():
    if rate_limited(60):
        return err("Zu viele Anfragen. Warte kurz.", 429, "rate_limit")
    body = request.get_json(silent=True) or {}
    message = (body.get("message") or "").strip()[:800]
    if not message:
        return err("Schreibe, was du ändern möchtest.", 400, "empty")
    ctx = body.get("context") or {}
    walls = ctx.get("walls") or []
    wall_count = len(walls)

    if not LLM_READY:
        return jsonify(fallback_chat(message, wall_count))

    hist = []
    for h in (body.get("history") or [])[-8:]:
        role = "assistant" if h.get("role") == "assistant" else "user"
        text = str(h.get("text") or "")[:600]
        if text:
            hist.append({"role": role, "content": text})
    while hist and hist[0]["role"] != "user":
        hist.pop(0)
    # Rollen müssen wechseln
    merged: list[dict] = []
    for h in hist:
        if merged and merged[-1]["role"] == h["role"]:
            merged[-1]["content"] += "\n" + h["content"]
        else:
            merged.append(h)

    state_txt = json.dumps(
        {
            "raumhoehe_cm": ctx.get("height"),
            "waende": walls,
            "gestaltung": ctx.get("design"),
            "ausgewaehlt": ctx.get("selected"),
        },
        ensure_ascii=False,
    )[:5000]
    user_content = f"[Aktueller Zustand: {state_txt}]\n\n{message}"
    if merged and merged[-1]["role"] == "user":
        merged[-1]["content"] += "\n\n" + user_content
    else:
        merged.append({"role": "user", "content": user_content})

    system = CHAT_SYSTEM_TMPL.format(
        tiles=catalog_brief(),
        patterns=", ".join(f'{p["id"]} ({p["name"]})' for p in CATALOG["patterns"]),
        grouts=", ".join(f'{g["id"]} ({g["name"]})' for g in CATALOG["grouts"]),
        paints=", ".join(f'{p["id"]} ({p["name"]})' for p in CATALOG["paints"]),
        trims=", ".join(f'{t["id"]} ({t["name"]})' for t in CATALOG["trims"]),
        styles=", ".join(f'{s["id"]} ({s["name"]}: {s["blurb"]})' for s in CATALOG["styles"]),
    )
    try:
        client = anthropic.Anthropic(api_key=API_KEY, timeout=60.0, max_retries=1)
        msg = client.messages.create(
            model=CHAT_MODEL, max_tokens=1200, system=system, tools=[CHAT_TOOL], messages=merged
        )
    except Exception as exc:  # noqa: BLE001
        message_txt, status, code = friendly_api_error(exc)
        app.logger.warning("Chat fehlgeschlagen: %s", type(exc).__name__)
        return err(message_txt, status, code)

    reply = " ".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
    ops, view = [], None
    for b in msg.content:
        if getattr(b, "type", "") == "tool_use" and b.name == "apply_changes":
            ops = clean_ops(b.input.get("ops") or [], wall_count)
            view = b.input.get("view")
    return jsonify({"reply": reply or ("Erledigt." if ops else "Dazu habe ich keine Idee."), "ops": ops, "view": view, "mode": "llm"})


# ======================================================================================
# Realistische Ansichten aus dem fertigen Entwurf
# ======================================================================================
RENDER_VIEWS = (
    ("Übersicht", "wide-angle view from just outside the doorway, showing the complete room layout"),
    ("Waschtisch", "eye-level view from the doorway toward the vanity and the far wall"),
    ("Dusche", "eye-level view from a room corner toward the shower and tiled walls"),
)


def _render_surface_text(spec, label):
    if not isinstance(spec, dict):
        return f"{label}: no tile specified"
    tile_id = spec.get("tile")
    tile = TILES.get(tile_id) if isinstance(tile_id, str) else None
    if not tile:
        return f"{label}: no tile specified"
    pattern = next((p for p in CATALOG["patterns"] if p["id"] == spec.get("pattern")), None)
    grout = next((g for g in CATALOG["grouts"] if g["id"] == spec.get("grout")), None)
    size = " x ".join(str(v) for v in tile.get("size", []))
    result = f"{label}: {tile['name']}, {size} cm, {tile.get('finish', 'matt')} finish"
    if pattern:
        result += f", {pattern['name']} layout"
    if grout:
        result += f", {grout['name']} grout"
    return result


def replicate_request(method, path, **kwargs):
    response = requests.request(
        method,
        f"https://api.replicate.com/v1/{path.lstrip('/')}",
        headers={"Authorization": f"Bearer {REPLICATE_TOKEN}"},
        timeout=(8, 45),
        **kwargs,
    )
    try:
        data = response.json()
    except ValueError:
        data = {}
    if not response.ok:
        detail = data.get("detail") or data.get("error") or "Replicate request failed"
        raise RuntimeError(f"Replicate {response.status_code}: {str(detail)[:300]}")
    return data


@app.post("/api/renders")
def api_create_renders():
    if not REPLICATE_TOKEN:
        return err("Bildgenerierung ist noch nicht eingerichtet. Trage REPLICATE_API_TOKEN in .env ein.", 503, "no_replicate")
    if rate_limited(12, 300):
        return err("Zu viele Bildgenerierungen. Bitte warte einige Minuten.", 429, "rate_limit")
    body = request.get_json(silent=True) or {}
    try:
        media, b64 = parse_data_url(body.get("reference", ""))
    except ValueError as exc:
        return err(str(exc), 400, "image")
    if len(b64) > 1_300_000:
        return err("Die Szenenreferenz ist zu groß. Bitte versuche es erneut.", 413, "image_too_large")
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", REPLICATE_MODEL):
        return err("REPLICATE_MODEL muss im Format anbieter/modell angegeben sein.", 500, "replicate_config")

    design = body.get("design")
    if not isinstance(design, dict):
        design = {}
    surfaces = [_render_surface_text(design.get("floor"), "Boden")]
    walls = design.get("walls") if isinstance(design.get("walls"), list) else []
    surfaces.extend(_render_surface_text(wall, f"Wand {index + 1}") for index, wall in enumerate(walls[:8]))
    finish_brief = "; ".join(surfaces)
    reference = f"data:{media};base64,{b64}"
    renders = []
    try:
        for label, view in RENDER_VIEWS:
            prompt = (
                "Create a photorealistic, finished bathroom interior photograph based on the supplied 3D room-plan reference. "
                "Preserve its room proportions, openings, fixture positions, tile colors, tile sizes and tile layout; "
                "do not redesign the room or add fixtures. Convert the open dollhouse cutaway into a complete real interior "
                "with a ceiling, physically plausible materials, soft natural architectural lighting, and realistic camera optics. "
                f"Material schedule: {finish_brief}. Camera: {view}. "
                "No people, no text, no labels, no collage, no UI."
            )
            prediction = replicate_request(
                "POST",
                f"models/{REPLICATE_MODEL}/predictions",
                json={"input": {
                    "prompt": prompt,
                    "image_input": [reference],
                    "aspect_ratio": "4:3",
                    "output_format": "jpg",
                }},
            )
            renders.append({"id": prediction["id"], "view": label, "status": prediction.get("status", "starting")})
    except requests.Timeout:
        app.logger.warning("Replicate prediction creation timed out")
        if not renders:
            return err("Replicate antwortet gerade nicht. Bitte versuche es erneut.", 504, "replicate_timeout")
    except requests.RequestException as exc:
        app.logger.warning("Replicate request failed: %s", type(exc).__name__)
        if not renders:
            return err("Replicate ist gerade nicht erreichbar.", 502, "replicate_network")
    except (RuntimeError, KeyError) as exc:
        app.logger.warning("Replicate rejected a render request: %s", str(exc)[:300])
        if not renders:
            return err("Replicate konnte die Bildgenerierung nicht starten. Prüfe Token, Modell und Abrechnung.", 502, "replicate_request")
    return jsonify({"renders": renders})


@app.get("/api/renders/<prediction_id>")
def api_get_render(prediction_id):
    if not REPLICATE_TOKEN:
        return err("Bildgenerierung ist noch nicht eingerichtet.", 503, "no_replicate")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{8,64}", prediction_id):
        return err("Ungültige Bildgenerierungs-ID.", 400, "render_id")
    try:
        prediction = replicate_request("GET", f"predictions/{prediction_id}")
    except requests.Timeout:
        return err("Die Statusabfrage bei Replicate hat zu lange gedauert.", 504, "replicate_timeout")
    except requests.RequestException as exc:
        app.logger.warning("Replicate status request failed: %s", type(exc).__name__)
        return err("Der Status kann gerade nicht abgerufen werden.", 502, "replicate_network")
    except RuntimeError as exc:
        app.logger.warning("Replicate status failed: %s", str(exc)[:300])
        return err("Der Bildstatus konnte nicht abgerufen werden.", 502, "replicate_request")

    output = prediction.get("output")
    if isinstance(output, str):
        output = [output]
    images = []
    for item in output or []:
        url = item.get("url") if isinstance(item, dict) else item
        if isinstance(url, str) and url.startswith("https://"):
            images.append(url)
    return jsonify({
        "id": prediction_id,
        "status": prediction.get("status", "processing"),
        "images": images,
        "error": str(prediction.get("error") or "")[:300],
    })


def project_path(project_id):
    if not isinstance(project_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,32}", project_id):
        return None
    return PROJECTS_DIR / f"{project_id}.json"


def clean_project_payload(body):
    project = body.get("project")
    if not isinstance(project, dict):
        return None
    room = project.get("room")
    design = project.get("design")
    if not isinstance(design, dict):
        return None
    polygon = room.get("polygon") if isinstance(room, dict) else None
    walls = design.get("walls")
    if not isinstance(polygon, list) or not 3 <= len(polygon) <= 16:
        return None
    if not isinstance(design.get("floor"), dict) or not isinstance(walls, list) or len(walls) != len(polygon):
        return None
    for point in polygon:
        if not isinstance(point, dict):
            return None
        for axis in ("x", "y"):
            value = point.get(axis)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > 5000:
                return None
    surfaces = [design["floor"], *walls]
    for surface in surfaces:
        if not isinstance(surface, dict):
            return None
        tile_id = surface.get("tile")
        if tile_id is not None and (not isinstance(tile_id, str) or tile_id not in TILE_IDS):
            return None
        pattern_id, grout_id = surface.get("pattern"), surface.get("grout")
        if not isinstance(pattern_id, str) or pattern_id not in PATTERN_IDS or not isinstance(grout_id, str) or grout_id not in GROUT_IDS:
            return None
    paint_id, trim_id = design.get("paint"), design.get("trim")
    if not isinstance(paint_id, str) or paint_id not in PAINT_IDS or not isinstance(trim_id, str) or trim_id not in TRIM_IDS:
        return None
    try:
        encoded = json.dumps({"room": room, "design": design}, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError):
        return None
    if len(encoded.encode("utf-8")) > 1_000_000:
        return None
    return {"room": room, "design": design}


@app.post("/api/projects")
def api_save_project():
    if rate_limited(20, 60):
        return err("Zu viele Projekt-Speicherungen. Bitte warte kurz.", 429, "rate_limit")
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return err("Die Projektdaten konnten nicht gelesen werden.", 400, "project")
    clean = clean_project_payload(body)
    if not clean:
        return err("Der Raum oder die Gestaltung ist unvollständig oder ungültig.", 400, "project")

    project_id = body.get("id")
    if project_id:
        path = project_path(project_id)
        if not path or not path.is_file():
            return err("Dieses Projekt wurde nicht gefunden.", 404, "project_not_found")
        try:
            previous = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return err("Das gespeicherte Projekt kann nicht gelesen werden.", 500, "project_storage")
        created_at = previous.get("createdAt")
    else:
        project_id = secrets.token_urlsafe(15)
        path = project_path(project_id)
        created_at = datetime.now(timezone.utc).isoformat()

    name = body.get("name") if isinstance(body.get("name"), str) else ""
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip()[:80] or "Mein Raum"
    updated_at = datetime.now(timezone.utc).isoformat()
    record = {
        "id": project_id,
        "name": name,
        "createdAt": created_at,
        "updatedAt": updated_at,
        **clean,
    }
    try:
        PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_suffix(".tmp")
        temp_path.write_text(json.dumps(record, ensure_ascii=False, allow_nan=False), encoding="utf-8")
        temp_path.replace(path)
    except OSError:
        app.logger.exception("Project could not be persisted")
        return err("Das Projekt konnte auf dem Server nicht gespeichert werden.", 500, "project_storage")
    return jsonify({"id": project_id, "name": name, "createdAt": created_at, "updatedAt": updated_at})


@app.get("/api/projects/<project_id>")
def api_get_project(project_id):
    path = project_path(project_id)
    if not path or not path.is_file():
        return err("Dieses Projekt wurde nicht gefunden.", 404, "project_not_found")
    try:
        return jsonify(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return err("Das gespeicherte Projekt kann nicht gelesen werden.", 500, "project_storage")


@app.get("/p/<project_id>")
def shared_project_page(project_id):
    path = project_path(project_id)
    if not path or not path.is_file():
        return err("Dieses Projekt wurde nicht gefunden.", 404, "project_not_found")
    response = send_from_directory(app.static_folder, "index.html")
    response.headers["Cache-Control"] = "no-cache"
    return response


# ======================================================================================
# Statische Seiten & Status
# ======================================================================================
@app.get("/api/status")
def api_status():
    return jsonify(
        {
            "llm": LLM_READY,
            "sdk": HAVE_SDK,
            "keySet": bool(API_KEY),
            "model": MODEL if LLM_READY else None,
            "replicate": bool(REPLICATE_TOKEN),
            "replicateModel": REPLICATE_MODEL if REPLICATE_TOKEN else None,
        }
    )


@app.get("/api/catalog")
def api_catalog():
    return jsonify(CATALOG)


@app.get("/")
def index():
    resp = send_from_directory(app.static_folder, "index.html")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.after_request
def headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    if request.path.startswith("/static/") and request.path.endswith((".js", ".css")):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


if __name__ == "__main__":
    state = f"KI aktiv ({MODEL})" if LLM_READY else "Demo-Modus (kein API-Key)"
    print(f"\n  Raumgestalter läuft auf http://{HOST}:{PORT}  –  {state}\n")
    app.run(host=HOST, port=PORT, debug=os.getenv("FLASK_DEBUG") == "1")
