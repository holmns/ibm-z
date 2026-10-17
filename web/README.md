# HazeWise run and activity planner

A dashboard for planning a run, or any other outdoor activity. It takes a place, a start time, the activity and the
person, and returns a Low, Medium or High risk level with the reasons, the PM2.5 the session puts in your lungs, and
safer start times.

```
npm install
cp .env.example .env   # then paste your OpenRouter key into OPENROUTER_API_KEY
npm run dev            # http://localhost:3000
npm test               # model ports checked against the notebooks' outputs
```

Needs Node 22.13 or later, for the built-in `node:sqlite` that reads `../hazewise.db`.

The activity box takes plain words ("badminton doubles for 90 min", "Muay Thai class", "10 km run tonight at 8pm at
7:00/km"). The whole text is embedded with `openai/text-embedding-3-large` through OpenRouter and matched to the
closest Compendium description by cosine similarity (`activities.embedding`). Rows within 0.06 of the closest count
as ties: a family row (badminton, cycling, ...) wins them, so the intensity can be switched, and otherwise the row
whose effort matches the text's intensity, or moderate ("kayaking" -> Kayaking, moderate effort). Keyword rules read the duration, distance, pace,
start time and intensity words. Any row under Running goes to the pace model, never its MET; anything else to the MET
model. Below 0.35 similarity the text says "Activity not found" and still shows the forecast; below 0.45 the match
comes with a note to check it. `ONEMAP_TOKEN` is optional. OneMap search answers without it.

## Where each part comes from

| Part | Notebook | Code |
|---|---|---|
| Breathing rate (VE) for a pace, profile and history | `calculate-ve.ipynb` | `src/lib/ve.ts`, `src/lib/ve-model.json` |
| VE for other activities: MET → VO2 → VE | `calculate-ve-others.ipynb` | `src/lib/ve-others.ts`, `src/lib/ve-others-model.json` |
| Activity lookup in `hazewise.db` (embedding search, families) | (app only) | `src/lib/activities.ts`, `src/lib/embed.ts` |
| Free text → activity, intensity, duration, start | (app only) | `src/lib/parse.ts`, `src/lib/lookup.ts` |
| Summary under the risk title | (app only) | `src/lib/summary.ts`, `src/components/verdict.tsx` |
| Hourly weather from Open-Meteo | `air-weather-api.ipynb` | `src/lib/openmeteo.ts` |
| Hourly PM2.5 from Google's Air Quality API, CAMS as fallback; NEA's PSI | (app only) | `src/lib/googleaq.ts`, `src/lib/conditions.ts`, `src/lib/nea.ts` |
| PM2.5 dose, day-equivalent PM2.5, risk level, alternatives | `assess-risk.ipynb` | `src/lib/risk.ts`, `src/lib/plan.ts` |
| Heat, UV and rain rules, venue search, nearby venues | `detect.ipynb` | `src/lib/factors.ts`, `src/lib/onemap.ts`, `src/lib/venues.ts` |
| PM2.5 heat map under the nearby venues | (app only) | `src/lib/airmap.ts`, `src/lib/aqtiles.ts`, `src/components/air-map.tsx` |

The overall level is the worse of the PM2.5 level and the heat, UV and rain level.

`ve-model.json` holds the coefficients `calculate-ve.ipynb` fits in §8, exported at full precision. If the notebook's
model changes, re-export it by running the notebook's code cells and dumping `MODELS`, `BAND`, `RAMP_LAG_KMH` and
`RANGE`. `ve-others-model.json` and `__tests__/ve-others.golden.json` are written by `calculate-ve-others.ipynb` §9
when it runs. The golden files in `src/lib/__tests__` come from the notebooks' own functions.

## Where the app differs from the notebooks

- PM2.5 comes from Google's Air Quality API (`GOOGLE_MAPS_API_KEY`): the hours since midnight, now, and 96 hours
  ahead. The notebooks use Open-Meteo's CAMS forecast, which read about a third of NEA's level in the October 2026
  haze; the app falls back to it, with a warning, if Google fails. Google's forecast eases back to a global model about
  10 hours out, so a plan more than 12 hours away gets a haze warning while NEA's PSI is above 100 or PM2.5 is above
  55 µg/m³. Each assessment costs 3 Google calls plus up to 3 per nearby venue (free up to 10,000 a month).
- The rest of the day is set as hours outdoors besides the session (0 to 24, half-hour steps), spread evenly over the
  day, with indoor time counted as clean air. `assess-risk.ipynb` takes `INDOOR_RATIO`, a share of outdoor PM2.5.
- The app finds the activity by embedding search. `calculate-ve-others.ipynb` §2 still matches aliases, family names
  and full-text search, so the two can pick different rows for the same text.
- Heat, UV and rain are scored at the worst hour the run touches. `detect.ipynb` reads only the hour nearest the start.
- A 50% chance of rain raises the level in `detect.ipynb` without giving a reason. The app shows one.
- Best start per day picks the lowest overall level first, then the lowest dose. `assess-risk.ipynb` picks the lowest
  dose alone, which can land on a noon start with UV 11.
- NParks venues are limited to fitness areas, multipurpose courts and shelters. The nearest features of any class are
  car parks and notice boards. NParks venues are never counted as indoor.
- The nearby-venues card has a Google Map with Google's PM2.5 heat map for the current hour and a pin per venue at its
  level for your start time. Google's terms require their Air Quality tiles on a Google Map, which needs a browser key
  (`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`); without one the card shows the list only. Google publishes no scale for the
  PM2.5 palette, so the legend's colours are tile pixels read where `currentConditions` gave the PM2.5, from 4 µg/m³
  (Sydney) to 311 (Palangka Raya) on 17 Oct 2026. The tiles have faint seams where Google renders neighbouring tiles
  apart.
- The indoor guess drops "swimming" and "pool", since ActiveSG pools are outdoor, and adds "sport centre".

## API

- `POST /api/activity` takes `{ text }` and returns what the text says (intensity, minutes, distance, pace, start), the
  database match (`run`, `activity` with its Compendium code and MET, or `not-found`) and the closest row's cosine
  `similarity`. Without `OPENROUTER_API_KEY` it answers 503; if OpenRouter fails, 502.
- `POST /api/assess` takes the plan and returns the planned session, the hourly forecast, the same session at every
  start from 05:00 to 21:00, and the change options. A plan is a run (`pace`, `distanceKm`) or an activity
  (`kind: "activity"`, `code` or `family` + `intensity`, `minutes`). An activity with no match returns `found: false`
  with the forecast only.
- `POST /api/summary` takes `{ facts }`, the figures the verdict card shows, and returns `{ summary }`: one or two
  sentences from an open-weight model on OpenRouter (`deepseek/deepseek-v4.1-flash`, or `SUMMARY_MODEL`). The model
  only rephrases those facts. If it fails, the card shows its plain "Raised by" line instead.
- `GET /api/places?q=` searches OneMap.
- `POST /api/venues` scores the planned run at nearby ActiveSG and NParks venues. The data.gov.sg files are cached in
  `.cache/` after the first download.
- `GET /api/aq-tiles/{z}/{x}/{y}` returns one of Google's PM2.5 heatmap tiles (`PM25_INDIGO_PERSIAN`, the current
  hour) as a PNG. It serves only zooms 10 to 12 over Singapore, Johor's south and Batam (177 tiles), and keeps each
  until the clock hour turns, which is as long as Google allows. Closer in, the map enlarges the zoom-12 tile.
