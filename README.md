# HazeWise

HazeWise tells someone in Singapore how much PM2.5 a planned outdoor session will put in their lungs, and whether to
go. You type a plan ("10 km run at East Coast Park tonight at 8pm at 7:00/km", "badminton doubles for 90 min"). It
estimates how hard you'll breathe, multiplies that by the hourly PM2.5 forecast, and returns Low, Medium or High with
the reasons, safer start times and nearby venues.

PM2.5 forecasts alone miss the body's side of the dose. A runner moves five to six times the air of someone sitting, so
the same 55 µg/m³ is a very different exposure.

Everything runs on one IBM LinuxONE VM (s390x). The data exploration and model training in the notebooks ran there in
JupyterLab, and the same VM serves the web app.

## How a plan becomes a risk level

1. **Activity.** The text is embedded (`text-embedding-3-large`) and matched to the closest of 1,111 activities in
   the 2024 Compendium of Physical Activities. Keyword rules read distance, pace, minutes and start time.
2. **Breathing (VE, L/min).** Runs go through a pace model. Everything else goes MET → VO2 = MET × 3.5 × kg → VE.
3. **Dose.** Hourly PM2.5 × VE × minutes gives micrograms inhaled. The rest of the day is added at the EPA's
   daily air volume for the person's age, with time indoors counted as clean air.
4. **Level.** Day dose ÷ daily air volume gives a day-equivalent PM2.5, scored against the WHO 2021 24-hour tiers.
   Heat, UV and rain are scored separately, and the worse of the two levels wins.
5. **Options.** The same session at every start from 05:00 to 21:00, a shorter and an easier version, and up to six
   nearby ActiveSG and NParks venues. A Google Map shows them over the current PM2.5 heat map.

## Data

| Source                                                                                                                                        | Used for                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Málaga treadmill tests](https://physionet.org/content/treadmill-exercise-cardioresp/1.0.1/) (PhysioNet), 992 tests, 857 people, 575k breaths | fitting every VE model                                                        |
| 2024 Compendium of Physical Activities, in `hazewise.db`                                                                                      | MET per activity, 18 families with light/moderate/vigorous codes, 118 aliases |
| Google Air Quality API                                                                                                                        | hourly PM2.5 (history, now, 96 h ahead) and the heat map tiles                |
| Open-Meteo                                                                                                                                    | weather, UV, rain; CAMS PM2.5 as the fallback                                 |
| data.gov.sg                                                                                                                                   | NEA's PSI, SportSG and NParks venues                                          |
| OneMap                                                                                                                                        | place search                                                                  |
| US EPA Exposure Factors Handbook 2011, WHO 2021, NEA                                                                                          | daily air volume by age, 24-hour PM2.5 tiers, 1-hour bands                    |

The treadmill data's license doesn't allow redistribution, so `data/**/*.csv` is git-ignored. Download it into
`data/` to rerun the notebooks.

## Findings

From `explore.ipynb`

- **Speed drives breathing** (Spearman ρ 0.92). The median person breathes 26 L/min walking at 5 km/h, 60 at 10 km/h,
  73 at 12 and 108 at 16.
- **People differ by about ±12% at the same speed**, and fitness is most of it. At 12 km/h the least fit third breathes
  18% more than the fittest third.
- **Heart rate helps less than expected.** VE spreads wider at a fixed HR than at a fixed speed, because fitter people
  move more air per beat. Adding HR to speed and profile only cuts median error from 11.9% to 11.0%.
- **The ACSM pace equations overshoot** VE by 12 to 25% on this data, so the app uses a fitted formula instead.
- **Pace barely matters for a fixed distance.** Air per km is about 360 L at 9 to 12 km/h, since faster running
  shortens the session about as much as it raises VE. Walking it saves about 18%.
- **Timing beats slowing down** (`assess-risk.ipynb`). At any steady PM2.5 a run adds about 20% to the day's dose, so
  the hour's PM2.5 sets the risk. A cleaner start time is the change that moves the level.

## Models

All are ordinary least squares on log VE with hinge terms, back-transformed with Duan smearing, and cross-validated
5-fold with each person entirely in train or test. Gradient boosting did no better on inputs an app can have, so the
formulas ship as a few coefficients in `web/src/lib/*.json`. Tests check the TypeScript port against the notebooks'
own outputs.

| Model            | Inputs                                                   | Median error      | 80% band     |
| ---------------- | -------------------------------------------------------- | ----------------- | ------------ |
| Run A            | speed, age, sex, weight, height                          | 11.2%             | −20% to +19% |
| Run B            | A + peak speed from a recent race (Riegel, then ÷ 0.876) | 9.8%              | −17% to +16% |
| Run C            | A + average HR at the planned pace from recent runs      | 10.8%             | −17% to +17% |
| Other activities | Compendium MET → VO2, plus profile                       | 12.2% for running | −28% to +35% |

The run errors come from 116 people who did two or more tests, with one test standing in as history for the other.
Notebooks are `calculate-ve.ipynb` (A, B, C) and `calculate-ve-others.ipynb` (MET route). The sport band adds an
assumed ±25% MET spread to the measured running error, since the lab only has running.

**Risk levels** (`assess-risk.ipynb`):

| Level  | General                     | Vulnerable (also uses the band's upper VE) |
| ------ | --------------------------- | ------------------------------------------ |
| Low    | under 37.5 µg/m³ (WHO IT-3) | under 25                                   |
| Medium | 37.5 to 75                  | 25 to 50                                   |
| High   | 75 and up (above IT-1)      | 50 and up                                  |

Heat, UV and rain are read at the worst hour the session touches. Apparent temperature of 32 °C is Medium and 35 °C
High. UV 6 or a 50% chance of rain is Medium, and only UV 8+ together with a 70%+ chance of rain is High.

## Decisions

- **Day-equivalent dose, not the EPA hazard quotient.** The EPA recipe weights hours, not air, and compares one
  session with annual limits. The dose keeps the hazard-quotient idea and swaps time for
  air.
- **High starts at haze levels.** Tainio et al. 2016 found that the benefit of exercise outweighs PM2.5 harm at 22 µg/m³
  even for extreme amounts of activity, so a normal day should read as a day to go out.
- **No NEA 1-hour override.** Any forecast hour over 150 µg/m³ used to force High, which showed a 10-minute session as
  High next to 4 µg/m³. The level now comes from the day dose alone.
- **A race time over heart rate.** Model B beats A by 10% on real repeat tests. HR on top of peak speed made it worse,
  because history HR is about 7 bpm off the day's value.
- **No language model in the arithmetic.** Embedding search picks a Compendium row, and the MET comes from the
  database. An open-weight model (DeepSeek V4.1 Flash) only rephrases the card's own figures as a summary. Under 0.35
  similarity the app says "Activity not found" and still shows the forecast.
- **Google for PM2.5, CAMS as fallback.** Google starts from monitoring stations and follows NEA in haze. Plans more
  than 12 hours out get a haze warning while PSI is above 100 or PM2.5 is above 55 µg/m³.
- **Heat map on a Google Map.** Google's terms require it, so the page loads the Maps JavaScript API with its own
  restricted browser key. The server fetches tiles with a separate key and caches each for up to an hour, as Google
  allows. Google publishes no scale for its PM2.5 palette, so the legend was calibrated against 19 readings from
  4 to 311 µg/m³.
- **Only the web build happens off the VM.** Next.js has no s390x compiler, so a Mac builds a standalone JavaScript
  bundle and the LinuxONE VM runs it in Docker behind nginx. See [web/README.md](web/README.md#deploying).

## Limits

- The lab data is indoor treadmill ramps of about 11 minutes at 15 to 32 °C and 48% humidity, 85% men aged 11 to 63.
  Singapore heat, long sessions, hills and wind all push VE above these estimates. Over-63s, including ageing-centre
  groups, get a warning and a rough estimate only.
- Stop-start sports likely breathe more than their average MET implies.
- The risk levels are this project's proposal. No agency scales WHO's 24-hour limits by breathing.
- The result is inhaled mass, not the dose deposited in the lungs.

## Repo

| Path                                              | What                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `explore.ipynb`                                   | what VE depends on, and the findings above                                            |
| `calculate-ve.ipynb`, `calculate-ve-others.ipynb` | the VE models and their export to the app                                             |
| `assess-risk.ipynb`                               | dose, day-equivalent PM2.5, risk levels, alternatives                                 |
| `air-weather-api.ipynb`, `detect.ipynb`           | Open-Meteo pipeline; heat, UV and rain rules and venue search                         |
| `create-embedding.py`, `hazewise.db`              | the activity database and its embeddings                                              |
| `web/`                                            | the Next.js app; [web/README.md](web/README.md) covers running, the API and deploying |

The notebooks ran in JupyterLab on the VM (Python 3.12, with the repo under `~/shared`). They need pandas, numpy,
scipy, statsmodels, scikit-learn, matplotlib, requests and ipywidgets. `create-embedding.py` needs
`OPENROUTER_API_KEY`.
