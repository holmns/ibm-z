# HazeWise run and activity planner

A dashboard for planning a run, or any other outdoor activity. It takes a place, a start time, the activity and the
person, and returns a Low, Medium or High risk level with the reasons, the PM2.5 the session puts in your lungs, and
safer start times.

```
npm install
cp .env.example .env   # then paste your Gemini key into GEMINI_API_KEY
npm run dev            # http://localhost:3000
npm test               # model ports checked against the notebooks' outputs
```

Needs Node 22.13 or later, for the built-in `node:sqlite` that reads `../hazewise.db`.

The activity box takes plain words ("badminton doubles for 90 min", "Muay Thai class", "10 km run tonight at 8pm at
7:00/km"). Gemini reads them when `GEMINI_API_KEY` is set; otherwise keyword rules do. Either way the activity and its
MET come from the database. Running goes to the pace model; anything else to the MET model; text that matches nothing
says "Activity not found" and still shows the forecast. `ONEMAP_TOKEN` is optional. OneMap search answers without it.

## Where each part comes from

| Part | Notebook | Code |
|---|---|---|
| Breathing rate (VE) for a pace, profile and history | `calculate-ve.ipynb` | `src/lib/ve.ts`, `src/lib/ve-model.json` |
| VE for other activities: MET → VO2 → VE | `calculate-ve-others.ipynb` | `src/lib/ve-others.ts`, `src/lib/ve-others-model.json` |
| Activity lookup in `hazewise.db` (alias, family, full-text search) | `calculate-ve-others.ipynb` §2 | `src/lib/activities.ts` |
| Free text → activity, intensity, duration, start | (app only) | `src/lib/llm.ts` (Gemini), `src/lib/parse.ts` (fallback), `src/lib/lookup.ts` |
| Hourly PM2.5 and weather from Open-Meteo | `air-weather-api.ipynb` | `src/lib/openmeteo.ts` |
| PM2.5 dose, day-equivalent PM2.5, risk level, alternatives | `assess-risk.ipynb` | `src/lib/risk.ts`, `src/lib/plan.ts` |
| Heat, UV and rain rules, venue search, nearby venues | `detect.ipynb` | `src/lib/factors.ts`, `src/lib/onemap.ts`, `src/lib/venues.ts` |

The overall level is the worse of the PM2.5 level and the heat, UV and rain level.

`ve-model.json` holds the coefficients `calculate-ve.ipynb` fits in §8, exported at full precision. If the notebook's
model changes, re-export it by running the notebook's code cells and dumping `MODELS`, `BAND`, `RAMP_LAG_KMH` and
`RANGE`. `ve-others-model.json` and `__tests__/ve-others.golden.json` are written by `calculate-ve-others.ipynb` §9
when it runs. The golden files in `src/lib/__tests__` come from the notebooks' own functions.

## Where the app differs from the notebooks

- Heat, UV and rain are scored at the worst hour the run touches. `detect.ipynb` reads only the hour nearest the start.
- A 50% chance of rain raises the level in `detect.ipynb` without giving a reason. The app shows one.
- Best start per day picks the lowest overall level first, then the lowest dose. `assess-risk.ipynb` picks the lowest
  dose alone, which can land on a noon start with UV 11.
- NParks venues are limited to fitness areas, multipurpose courts and shelters. The nearest features of any class are
  car parks and notice boards. NParks venues are never counted as indoor.
- The indoor guess drops "swimming" and "pool", since ActiveSG pools are outdoor, and adds "sport centre".

## API

- `POST /api/activity` takes `{ text }` and returns what the text says (activity, intensity, minutes, distance, pace,
  start) and the database match: `run`, `activity` with its Compendium code and MET, or `not-found`.
- `POST /api/assess` takes the plan and returns the planned session, the hourly forecast, the same session at every
  start from 05:00 to 21:00, and the change options. A plan is a run (`pace`, `distanceKm`) or an activity
  (`kind: "activity"`, `code` or `family` + `intensity`, `minutes`). An activity with no match returns `found: false`
  with the forecast only.
- `GET /api/places?q=` searches OneMap.
- `POST /api/venues` scores the planned run at nearby ActiveSG and NParks venues. The data.gov.sg files are cached in
  `.cache/` after the first download.
