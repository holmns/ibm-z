# HazeWise run planner

A dashboard for planning a run. It takes a place, a start time, the run and the runner, and returns a Low, Medium or
High risk level with the reasons, the PM2.5 the run puts in your lungs, and safer start times.

```
npm install
npm run dev      # http://localhost:3000
npm test         # model port checked against the notebooks' outputs
```

`ONEMAP_TOKEN` is optional. OneMap search answers without it.

## Where each part comes from

| Part | Notebook | Code |
|---|---|---|
| Breathing rate (VE) for a pace, profile and history | `calculate-ve.ipynb` | `src/lib/ve.ts`, `src/lib/ve-model.json` |
| Hourly PM2.5 and weather from Open-Meteo | `air-weather-api.ipynb` | `src/lib/openmeteo.ts` |
| PM2.5 dose, day-equivalent PM2.5, risk level, alternatives | `assess-risk.ipynb` | `src/lib/risk.ts`, `src/lib/plan.ts` |
| Heat, UV and rain rules, venue search, nearby venues | `detect.ipynb` | `src/lib/factors.ts`, `src/lib/onemap.ts`, `src/lib/venues.ts` |

The overall level is the worse of the PM2.5 level and the heat, UV and rain level.

`ve-model.json` holds the coefficients `calculate-ve.ipynb` fits in §8, exported at full precision. If the notebook's
model changes, re-export it by running the notebook's code cells and dumping `MODELS`, `BAND`, `RAMP_LAG_KMH` and
`RANGE`. The golden files in `src/lib/__tests__` come from the notebooks' own functions.

## Where the app differs from the notebooks

- Heat, UV and rain are scored at the worst hour the run touches. `detect.ipynb` reads only the hour nearest the start.
- A 50% chance of rain raises the level in `detect.ipynb` without giving a reason. The app shows one.
- Best start per day picks the lowest overall level first, then the lowest dose. `assess-risk.ipynb` picks the lowest
  dose alone, which can land on a noon start with UV 11.
- NParks venues are limited to fitness areas, multipurpose courts and shelters. The nearest features of any class are
  car parks and notice boards. NParks venues are never counted as indoor.
- The indoor guess drops "swimming" and "pool", since ActiveSG pools are outdoor, and adds "sport centre".

## API

- `POST /api/assess` takes the plan and returns the planned run, the hourly forecast, the same run at every start
  from 05:00 to 21:00, and the change options.
- `GET /api/places?q=` searches OneMap.
- `POST /api/venues` scores the planned run at nearby ActiveSG and NParks venues. The data.gov.sg files are cached in
  `.cache/` after the first download.
