"""hazewise_risk.py: activity plan + Open-Meteo conditions -> risk report (JSON-ready, LLM-ready).

    plan (dict, from Gemini)  ->  evaluate_plan(plan, conn)  ->  report (dict)  ->  to_llm_payload(report)

Same style as air-weather-api.ipynb (om_fetch / om_air_quality / om_weather / conditions_timeline), extended with
UV clear-sky and shortwave radiation. Reads activities from hazewise.db (build_activity_db.py).

Four hazards, each scored 0-100 and levelled Low / Medium / High. The report's overall level is the WORST hazard
(binding hazard), never an average:
    pm25   estimated inhaled PM2.5 dose for the session      (activity -> MET -> VO2 -> VE, x PM2.5 x time)
    heat   WBGT estimate + intensity adjustment vs NEA bands  (<31 low, 31-<33 moderate, >=33 high)
    uv     session UV dose / minimal erythema dose (MED) by skin phototype
    storm  rain probability, thunderstorm forecast = hard stop

Everything marked PLACEHOLDER is a tunable guess to be checked against sources or backtest data.
"""
from __future__ import annotations

import json
import math
import re
import sqlite3
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import requests

VERSION = "hazewise-risk-0.1"

# ───────────────────────────── 1. Open-Meteo client (notebook style) ─────────────────────────────
OM_AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
OM_WX_URL = "https://api.open-meteo.com/v1/forecast"

AQ_VARS = ["pm2_5", "pm10", "us_aqi"]
# the notebook's WX_VARS plus uv_index_clear_sky and shortwave_radiation (solar load for heat, worst-case UV)
WX_VARS = ["temperature_2m", "relative_humidity_2m", "apparent_temperature", "precipitation_probability",
           "precipitation", "weather_code", "wind_speed_10m", "wind_gusts_10m", "cloud_cover", "uv_index",
           "uv_index_clear_sky", "shortwave_radiation", "is_day"]


class OpenMeteoError(RuntimeError):
    pass


_cache = {}


def om_fetch(url, lat, lon, variables, **extra):
    # returns (hourly: DataFrame indexed by local time, meta: dict). Hourly only: the window evaluation does not
    # need the `current` block, and it avoids asking `current` for variables it may not support.
    key = (url, round(lat, 3), round(lon, 3), pd.Timestamp.now(tz="UTC").floor("h"))
    if key not in _cache:
        params = dict(latitude=lat, longitude=lon, hourly=",".join(variables), timezone="auto",
                      timeformat="unixtime", **extra)
        r = requests.get(url, params=params, timeout=20)
        body = r.json()
        if r.status_code != 200 or body.get("error"):
            raise OpenMeteoError(body.get("reason", f"HTTP {r.status_code}"))
        tz = ZoneInfo(body["timezone"])
        hourly = pd.DataFrame(body["hourly"])
        hourly.index = pd.to_datetime(hourly.pop("time"), unit="s", utc=True).dt.tz_convert(tz)
        hourly.index.name = "time"
        meta = {f: body[f] for f in ("latitude", "longitude", "timezone", "elevation")}
        _cache[key] = (hourly, meta)
    return _cache[key]


def om_air_quality(lat, lon):
    return om_fetch(OM_AQ_URL, lat, lon, AQ_VARS, forecast_days=7)


def om_weather(lat, lon):
    return om_fetch(OM_WX_URL, lat, lon, WX_VARS, forecast_days=16, wind_speed_unit="ms")


AQI_CATEGORIES = [(50, "Good"), (100, "Moderate"), (150, "Unhealthy for sensitive groups"), (200, "Unhealthy"),
                  (300, "Very unhealthy"), (float("inf"), "Hazardous")]
WMO_CODES = {0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "rime fog",
             51: "light drizzle", 53: "drizzle", 55: "dense drizzle", 61: "slight rain", 63: "moderate rain",
             65: "heavy rain", 80: "slight showers", 81: "showers", 82: "violent showers", 95: "thunderstorm",
             96: "thunderstorm with hail", 99: "thunderstorm with hail"}
AQ_RENAME = {"us_aqi": "aqi_us", "pm2_5": "pm25_ugm3", "pm10": "pm10_ugm3"}
WX_RENAME = {"temperature_2m": "temp_c", "apparent_temperature": "apparent_temp_c", "relative_humidity_2m": "humidity_pct",
             "precipitation_probability": "precip_prob_pct", "precipitation": "precip_mm", "weather_code": "weather_code",
             "wind_speed_10m": "wind_speed_ms", "wind_gusts_10m": "wind_gust_ms", "cloud_cover": "cloud_cover_pct",
             "uv_index": "uv_index", "uv_index_clear_sky": "uv_index_clear_sky", "shortwave_radiation": "shortwave_wm2",
             "is_day": "is_day"}
COLUMNS = ["aqi_us", "aqi_category", "pm25_ugm3", "pm10_ugm3", "weather", "thunderstorm", "temp_c", "apparent_temp_c",
           "humidity_pct", "precip_prob_pct", "precip_mm", "wind_speed_ms", "wind_gust_ms", "cloud_cover_pct",
           "uv_index", "uv_index_clear_sky", "shortwave_wm2", "is_day", "weather_code"]
NOW_WINDOW = pd.Timedelta(minutes=30)


def aqi_category(aqi):
    return None if aqi is None or pd.isna(aqi) else next(name for top, name in AQI_CATEGORIES if aqi <= top)


def conditions_timeline(lat, lon):
    aq, aq_meta = om_air_quality(lat, lon)
    wx, wx_meta = om_weather(lat, lon)
    df = wx.rename(columns=WX_RENAME).join(aq.rename(columns=AQ_RENAME), how="left")
    df["aqi_category"] = df.aqi_us.map(aqi_category)
    df["weather"] = df.weather_code.map(WMO_CODES)
    df["thunderstorm"] = df.weather_code.isin([95, 96, 99])
    df = df[COLUMNS]
    df.attrs = {"timezone": wx_meta["timezone"], "aq_grid": (aq_meta["latitude"], aq_meta["longitude"]),
                "weather_grid": (wx_meta["latitude"], wx_meta["longitude"]),
                "aq_horizon": aq.us_aqi.last_valid_index(), "weather_horizon": wx.index.max()}
    return df


# ───────────────────────────── 2. Activity lookup (SQLite) ─────────────────────────────
def connect_db(path="hazewise.db"):
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    return con


class PlanError(ValueError):
    """The structured plan is incomplete. `.missing` lists what to ask the user for."""

    def __init__(self, missing):
        super().__init__("plan is missing: " + ", ".join(missing))
        self.missing = missing


_STOP = {"a", "an", "the", "at", "in", "on", "for", "to", "of", "and", "or", "my", "some", "do", "go", "play", "doing"}


def search_activities(conn, text, limit=5, exercise_only=True):
    """Free-text fallback (FTS5): 'muay thai class' -> ranked Compendium rows."""
    toks = [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in _STOP]
    if not toks:
        return []
    q = " OR ".join(f"{t}*" if len(t) >= 3 else t for t in toks)
    sql = ("SELECT a.code, a.name, a.met, a.major_heading, a.indoor_only FROM activities_fts f "
           "JOIN activities a ON a.code = f.code WHERE activities_fts MATCH ? "
           + ("AND a.exercise_relevant = 1 " if exercise_only else "") + "ORDER BY bm25(activities_fts) LIMIT ?")
    return [dict(r) for r in conn.execute(sql, (q, limit))]


def family_catalog(conn):
    """Compact list to paste into the Gemini prompt: the model must pick a `family` from here."""
    out = []
    for f in conn.execute("SELECT family, display_name, notes FROM activity_families ORDER BY family"):
        al = [r[0] for r in conn.execute("SELECT alias FROM family_aliases WHERE family=? ORDER BY alias", (f["family"],))]
        out.append({"family": f["family"], "name": f["display_name"], "aliases": al})
    return out


def find_venue(conn, name):
    if not name:
        return None
    n = name.lower().strip()
    for v in conn.execute("SELECT * FROM venues"):
        names = [v["name"].lower()] + [a.strip() for a in (v["aliases"] or "").split(",") if a.strip()]
        if any(n == x or n in x or x in n for x in names):
            return dict(v)
    return None


EFFORT_IDX = {"light": 0, "moderate": 1, "vigorous": 2}
MET_REL_UNC = 0.125      # +/-12.5%: MET uncertainty from the team's summary (10-15%)


def acsm_met(speed_kmh):
    """ACSM walking/running VO2 from speed (level ground): walking 0.1*v + 3.5, running 0.2*v + 3.5 (mL/kg/min)."""
    v = speed_kmh * 1000 / 60
    walk, run = 0.1 * v + 3.5, 0.2 * v + 3.5
    vo2 = walk if v <= 100 else run if v >= 134 else (walk + run) / 2      # 6-8 km/h: mean of both (transition)
    return vo2 / 3.5


def resolve_activity(conn, spec, speed_kmh=None):
    """spec = {family, effort, activity_code, free_text}. Returns MET scenarios + per-family parameters."""
    spec = spec or {}
    notes, row_fam = [], None
    fam = (spec.get("family") or "").lower().strip().replace(" ", "_") or None
    if fam:
        row_fam = conn.execute("SELECT * FROM activity_families WHERE family=?", (fam,)).fetchone()
        if row_fam is None:   # try alias table
            a = conn.execute("SELECT family FROM family_aliases WHERE alias=?", (fam.replace("_", " "),)).fetchone()
            row_fam = conn.execute("SELECT * FROM activity_families WHERE family=?", (a[0],)).fetchone() if a else None
            if row_fam is None:
                notes.append(f"family '{fam}' not in activity_families; fell back to free-text search")
    code = spec.get("activity_code")
    if row_fam is not None and not code:
        idx = EFFORT_IDX.get((spec.get("effort") or "moderate").lower(), 1)
        codes = [row_fam["light_code"], row_fam["moderate_code"], row_fam["vigorous_code"]]
        mets = [conn.execute("SELECT met FROM activities WHERE code=?", (c,)).fetchone()[0] for c in codes]
        out = dict(family=row_fam["family"], display_name=row_fam["display_name"], matched_by="family",
                   met_low=mets[max(idx - 1, 0)], met_typ=mets[idx], met_high=mets[min(idx + 1, 2)],
                   effort_idx=idx, met_source=f"Compendium {codes[idx]} (family {row_fam['family']}, "
                   f"{['light', 'moderate', 'vigorous'][idx]})", ext_frac=row_fam["external_work_frac"],
                   uv_er=(row_fam["uv_er_low"], row_fam["uv_er_high"]), uses_pace=bool(row_fam["uses_pace"]),
                   indoor_only=False, codes=codes)
        if row_fam["uses_pace"] and speed_kmh:
            m = acsm_met(speed_kmh)
            out.update(met_typ=m, met_low=m * (1 - MET_REL_UNC), met_high=m * (1 + MET_REL_UNC), matched_by="family+pace",
                       met_source=f"ACSM equation from pace ({speed_kmh:.1f} km/h)")
        out["notes"] = notes
        return out
    # direct code, or best free-text hit
    row = conn.execute("SELECT * FROM activities WHERE code=?", (code,)).fetchone() if code else None
    by = "code"
    if row is None and spec.get("free_text"):
        hits = search_activities(conn, spec["free_text"], limit=1)
        row = conn.execute("SELECT * FROM activities WHERE code=?", (hits[0]["code"],)).fetchone() if hits else None
        by = "search"
        if row:
            notes.append(f"free-text match '{row['name']}' ({row['code']}): confirm with the user")
    if row is None:
        raise PlanError(["activity (no family, code or searchable text matched)"])
    m = row["met"]
    return dict(family=None, display_name=row["name"], matched_by=by, met_low=m * (1 - MET_REL_UNC), met_typ=m,
                met_high=m * (1 + MET_REL_UNC), effort_idx=1, met_source=f"Compendium {row['code']}",
                ext_frac=0.0, uv_er=(0.2, 0.5), uses_pace=False, indoor_only=bool(row["indoor_only"]),
                codes=[row["code"]], notes=notes + (["activity is flagged indoor-only in the Compendium"]
                                                    if row["indoor_only"] else []))


# ───────────────────────────── 3. Physiology and hazard parameters ─────────────────────────────
VE_PER_VO2 = 28.0        # L air per L O2: median from the team's 981-test treadmill data (summary doc)
VE_REL_ERR = 0.15        # median VO2->VE error ~15% (summary doc): used as optimistic / pessimistic spread


def ve_from_vo2(vo2_l_min, body=None):
    """Replace with the trained VO2 -> VE model later (keep the signature)."""
    return VE_PER_VO2 * vo2_l_min


VE_MODEL = ve_from_vo2

PM25_REF_UGM3 = 15.0     # WHO 2021 24-h guideline
REF_DAILY_AIR_M3 = 20.0  # PLACEHOLDER adult default inhalation; verify against EPA Exposure Factors Handbook
REF_DAY_DOSE_UG = PM25_REF_UGM3 * REF_DAILY_AIR_M3     # 300 ug: what a day of breathing WHO-guideline air delivers

# baseline -> 0, caution -> 33 (Medium starts), limit -> 67 (High starts), cap -> 100
HAZARD_SPECS = {
    "pm25": dict(label="PM2.5 inhaled dose", unit="ug inhaled", baseline=0.0, caution=0.20 * REF_DAY_DOSE_UG,
                 limit=0.40 * REF_DAY_DOSE_UG, cap=1.20 * REF_DAY_DOSE_UG),
    "heat": dict(label="Heat stress", unit="degC WBGT-equivalent", baseline=25.0, caution=31.0, limit=33.0, cap=36.0),
    "uv":   dict(label="UV exposure", unit="x sunburn dose (MED)", baseline=0.0, caution=0.5, limit=1.0, cap=2.0),
    "storm": dict(label="Rain / thunderstorm", unit="% rain probability", baseline=0.0, caution=40.0, limit=70.0, cap=100.0),
}
LEVELS = ["Low", "Medium", "High"]
GROUP_ADJUST = {   # PLACEHOLDER: tighter thresholds for more vulnerable groups (organiser use case)
    "general": dict(pm25_mult=1.0, heat_add_c=0.0),
    "older_adult": dict(pm25_mult=1.33, heat_add_c=1.5),
}
SOLAR_WBGT_C_PER_KWM2 = 5.0   # PLACEHOLDER: WBGT rise per 1 kW/m2 shortwave in full sun. Calibrate vs NEA WBGT stations.
WBGT_EST_UNC_C = 1.0          # PLACEHOLDER +/- band on the WBGT estimate (no globe temperature available)
HEAT_MET_REF = 6.0            # PLACEHOLDER: NEA/SportSG apply the same WBGT bands to sport, so they already describe
                              # typical recreational sport (~6 MET). Only harder activity gets an extra penalty.
HEAT_LOG_SLOPE = 11.5         # degC per decade of metabolic rate: slope of the NIOSH/ISO 7243 acclimatised limit
                              # 56.7 - 11.5*log10(M). Verify.
SHADE_UV_REDUCTION = 0.5      # PLACEHOLDER: share of UV removed at shade=1 (sky UV still reaches you)
MED_MJCM2 = {1: (15, 30), 2: (25, 40), 3: (30, 50), 4: (40, 60), 5: (60, 90), 6: (90, 150)}   # from the heat/UV doc


def stull_wet_bulb(t_c, rh):
    """Stull (2011) wet-bulb from air temp (degC) and RH (%), valid RH 5-99, T -20..50."""
    t, rh = np.asarray(t_c, float), np.asarray(rh, float)
    return (t * np.arctan(0.151977 * np.sqrt(rh + 8.313659)) + np.arctan(t + rh) - np.arctan(rh - 1.676331)
            + 0.00391838 * rh ** 1.5 * np.arctan(0.023101 * rh) - 4.686035)


def wbgt_est(t_c, rh, sw_wm2, shade=0.0):
    """Shade WBGT ~ 0.7*Tw + 0.3*Ta, plus a solar term. No globe thermometer: an estimate, not a measurement."""
    return 0.7 * stull_wet_bulb(t_c, rh) + 0.3 * np.asarray(t_c, float) + \
        SOLAR_WBGT_C_PER_KWM2 * np.asarray(sw_wm2, float) / 1000.0 * (1.0 - shade)


def heat_offset(met, ext_frac=0.0):
    """Extra degC of 'effective WBGT' for activities harder than the reference level."""
    m = max(met * (1.0 - ext_frac), 1e-6)
    return max(0.0, HEAT_LOG_SLOPE * math.log10(m / HEAT_MET_REF))


def uv_dose_sed(uvi, er, dt_s):
    """SED = UVI * 0.025 W/m2 * exposure ratio * seconds / 100 J/m2, summed over the session steps."""
    return float(np.sum(np.asarray(uvi, float)) * 0.025 * er * dt_s / 100.0)


def hazard_score(name, v):
    s = HAZARD_SPECS[name]
    b, c, l, cap = s["baseline"], s["caution"], s["limit"], s["cap"]
    if v <= b:
        return 0.0
    if v < c:
        return 33.3 * (v - b) / (c - b)
    if v < l:
        return 33.3 + 33.4 * (v - c) / (l - c)
    return 66.7 + 33.3 * min(1.0, (v - l) / (cap - l))


def hazard_level(name, v):
    s = HAZARD_SPECS[name]
    return "Low" if v < s["caution"] else "Medium" if v < s["limit"] else "High"


def _scen(name, v):
    return {"value": round(float(v), 2), "score": int(round(hazard_score(name, v))), "level": hazard_level(name, v)}


def build_hazard(name, v_opt, v_typ, v_pess, drivers):
    """Typical-case level and score, plus the optimistic/pessimistic range. If the range spans Low..High the
    level is raised to at least Medium (the 'straddles -> Medium' rule from the team's decision logic)."""
    spec = HAZARD_SPECS[name]
    typ, opt, pess = _scen(name, v_typ), _scen(name, v_opt), _scen(name, v_pess)
    level, score, raised = typ["level"], typ["score"], False
    if opt["level"] == "Low" and pess["level"] == "High" and level == "Low":
        level, score, raised = "Medium", max(score, 34), True
    return {"hazard": name, "label": spec["label"], "available": True, "level": level, "score": score,
            "value": typ["value"], "unit": spec["unit"], "caution_at": round(spec["caution"], 1),
            "high_at": round(spec["limit"], 1),
            "range": {"optimistic": opt, "pessimistic": pess},
            "borderline": opt["level"] != pess["level"], "raised_by_range": raised, "drivers": drivers}


def unavailable(name, why):
    return {"hazard": name, "label": HAZARD_SPECS[name]["label"], "available": False, "level": None, "score": None,
            "reason": why}


# ───────────────────────────── 4. Plan -> normalised plan ─────────────────────────────
PLAN_FIELDS_HELP = """
{
 "activity": {"family": "<from catalog or null>", "effort": "light|moderate|vigorous|null",
              "activity_code": "<5-digit Compendium code or null>", "free_text": "<activity words if no family>"},
 "location": {"name": "East Coast Park", "lat": null, "lon": null},
 "start": "YYYY-MM-DDTHH:MM local time, or 'now'",
 "duration_min": null, "distance_km": null, "pace_min_per_km": null,
 "body": {"weight_kg": null}, "skin_type": null (1-6), "group": "general|older_adult", "shade": 0.0-1.0
}"""


def plan_schema(conn):
    """JSON schema for Gemini structured output (response_schema). family is an enum from the DB."""
    fams = [r[0] for r in conn.execute("SELECT family FROM activity_families ORDER BY family")]
    num = {"type": "number", "nullable": True}
    return {"type": "object", "required": ["activity", "location", "start"], "properties": {
        "activity": {"type": "object", "properties": {
            "family": {"type": "string", "enum": fams, "nullable": True},
            "effort": {"type": "string", "enum": ["light", "moderate", "vigorous"], "nullable": True},
            "activity_code": {"type": "string", "nullable": True},
            "free_text": {"type": "string", "nullable": True}}},
        "location": {"type": "object", "required": ["name"], "properties": {
            "name": {"type": "string"}, "lat": num, "lon": num}},
        "start": {"type": "string"}, "duration_min": num, "distance_km": num, "pace_min_per_km": num,
        "body": {"type": "object", "properties": {"weight_kg": num}},
        "skin_type": {"type": "integer", "nullable": True},
        "group": {"type": "string", "enum": ["general", "older_adult"]},
        "shade": num}}


def normalize_plan(plan, conn):
    missing = []
    a = plan.get("activity") or {}
    if not (a.get("family") or a.get("activity_code") or a.get("free_text")):
        missing.append("activity")
    loc = plan.get("location") or {}
    lat, lon, venue = loc.get("lat"), loc.get("lon"), None
    if lat is None or lon is None:
        v = find_venue(conn, loc.get("name"))
        if v:
            lat, lon, venue = v["lat"], v["lon"], v["name"]
        else:
            missing.append("location (name not in venues table and no lat/lon)")
    dur, dist, pace = plan.get("duration_min"), plan.get("distance_km"), plan.get("pace_min_per_km")
    if dur is None and dist and pace:
        dur = dist * pace
    if pace is None and dist and dur:
        pace = dur / dist
    if dur is None or dur <= 0:
        missing.append("duration (duration_min, or distance_km + pace_min_per_km)")
    if missing:
        raise PlanError(missing)
    assumptions = []
    body = plan.get("body") or {}
    weight = body.get("weight_kg")
    if not weight:
        weight = 70.0
        assumptions.append("body weight not given: assumed 70 kg")
    skin = plan.get("skin_type")
    if skin not in MED_MJCM2:
        skin = 3
        assumptions.append("skin type not given: assumed Fitzpatrick type III (conservative)")
    group = plan.get("group") if plan.get("group") in GROUP_ADJUST else "general"
    return {"activity": a, "venue": venue or loc.get("name"), "lat": float(lat), "lon": float(lon),
            "start": plan.get("start") or "now", "duration_min": float(dur), "distance_km": dist,
            "pace_min_per_km": pace, "speed_kmh": (60.0 / pace if pace else None), "weight_kg": float(weight),
            "skin_type": int(skin), "group": group, "shade": float(min(max(plan.get("shade") or 0.0, 0.0), 1.0)),
            "assumptions": assumptions}


# ───────────────────────────── 5. The evaluation ─────────────────────────────
_EPOCH = pd.Timestamp("1970-01-01", tz="UTC")


def _epoch_s(idx):
    # unit-safe (pandas 3 stores datetimes in us, older versions in ns, so asi8 / 1e9 is not portable)
    return np.asarray((idx - _EPOCH) / pd.Timedelta(seconds=1), dtype=float)


def _interp(tl, col, ts_sec):
    s = tl[col].dropna()
    if s.empty:
        return None
    xs = _epoch_s(s.index)
    if ts_sec[0] < xs[0] or ts_sec[-1] > xs[-1]:
        return None            # window leaves the data (e.g. beyond the air-quality horizon)
    return np.interp(ts_sec, xs, s.to_numpy(float))


def _f(x, nd=1):
    return None if x is None else round(float(x), nd)


def _evaluate(p, conn, tl, now):
    tz = ZoneInfo(tl.attrs["timezone"])
    start = now if p["start"] in (None, "now") else pd.Timestamp(p["start"])
    start = start.tz_localize(tz) if start.tzinfo is None else start.tz_convert(tz)
    if start < now - NOW_WINDOW:
        raise ValueError(f"{start:%Y-%m-%d %H:%M} is in the past; only present and future times are supported")
    end = start + pd.Timedelta(minutes=p["duration_min"])
    if end > tl.attrs["weather_horizon"]:
        raise ValueError(f"session ends {end:%Y-%m-%d %H:%M}, beyond the weather forecast horizon "
                         f"({tl.attrs['weather_horizon']:%Y-%m-%d %H:%M})")

    act = resolve_activity(conn, p["activity"], p["speed_kmh"])
    n = max(2, int(math.ceil(p["duration_min"] / 5)))
    dt_min = p["duration_min"] / n
    mid = start + pd.to_timedelta((np.arange(n) + 0.5) * dt_min, unit="min")
    ts = _epoch_s(mid)
    adj = GROUP_ADJUST[p["group"]]
    notes, limitations = list(p["assumptions"]) + act["notes"], []

    # session window rows (nearest-hour semantics, like the notebook) for discrete fields and the summary
    wrows = tl.loc[(tl.index >= start - NOW_WINDOW) & (tl.index <= end + NOW_WINDOW)]
    lead_h = round((start - now) / pd.Timedelta(hours=1), 1)

    # ---- exposure: MET -> VO2 -> VE
    body = {"weight_kg": p["weight_kg"]}

    def ve_of(met):
        return float(VE_MODEL(met * 3.5 * p["weight_kg"] / 1000.0, body))      # L/min

    ve = {k: ve_of(act[f"met_{k}"]) for k in ("low", "typ", "high")}
    exposure = {"met": {"low": _f(act["met_low"], 2), "typical": _f(act["met_typ"], 2), "high": _f(act["met_high"], 2)},
                "met_source": act["met_source"], "matched_by": act["matched_by"], "activity": act["display_name"],
                "vo2_l_min": _f(act["met_typ"] * 3.5 * p["weight_kg"] / 1000.0, 2),
                "ventilation_l_min": {"low": _f(ve["low"]), "typical": _f(ve["typ"]), "high": _f(ve["high"])},
                "air_inhaled_m3": _f(ve["typ"] * p["duration_min"] / 1000.0, 2), "duration_min": _f(p["duration_min"], 0)}

    hazards = {}
    # ---- PM2.5
    pm = _interp(tl, "pm25_ugm3", ts)
    if pm is None:
        hazards["pm25"] = unavailable("pm25", f"PM2.5 forecast ends {tl.attrs['aq_horizon']:%Y-%m-%d %H:%M}; session is later")
        notes.append("PM2.5 forecast does not cover the session, so that hazard is not scored")
    else:
        pm_mult = adj["pm25_mult"]
        dose = {"opt": float(pm.sum()) * ve["low"] * (1 - VE_REL_ERR) / 1000 * dt_min,
                "typ": float(pm.sum()) * ve["typ"] / 1000 * dt_min,
                "pess": float(pm.sum()) * ve["high"] * (1 + VE_REL_ERR) / 1000 * dt_min}
        hazards["pm25"] = build_hazard("pm25", dose["opt"] * pm_mult, dose["typ"] * pm_mult, dose["pess"] * pm_mult, {
            "pm25_avg_ugm3": _f(pm.mean()), "pm25_peak_ugm3": _f(pm.max()),
            "ventilation_l_min": _f(ve["typ"]), "air_inhaled_m3": exposure["air_inhaled_m3"],
            "inhaled_dose_ug": _f(dose["typ"], 0), "dose_range_ug": [_f(dose["opt"], 0), _f(dose["pess"], 0)],
            "pct_of_who_reference_day_dose": _f(100 * dose["typ"] / REF_DAY_DOSE_UG, 0),
            "group_multiplier": pm_mult})
        exposure["inhaled_dose_ug"] = _f(dose["typ"], 0)
        exposure["pct_of_who_reference_day_dose"] = _f(100 * dose["typ"] / REF_DAY_DOSE_UG, 0)

    # ---- heat
    t, rh, sw = (_interp(tl, c, ts) for c in ("temp_c", "humidity_pct", "shortwave_wm2"))
    w = wbgt_est(t, rh, sw, p["shade"])
    w_peak, w_mean = float(np.max(w)), float(np.mean(w))
    v = {k: w_peak + heat_offset(act[f"met_{k}"], act["ext_frac"]) + adj["heat_add_c"] for k in ("low", "typ", "high")}
    hazards["heat"] = build_hazard("heat", v["low"] - WBGT_EST_UNC_C, v["typ"], v["high"] + WBGT_EST_UNC_C, {
        "wbgt_est_peak_c": _f(w_peak), "wbgt_est_mean_c": _f(w_mean), "intensity_adjustment_c": _f(v["typ"] - w_peak - adj["heat_add_c"]),
        "effective_wbgt_c": _f(v["typ"]), "temp_c_max": _f(t.max()), "humidity_pct_avg": _f(rh.mean(), 0),
        "solar_wm2_max": _f(sw.max(), 0), "nea_bands": "low <31, moderate 31 to <33, high >=33 (WBGT, degC)",
        "group_add_c": adj["heat_add_c"]})

    # ---- UV
    uvi, uvc = _interp(tl, "uv_index", ts), _interp(tl, "uv_index_clear_sky", ts)
    lo_er, hi_er = act["uv_er"]
    sh = 1.0 - SHADE_UV_REDUCTION * p["shade"]
    med_lo, med_hi = (m * 0.1 for m in MED_MJCM2[p["skin_type"]])            # mJ/cm2 -> SED (x10 J/m2 / 100)
    med_mid, dts = (med_lo + med_hi) / 2, dt_min * 60
    sed = {"opt": uv_dose_sed(uvi, lo_er * sh, dts), "typ": uv_dose_sed(uvi, (lo_er + hi_er) / 2 * sh, dts),
           "pess": uv_dose_sed(uvc, hi_er * sh, dts)}
    hazards["uv"] = build_hazard("uv", sed["opt"] / med_hi, sed["typ"] / med_mid, sed["pess"] / med_lo, {
        "uv_index_max": _f(uvi.max()), "uv_index_clear_sky_max": _f(uvc.max()),
        "session_dose_sed": _f(sed["typ"], 2), "dose_range_sed": [_f(sed["opt"], 2), _f(sed["pess"], 2)],
        "burn_dose_sed": _f(med_mid, 1), "skin_type": p["skin_type"], "shade": p["shade"],
        "minutes_to_burn_at_peak": (_f(med_mid / (uvi.max() * 0.025 * (lo_er + hi_er) / 2 * sh) * 100 / 60, 0)
                                    if uvi.max() > 0 else None)})

    # ---- storm
    thunder = bool(wrows.thunderstorm.any())
    pop = float(wrows.precip_prob_pct.max()) if len(wrows) else 0.0
    sv = 100.0 if thunder else pop
    hazards["storm"] = build_hazard("storm", sv, sv, sv, {
        "rain_probability_max_pct": _f(pop, 0), "thunderstorm_forecast": thunder,
        "precip_mm_max": _f(wrows.precip_mm.max()) if len(wrows) else None,
        "wind_gust_max_ms": _f(wrows.wind_gust_ms.max()) if len(wrows) else None,
        "rule": "thunderstorm in the forecast window is a hard stop"})

    # ---- overall: worst hazard, not an average
    avail = [h for h in hazards.values() if h["available"]]
    ranked = sorted(avail, key=lambda h: (LEVELS.index(h["level"]), h["score"]), reverse=True)
    top = ranked[0]
    overall = {"level": top["level"], "score": top["score"], "binding_hazard": top["hazard"],
               "binding_label": top["label"], "borderline": top["borderline"],
               "score_scale": "0-100 index, not a probability. Low 0-33, Medium 33-67, High 67-100",
               "ranking": [{"hazard": h["hazard"], "level": h["level"], "score": h["score"]} for h in ranked]}

    cond = {"requested_start": start.strftime("%Y-%m-%d %H:%M %Z"), "lead_h": lead_h,
            "weather": (wrows.weather.mode().iloc[0] if len(wrows) and wrows.weather.notna().any() else None),
            "aqi_us_max": _f(wrows.aqi_us.max(), 0) if len(wrows) else None,
            "aqi_category_at_max": aqi_category(wrows.aqi_us.max()) if len(wrows) else None,
            "temp_c_avg": _f(t.mean()), "apparent_temp_c_max": _f(wrows.apparent_temp_c.max()) if len(wrows) else None,
            "pm25_ugm3_avg": _f(pm.mean()) if pm is not None else None, "source": "Open-Meteo hourly forecast"}
    limitations += [
        "PM2.5 is a regional CAMS model forecast (~45 km grid), not a park-level reading.",
        "Heat uses an estimated WBGT (no globe thermometer, solar term uncalibrated) plus an intensity adjustment; it does not yet scale with session length.",
        "UV exposure ratios and the PM2.5 / UV thresholds are placeholders pending validation.",
        "Population-level estimates for average healthy adults, not individual medical advice."]
    return {"version": VERSION, "status": "ok",
            "plan": {k: p[k] for k in ("venue", "lat", "lon", "start", "duration_min", "distance_km", "pace_min_per_km",
                                       "weight_kg", "skin_type", "group", "shade")} | {"activity": p["activity"]},
            "overall": overall, "hazards": hazards, "exposure": exposure, "conditions": cond,
            "data_quality": {"lead_h": lead_h, "aq_horizon": str(tl.attrs["aq_horizon"]), "notes": notes},
            "limitations": limitations,
            "disclaimer": "Estimated relative exposure, not medical advice."}


def evaluate_plan(plan, conn, timeline=None, now=None, alternatives=True):
    """plan: dict from the LLM (see PLAN_FIELDS_HELP). timeline: injected for tests, else fetched from Open-Meteo."""
    p = normalize_plan(plan, conn)
    tl = timeline if timeline is not None else conditions_timeline(p["lat"], p["lon"])
    now = now if now is not None else pd.Timestamp.now(tz=ZoneInfo(tl.attrs["timezone"]))
    report = _evaluate(p, conn, tl, now)
    if alternatives:
        report["alternatives"] = suggest_alternatives(p, conn, tl, now, report)
    return report


# ───────────────────────────── 6. Safer alternatives (re-run the same engine) ─────────────────────────────
SENSIBLE_FROM_H, SENSIBLE_UNTIL_H = 5, 22.5     # PLACEHOLDER: only suggest sessions between 05:00 and 22:30


def suggest_alternatives(p, conn, tl, now, base, top_n=4, min_gain=5):
    tz = ZoneInfo(tl.attrs["timezone"])
    start = now if p["start"] in (None, "now") else pd.Timestamp(p["start"])
    start = start.tz_localize(tz) if start.tzinfo is None else start.tz_convert(tz)
    variants = []
    for k in range(-6, 13):                                  # shift start by whole hours, daytime/evening only
        if k:
            c = start + pd.Timedelta(hours=k)
            c_end = c + pd.Timedelta(minutes=p["duration_min"])
            if c.hour < SENSIBLE_FROM_H or c_end > c.normalize() + pd.Timedelta(hours=SENSIBLE_UNTIL_H):
                continue
            variants.append(("shift_time", f"Start at {c:%a %H:%M} instead", {"start": c.strftime("%Y-%m-%dT%H:%M")}, {"start": c.strftime("%Y-%m-%dT%H:%M")}))
    if p["duration_min"] > 20:
        d = max(15.0, round(p["duration_min"] * 0.5 / 5) * 5)
        variants.append(("shorten", f"Shorten to {d:.0f} min", {"duration_min": d}, {"duration_min": d, "distance_km": None}))
    if p["speed_kmh"]:
        pace = p["pace_min_per_km"] / 0.9
        variants.append(("slow_down", f"Slow down ~10% (about {pace:.1f} min/km) for the same time",
                         {"pace_min_per_km": pace, "speed_kmh": 60 / pace}, {"pace_min_per_km": pace, "speed_kmh": 60 / pace}))
    idx = EFFORT_IDX.get((p["activity"].get("effort") or "moderate").lower(), 1)
    if not p["speed_kmh"] and p["activity"].get("family") and idx > 0:
        e = ["light", "moderate", "vigorous"][idx - 1]
        variants.append(("lower_effort", f"Do a {e}-effort version", {"effort": e}, {"activity": {**p["activity"], "effort": e}}))
    out = []
    for kind, label, params, change in variants:
        q = {**p, **change}
        try:
            r = _evaluate(q, conn, tl, now)
        except ValueError:                                   # past, or beyond the forecast horizon
            continue
        gain = base["overall"]["score"] - r["overall"]["score"]
        if gain >= min_gain:
            out.append({"type": kind, "change": label, "params": params, "overall_level": r["overall"]["level"],
                        "overall_score": r["overall"]["score"], "binding_hazard": r["overall"]["binding_hazard"],
                        "score_change": -gain,
                        "inhaled_dose_ug": r["exposure"].get("inhaled_dose_ug")})
    out.sort(key=lambda a: (a["overall_score"], a["type"] != "shift_time"))
    picked, shifts = [], 0
    for a in out:                                            # at most two time shifts, so the list stays varied
        if a["type"] == "shift_time":
            if shifts >= 2:
                continue
            shifts += 1
        picked.append(a)
    return picked[:top_n]


# ───────────────────────────── 7. LLM hand-off ─────────────────────────────
LLM_SYSTEM_PROMPT = """You turn a HazeWise risk report (JSON) into a short plain-language answer for a runner, athlete or event organiser in Singapore.
Rules:
- Use ONLY numbers and facts present in the JSON. Never calculate, estimate or invent values.
- Lead with overall.level and the binding hazard (overall.binding_label), then one reason per hazard that is Medium or High.
- If a hazard has borderline=true, say the result is close to a boundary and could be one level higher or lower.
- Say "estimated inhaled dose" or "relative exposure", never "health risk". The score is an index, not a probability.
- Offer the alternatives from the JSON exactly as given (change, new level, score change). If there are none, say conditions are similar at other times or that no simple change helped.
- If a hazard is unavailable (available=false) or data_quality.notes lists assumptions, mention them briefly.
- End with the disclaimer. Keep it under 150 words. Plain text, no markdown."""

LLM_RESPONSE_SCHEMA = {   # for Gemini response_schema / structured output
    "type": "object",
    "required": ["headline", "risk_level", "summary", "reasons", "recommendations", "caveat"],
    "properties": {
        "headline": {"type": "string"}, "risk_level": {"type": "string", "enum": LEVELS},
        "summary": {"type": "string"},
        "reasons": {"type": "array", "items": {"type": "object", "required": ["hazard", "text"], "properties": {
            "hazard": {"type": "string", "enum": ["pm25", "heat", "uv", "storm"]}, "text": {"type": "string"}}}},
        "recommendations": {"type": "array", "items": {"type": "string"}},
        "caveat": {"type": "string"}}}


def to_llm_payload(report):
    """Trim the report to what the LLM needs (drop plan internals and per-scenario detail)."""
    def hz(h):
        if not h["available"]:
            return {"available": False, "reason": h["reason"]}
        d = {"level": h["level"], "score": h["score"], "borderline": h["borderline"],
             "level_if_optimistic": h["range"]["optimistic"]["level"], "level_if_pessimistic": h["range"]["pessimistic"]["level"]}
        d.update(h["drivers"])
        return d
    return {"overall": {k: report["overall"][k] for k in ("level", "score", "binding_hazard", "binding_label", "borderline", "score_scale")},
            "plan": {k: report["plan"][k] for k in ("venue", "start", "duration_min", "group")}
            | {"activity": report["exposure"]["activity"]},
            "hazards": {k: hz(h) for k, h in report["hazards"].items()},
            "exposure": {k: report["exposure"][k] for k in ("ventilation_l_min", "air_inhaled_m3", "inhaled_dose_ug",
                                                            "pct_of_who_reference_day_dose") if k in report["exposure"]},
            "conditions": report["conditions"], "alternatives": report.get("alternatives", []),
            "data_quality": report["data_quality"], "disclaimer": report["disclaimer"]}


if __name__ == "__main__":      # live run (needs internet): python hazewise_risk.py sample_plan.json hazewise.db
    import sys
    plan = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "sample_plan.json"))
    con = connect_db(sys.argv[2] if len(sys.argv) > 2 else "hazewise.db")
    try:
        rep = evaluate_plan(plan, con)
    except PlanError as e:
        sys.exit(f"Ask the user for: {e.missing}")
    print(json.dumps(to_llm_payload(rep), indent=2, default=str))
