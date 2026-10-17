"""build_activity_db.py: 2024 Adult Compendium of Physical Activities -> SQLite (hazewise.db)

    python build_activity_db.py [compendium.txt] [hazewise.db]

Tables
------
activities        every Compendium row (1,1xx), faithful MET + extra lookup columns
activities_fts    FTS5 index over name/keywords/heading (free-text lookup)
activity_families curated "what a person actually says" -> 3 Compendium rows (light/moderate/vigorous)
family_aliases    alias -> family  (e.g. "jog" -> running, "futsal" -> soccer)
venues            venue name -> lat/lon (approximate, sample data)

The LLM never needs the 1,100 rows. It picks a `family` (+ optional `effort`) from activity_families,
or falls back to free text, which is searched in activities_fts.
"""
import re
import sqlite3
import sys
from pathlib import Path

HEADINGS = ["Bicycling", "Conditioning Exercise", "Dancing", "Fishing & Hunting", "Home Activities", "Home Repair",
            "Inactivity", "Lawn & Garden", "Miscellaneous", "Music Playing", "Occupation", "Running", "Self Care",
            "Sexual Activity", "Sports", "Transportation", "Walking", "Water Activities", "Winter Activities",
            "Religious Activities", "Volunteer Activities", "Video Games"]
EXERCISE_HEADINGS = {"Bicycling", "Conditioning Exercise", "Dancing", "Running", "Sports", "Walking",
                     "Water Activities", "Winter Activities"}
_HEAD = "|".join(re.escape(h) for h in sorted(HEADINGS, key=len, reverse=True))
ROW_RE = re.compile(rf"^({_HEAD})\s+(\d{{5}})\s+(\d+(?:\.\d+)?)\s*(.*)$")
SKIP_PREFIX = ("Major Heading", "2024 Adult Compendium")

# words people say -> words in the Compendium (added to the keywords column so search finds them)
SYNONYMS = {"soccer": "football futsal kickabout", "jogging": "jog run", "running": "run jog sprint",
            "bicycling": "cycling cycle bike biking", "walking": "walk stroll", "hiking": "trek trekking trail",
            "rope jumping": "skipping jump rope", "tai chi": "taichi qigong", "muay thai": "kickboxing thai boxing",
            "aerobic": "zumba aerobics", "calisthenics": "bodyweight workout push-up", "roller": "rollerblade skate",
            "badminton": "shuttlecock", "stair": "stairs steps"}
INDOOR_WORDS = ("stationary", "treadmill", "ergometer", "virtual", "indoor", "health club", "simulator",
                "elliptical", "video", "stair treadmill", "spin bike", "exergam")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def read_source(path):
    raw = Path(path).read_bytes()
    if raw.startswith(b"%PDF"):
        sys.exit("This is a real PDF. Run `pdftotext -layout file.pdf compendium.txt` first, then pass the .txt.")
    return raw.decode("utf-8", errors="replace")


def parse(text):
    rows, last = [], None
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(SKIP_PREFIX):
            continue
        m = ROW_RE.match(line)
        if m:
            last = {"major_heading": m[1], "code": m[2], "met": float(m[3]), "description": m[4].strip()}
            rows.append(last)
        elif last is not None:           # wrapped description: append to previous row
            last["description"] = (last["description"] + " " + line).strip()
    return rows


def effort_of(d):
    d = d.lower()
    if re.search(r"very vigorous|extremely vigorous|maximal|maximum", d):
        return "very_vigorous"
    if re.search(r"moderate[- ]to[- ]vigorous|moderate-to-vigorous", d):
        return "moderate_to_vigorous"
    for w in ("vigorous", "moderate", "light"):
        if w in d:
            return w
    return None


def speed_of(d):
    d = d.lower()
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*mph", d)
    if m:
        lo, hi = float(m[1]), float(m[2])
    else:
        m = re.search(r"(\d+(?:\.\d+)?)\s*mph", d)
        lo = hi = float(m[1]) if m else None
    k = 1.609344
    return (None, None) if lo is None else (round(lo * k, 2), round(hi * k, 2))


def enrich(r):
    name = re.sub(r"\s*\(Taylor Code[^)]*\)", "", r["description"])
    name = re.sub(r"\s+", " ", name).strip(" ,")
    low = (r["major_heading"] + " " + name).lower()
    extra = " ".join(v for k, v in SYNONYMS.items() if k in low)
    smin, smax = speed_of(name)
    r.update(name=name, lookup_key=f"{slug(r['major_heading'])}.{slug(name)[:60]}.{r['code']}",
             keywords=slug(low).replace("_", " ") + (" " + extra if extra else ""),
             effort=effort_of(name), speed_kmh_min=smin, speed_kmh_max=smax,
             indoor_only=int(any(w in low for w in INDOOR_WORDS)),
             exercise_relevant=int(r["major_heading"] in EXERCISE_HEADINGS))
    return r


SCHEMA = """
DROP TABLE IF EXISTS activities;  DROP TABLE IF EXISTS activities_fts; DROP TABLE IF EXISTS activity_families;
DROP TABLE IF EXISTS family_aliases; DROP TABLE IF EXISTS venues;
CREATE TABLE activities (
  code TEXT PRIMARY KEY,              -- Compendium activity code, keeps leading zeros ('01003')
  major_heading TEXT NOT NULL,
  met REAL NOT NULL,                  -- 2024 Compendium MET value
  description TEXT NOT NULL,          -- original text, unchanged
  name TEXT NOT NULL,                 -- description without '(Taylor Code ...)', for lookup and display
  lookup_key TEXT NOT NULL UNIQUE,    -- heading.slug.code, stable string key
  keywords TEXT NOT NULL,             -- lowercase tokens + synonyms
  effort TEXT,                        -- light | moderate | vigorous | very_vigorous | moderate_to_vigorous | NULL (parsed from text)
  speed_kmh_min REAL, speed_kmh_max REAL,   -- parsed from 'mph' in the text, NULL if none
  indoor_only INTEGER NOT NULL,       -- 1 = keyword heuristic says treadmill/ergometer/virtual (not a PM2.5/heat/UV case)
  exercise_relevant INTEGER NOT NULL  -- 1 = heading is sport/exercise (searched by default)
);
CREATE INDEX idx_act_heading ON activities(major_heading);
CREATE VIRTUAL TABLE activities_fts USING fts5(name, keywords, major_heading, code UNINDEXED, tokenize='porter unicode61');

CREATE TABLE activity_families (
  family TEXT PRIMARY KEY,            -- what the LLM outputs, e.g. 'running'
  display_name TEXT NOT NULL,
  light_code TEXT NOT NULL REFERENCES activities(code),
  moderate_code TEXT NOT NULL REFERENCES activities(code),
  vigorous_code TEXT NOT NULL REFERENCES activities(code),
  external_work_frac REAL NOT NULL DEFAULT 0,   -- share of metabolic energy leaving as work not heat (cycling ~0.2, doc: verify)
  uv_er_low REAL NOT NULL DEFAULT 0.2,          -- UV exposure ratio range (PLACEHOLDER, no per-sport source yet)
  uv_er_high REAL NOT NULL DEFAULT 0.5,
  uses_pace INTEGER NOT NULL DEFAULT 0,         -- 1 = ACSM pace equation applies (running, walking)
  notes TEXT
);
CREATE TABLE family_aliases (alias TEXT PRIMARY KEY, family TEXT NOT NULL REFERENCES activity_families(family));
CREATE TABLE venues (
  name TEXT PRIMARY KEY, aliases TEXT, lat REAL NOT NULL, lon REAL NOT NULL, region TEXT,
  verified INTEGER NOT NULL DEFAULT 0   -- 0 = approximate; check with OneMap before relying on it
);
"""

# family, display, light, moderate, vigorous, ext_work, uses_pace, aliases, notes
FAMILIES = [
    ("running", "Running / jogging", "12020", "12050", "12080", 0, 1,
     "run,runs,running,jog,jogging,10k,5k,half marathon,marathon,sprint,sprints,track run",
     "light=jogging general 7.5; moderate=6-6.3 mph (10 min/mile) 9.3; vigorous=7.5 mph 11.8. Pace overrides via ACSM."),
    ("walking", "Walking / brisk walking", "17152", "17190", "17200", 0, 1,
     "walk,walking,brisk walk,power walk,stroll,morning walk,walk the dog,park walk",
     "light=2.0-2.4 mph; moderate=2.8-3.4 mph; vigorous=3.5-3.9 mph brisk. Pace overrides via ACSM."),
    ("hiking", "Hiking / trail walking", "17081", "17082", "17035", 0, 0,
     "hike,hiking,trek,trekking,trail,macritchie,bukit timah,treetop walk",
     "light=slow amble; moderate=normal pace fields/hills; vigorous=climbing hills 6-10% grade"),
    ("cycling", "Cycling", "01010", "01016", "01017", 0.2, 0,
     "cycle,cycling,bike,biking,bicycle,ride,pcn,park connector",
     "light=<10 mph leisure 4.0; moderate=self-selected 7.0; vigorous 9.0. 20% external work: verify"),
    ("soccer", "Football (soccer) / futsal", "15615", "15610", "15605", 0, 0,
     "football,soccer,futsal,kickabout,kick about,play ball",
     "light=walking football 3.5; moderate=casual 7.0; vigorous=competitive 9.5. 'Football, competitive' in the Compendium is American football: not mapped"),
    ("basketball", "Basketball", "15050", "15055", "15040", 0, 0,
     "basketball,hoops,shoot hoops,half court", "light=non-game 6.0; moderate=general 7.5; vigorous=game 8.0"),
    ("badminton", "Badminton", "15030", "15020", "15025", 0, 0,
     "badminton,shuttle,shuttlecock", "light=social 5.5; moderate=competitive 7.0; vigorous=match play 9.0"),
    ("tennis", "Tennis", "15695", "15675", "15676", 0, 0,
     "tennis", "light=hitting balls 5.0; moderate=general 6.8; vigorous=competitive 8.0"),
    ("volleyball", "Volleyball (incl. beach)", "15720", "15710", "15725", 0, 0,
     "volleyball,beach volleyball,spike", "light=non-competitive 3.0; moderate=general 4.0; vigorous=beach/sand 8.0"),
    ("boxing", "Boxing", "15110", "15120", "15100", 0, 0,
     "boxing,punching bag,sparring", "light=bag 5.8; moderate=sparring 7.8; vigorous=in ring 12.3"),
    ("martial_arts", "Martial arts / Muay Thai", "15425", "15430", "15432", 0, 0,
     "muay thai,thai boxing,martial arts,karate,taekwondo,kickboxing,judo,silat,kung fu",
     "light=novice slower 5.3; moderate=moderate pace incl. Muay Thai 10.3; vigorous=taekwondo combat 14.3"),
    ("aerobic_dance", "Aerobic dance / Zumba", "02005", "02310", "02006", 0, 0,
     "zumba,aerobics,aerobic dance,dance fitness,line dance,square dance,group dance,dance",
     "light=low impact 4.8; moderate=Zumba group 6.5; vigorous=high impact 8.0"),
    ("tai_chi", "Tai chi / qigong", "15672", "15670", "15674", 0, 0,
     "tai chi,taichi,qigong,qi gong,tai-chi", "light=seated 1.5; moderate=general 3.3; vigorous=Yang style 6.0"),
    ("calisthenics", "Calisthenics / park bodyweight", "02024", "02022", "02020", 0, 0,
     "calisthenics,pushups,push-ups,pull-ups,pullups,bodyweight,street workout,park workout,burpees",
     "light 2.8; moderate 3.8; vigorous 7.5"),
    ("circuit_training", "Circuit / HIIT", "02034", "02032", "02040", 0, 0,
     "circuit,circuit training,hiit,bootcamp,boot camp,crossfit,interval training",
     "light=light effort 3.5; moderate=body weight 6.0; vigorous incl. kettlebells 7.5"),
    ("weight_training", "Weight training (outdoor gym)", "02054", "02052", "02050", 0, 0,
     "weights,weight training,lifting,outdoor gym,fitness corner,resistance training",
     "light 3.5; moderate 5.0; vigorous 6.0"),
    ("yoga", "Yoga", "02150", "02180", "02160", 0, 0,
     "yoga,hatha,vinyasa,sun salutation", "light=Hatha 2.3; moderate=Surya Namaskar 3.5; vigorous=power yoga 4.0"),
    ("inline_skating", "Inline / roller skating", "15591", "15592", "15593", 0, 0,
     "rollerblade,rollerblading,inline skating,roller skating,skating", "9 / 11 / 13 mph: 7.5 / 9.8 / 12.3"),
]

VENUES = [  # approximate coordinates, enough for a ~45 km air-quality grid; verify with OneMap
    ("East Coast Park", "ecp,east coast", 1.3010, 103.9120, "east", 1),   # same constant as air-weather-api.ipynb
    ("Bishan-Ang Mo Kio Park", "bishan park,amk park,bishan-amk park", 1.3626, 103.8466, "central", 0),
    ("MacRitchie Reservoir", "macritchie,mac ritchie,treetop walk", 1.3446, 103.8337, "central", 0),
    ("Marina Barrage", "marina bay,marina barrage,gardens by the bay", 1.2805, 103.8713, "central", 0),
    ("Jurong Lake Gardens", "jurong lake,jlg,lakeside gardens", 1.3397, 103.7285, "west", 0),
    ("NTU", "nanyang technological university,ntu campus,yunnan garden", 1.3483, 103.6831, "west", 0),
]


def build(src, db_path):
    rows = [enrich(r) for r in parse(read_source(src))]
    codes = [r["code"] for r in rows]
    assert len(codes) == len(set(codes)), "duplicate activity codes in source"
    con = sqlite3.connect(db_path)
    con.executescript(SCHEMA)
    con.executemany(
        "INSERT INTO activities VALUES (:code,:major_heading,:met,:description,:name,:lookup_key,:keywords,:effort,"
        ":speed_kmh_min,:speed_kmh_max,:indoor_only,:exercise_relevant)", rows)
    con.executemany("INSERT INTO activities_fts(name,keywords,major_heading,code) VALUES (?,?,?,?)",
                    [(r["name"], r["keywords"], r["major_heading"], r["code"]) for r in rows])
    for fam, disp, lo, mid, hi, ext, pace, aliases, notes in FAMILIES:
        con.execute("INSERT INTO activity_families(family,display_name,light_code,moderate_code,vigorous_code,"
                    "external_work_frac,uses_pace,notes) VALUES (?,?,?,?,?,?,?,?)", (fam, disp, lo, mid, hi, ext, pace, notes))
        for a in {fam, fam.replace("_", " ")} | {x.strip() for x in aliases.split(",")}:
            con.execute("INSERT OR IGNORE INTO family_aliases VALUES (?,?)", (a.lower(), fam))
    con.executemany("INSERT INTO venues VALUES (?,?,?,?,?,?)", VENUES)
    # every family code must exist and MET must not decrease light -> vigorous
    for fam, *_ in FAMILIES:
        met = [con.execute("SELECT met FROM activities WHERE code=?", (c,)).fetchone() for c in
               con.execute("SELECT light_code,moderate_code,vigorous_code FROM activity_families WHERE family=?", (fam,)).fetchone()]
        assert all(met), f"{fam}: a family code is missing from activities"
        assert met[0][0] <= met[1][0] <= met[2][0], f"{fam}: METs not ascending {met}"
    con.commit()
    n = con.execute("SELECT COUNT(*) FROM activities").fetchone()[0]
    con.close()
    return n


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "1_2024-adult-compendium_1_2024.pdf"
    out = sys.argv[2] if len(sys.argv) > 2 else "hazewise.db"
    print(f"{build(src, out)} activities, {len(FAMILIES)} families, {len(VENUES)} venues -> {out}")
