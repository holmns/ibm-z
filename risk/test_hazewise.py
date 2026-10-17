"""Offline tests: python test_hazewise.py   (needs hazewise.db from build_activity_db.py)

Open-Meteo is not called. `synthetic_timeline` builds an hourly DataFrame with the same columns and attrs as
conditions_timeline(), so every code path after the API call is exercised.
"""
import json
import sqlite3
import sys

import numpy as np
import pandas as pd

import hazewise_risk as hz

TZ = "Asia/Singapore"
NOW = pd.Timestamp("2026-10-17 14:00", tz=TZ)


def synthetic_timeline(pm25=15.0, tmax=32.0, tmin=26.0, rh_day=65, rh_night=88, cloud=0.2, peak_sw=950.0,
                       peak_uv=12.0, pop=10.0, thunder_hours=(), aq_hours=108):
    idx = pd.date_range("2026-10-17 00:00", periods=16 * 24, freq="h", tz=TZ)
    h = idx.hour + idx.minute / 60
    sun = np.clip(np.sin(np.pi * (h - 6.8) / 12.2), 0, None)                      # 0 at night, 1 at ~12:55
    temp_shape = np.exp(-((h - 14.5) ** 2) / (2 * 3.8 ** 2))
    df = pd.DataFrame(index=idx)
    df["temp_c"] = tmin + (tmax - tmin) * temp_shape
    df["humidity_pct"] = rh_night + (rh_day - rh_night) * temp_shape
    df["shortwave_wm2"] = peak_sw * sun * (1 - 0.7 * cloud)
    df["uv_index_clear_sky"] = peak_uv * sun
    df["uv_index"] = df.uv_index_clear_sky * (1 - 0.6 * cloud)
    df["pm25_ugm3"] = pm25 if np.isscalar(pm25) else np.resize(pm25, len(idx))
    df["pm10_ugm3"] = df.pm25_ugm3 * 1.1
    df["aqi_us"] = (df.pm25_ugm3 * 3).clip(upper=300)
    df["aqi_category"] = df.aqi_us.map(hz.aqi_category)
    df["apparent_temp_c"] = df.temp_c + 4
    df["precip_prob_pct"] = pop
    df["precip_mm"] = 0.0
    df["wind_speed_ms"], df["wind_gust_ms"], df["cloud_cover_pct"] = 2.0, 5.0, cloud * 100
    df["is_day"] = (sun > 0).astype(int)
    df["weather_code"] = 2
    for t in thunder_hours:
        df.loc[pd.Timestamp(t, tz=TZ), "weather_code"] = 95
    df["weather"] = df.weather_code.map(hz.WMO_CODES)
    df["thunderstorm"] = df.weather_code.isin([95, 96, 99])
    aq_end = idx[0] + pd.Timedelta(hours=aq_hours)
    df.loc[df.index > aq_end, ["pm25_ugm3", "pm10_ugm3", "aqi_us"]] = np.nan
    df["aqi_category"] = df.aqi_us.map(hz.aqi_category)
    df.attrs = {"timezone": TZ, "aq_grid": (1.3, 103.9), "weather_grid": (1.3, 103.86),
                "aq_horizon": df.aqi_us.last_valid_index(), "weather_horizon": df.index.max()}
    return df[hz.COLUMNS]


def plan(family="running", start="2026-10-17T20:00", **kw):
    p = {"activity": {"family": family, "effort": None}, "location": {"name": "East Coast Park"}, "start": start,
         "duration_min": None, "distance_km": 10, "pace_min_per_km": 7, "body": {"weight_kg": 70}, "skin_type": 4}
    p.update(kw)
    return p


def run(con, tl, **kw):
    return hz.evaluate_plan(plan(**kw), con, timeline=tl, now=NOW, alternatives=kw.pop("alt", False))


def main():
    con = hz.connect_db("hazewise.db")

    # ---- physiology and formulas vs the team's worked examples
    assert abs(hz.acsm_met(60 / 7) - 9.17) < 0.02                       # 143 m/min -> 32.1 mL/kg/min -> 9.2 METs
    ve = hz.ve_from_vo2(9.17 * 3.5 * 70 / 1000)
    assert 60 <= ve <= 66, ve                                           # summary doc: VE about 60 L/min
    assert abs(hz.uv_dose_sed([10] * 70, 0.5, 60) - 5.25) < 0.01        # doc example: UVI 10, ER 0.5, 70 min = 5.3 SED
    assert abs(float(hz.stull_wet_bulb(20, 50)) - 13.7) < 0.1           # Stull (2011) published check value
    assert hz.hazard_level("heat", 30.9) == "Low" and hz.hazard_level("heat", 31) == "Medium" and hz.hazard_level("heat", 33) == "High"
    sc = [hz.hazard_score("pm25", v) for v in np.linspace(0, 500, 60)]
    assert all(b >= a for a, b in zip(sc, sc[1:])) and sc[0] == 0 and sc[-1] == 100
    assert hz.heat_offset(3.0) == 0 and 1.5 < hz.heat_offset(9.2) < 3 and hz.heat_offset(9.2, 0.2) < hz.heat_offset(9.2)

    # ---- DB lookups
    assert hz.search_activities(con, "muay thai class")[0]["code"] == "15430"
    assert hz.search_activities(con, "jogging")[0]["name"].lower().startswith("jog")
    r = hz.resolve_activity(con, {"family": "futsal"})                  # alias, not a family name
    assert r["family"] == "soccer" and r["met_typ"] == 7.0, r
    r = hz.resolve_activity(con, {"family": "running", "effort": "vigorous"})
    assert (r["met_low"], r["met_typ"], r["met_high"]) == (9.3, 11.8, 11.8)
    r = hz.resolve_activity(con, {"free_text": "stationary bike spin class"})
    assert r["matched_by"] == "search" and r["notes"]

    # ---- scenarios
    clean_night = run(con, synthetic_timeline(pm25=10, pop=10), start="2026-10-17T20:00")
    assert clean_night["overall"]["level"] == "Low", clean_night["overall"]

    hazy_evening = run(con, synthetic_timeline(pm25=56.2, tmax=30, rh_day=75), start="2026-10-17T20:00")
    assert hazy_evening["overall"]["binding_hazard"] == "pm25" and hazy_evening["overall"]["level"] == "High"
    assert 230 < hazy_evening["exposure"]["inhaled_dose_ug"] < 260      # ~63 L/min x 70 min x 56 ug/m3

    hot_noon = run(con, synthetic_timeline(pm25=8, tmax=34, rh_day=62), start="2026-10-18T12:00")
    assert hot_noon["hazards"]["heat"]["level"] == "High" and hot_noon["hazards"]["uv"]["level"] in ("Medium", "High")
    assert hot_noon["overall"]["level"] == "High"
    shaded = run(con, synthetic_timeline(pm25=8, tmax=34, rh_day=62), start="2026-10-18T12:00", shade=1.0)
    assert shaded["hazards"]["heat"]["score"] < hot_noon["hazards"]["heat"]["score"]
    assert shaded["hazards"]["uv"]["score"] < hot_noon["hazards"]["uv"]["score"]

    storm = run(con, synthetic_timeline(pm25=8, thunder_hours=["2026-10-17 20:00"]), start="2026-10-17T20:00")
    assert storm["overall"]["binding_hazard"] == "storm" and storm["overall"]["level"] == "High"

    walk = run(con, synthetic_timeline(pm25=30), family="walking", start="2026-10-17T20:00", distance_km=None,
               pace_min_per_km=None, duration_min=60)
    run_same = run(con, synthetic_timeline(pm25=30), start="2026-10-17T20:00", distance_km=None, pace_min_per_km=None, duration_min=60)
    assert walk["exposure"]["inhaled_dose_ug"] < run_same["exposure"]["inhaled_dose_ug"] / 2

    elder = run(con, synthetic_timeline(pm25=25), family="walking", start="2026-10-17T20:00", distance_km=None,
                pace_min_per_km=None, duration_min=60, group="older_adult")
    gen = run(con, synthetic_timeline(pm25=25), family="walking", start="2026-10-17T20:00", distance_km=None,
              pace_min_per_km=None, duration_min=60)
    assert elder["hazards"]["pm25"]["score"] > gen["hazards"]["pm25"]["score"]

    # ---- horizons and bad input
    far = run(con, synthetic_timeline(), start="2026-10-23T07:00")      # day 6: past the 4.5-day air-quality horizon
    assert far["hazards"]["pm25"]["available"] is False and far["hazards"]["heat"]["available"]
    for bad_start in ("2026-10-16T08:00", "2026-11-05T08:00"):
        try:
            run(con, synthetic_timeline(), start=bad_start)
            raise AssertionError("expected ValueError")
        except ValueError as e:
            assert not isinstance(e, hz.PlanError)
    for bad in (dict(distance_km=None, pace_min_per_km=None), dict(location={"name": "Narnia"})):
        try:
            run(con, synthetic_timeline(), **bad)
            raise AssertionError("expected PlanError")
        except hz.PlanError as e:
            print("PlanError ->", e.missing)

    # ---- alternatives: hazy evening should find a better start time or a shorter session
    rep = hz.evaluate_plan(plan(), con, timeline=synthetic_timeline(pm25=np.r_[np.full(19, 30.0), np.full(5, 56.2)] , tmax=30),
                           now=NOW, alternatives=True)
    alts = rep["alternatives"]
    assert alts and all(a["score_change"] < 0 for a in alts), alts
    print("alternatives:", [(a["change"], a["overall_score"]) for a in alts])

    # ---- JSON-safe, and LLM payload contains no NaN
    payload = hz.to_llm_payload(rep)
    s = json.dumps(payload, default=str)
    assert "NaN" not in s
    print("all tests pass")
    return rep


if __name__ == "__main__":
    rep = main()
    if "--write-samples" in sys.argv:       # synthetic conditions: for showing the output shape only
        json.dump(rep, open("sample_report_offline.json", "w"), indent=2, default=str)
        json.dump(hz.to_llm_payload(rep), open("sample_llm_payload_offline.json", "w"), indent=2, default=str)
        print("wrote sample_report_offline.json, sample_llm_payload_offline.json")
