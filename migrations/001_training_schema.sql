-- Run as postgres user: runuser -u postgres -- psql -d neondb -f 001_training_schema.sql

CREATE SCHEMA IF NOT EXISTS training;

-- ─── USERS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training.users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT UNIQUE,
    name        TEXT,
    avatar_url  TEXT,
    google_sub  TEXT UNIQUE,
    apple_sub   TEXT UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── PROFILES ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training.profiles (
    user_id                         UUID PRIMARY KEY REFERENCES training.users(id) ON DELETE CASCADE,
    date_of_birth                   DATE,
    gender                          TEXT CHECK (gender IN ('male','female','other')),
    weight_kg                       NUMERIC(5,2),
    height_cm                       INTEGER,
    resting_hr                      INTEGER,
    max_hr                          INTEGER,
    ftp_watts                       INTEGER,
    css_per_100m                    NUMERIC(5,1),
    running_threshold_pace_sec_km   NUMERIC(6,1),
    current_weekly_hours            NUMERIC(4,1),
    fitness_level                   TEXT CHECK (fitness_level IN ('beginner','intermediate','advanced','elite')) DEFAULT 'beginner',
    vo2max_estimate                 NUMERIC(4,1),
    updated_at                      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── GOALS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training.goals (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES training.users(id) ON DELETE CASCADE,
    goal_type           TEXT NOT NULL CHECK (goal_type IN (
                            'marathon','half_marathon','5k','10k',
                            'ironman','half_ironman','sprint_triathlon',
                            'cycling_event','strength','general_fitness'
                        )),
    goal_name           TEXT NOT NULL,
    target_date         DATE NOT NULL,
    event_name          TEXT,
    target_time_seconds INTEGER,
    status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','paused','abandoned')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── TRAINING PLANS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training.training_plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES training.users(id) ON DELETE CASCADE,
    goal_id         UUID NOT NULL REFERENCES training.goals(id) ON DELETE CASCADE,
    plan_start_date DATE NOT NULL,
    plan_end_date   DATE NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS training.plan_weeks (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id              UUID NOT NULL REFERENCES training.training_plans(id) ON DELETE CASCADE,
    user_id              UUID NOT NULL,
    week_number          INTEGER NOT NULL,
    week_start           DATE NOT NULL,
    block_type           TEXT NOT NULL CHECK (block_type IN ('base','build','peak','taper','race')),
    weekly_hours_target  NUMERIC(4,1),
    weekly_tss_target    INTEGER,
    notes                TEXT
);

CREATE TABLE IF NOT EXISTS training.plan_days (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id     UUID NOT NULL REFERENCES training.training_plans(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL,
    date        DATE NOT NULL,
    day_type    TEXT NOT NULL CHECK (day_type IN ('rest','easy','tempo','interval','long','race','strength','brick','core')),
    ai_adjusted BOOLEAN NOT NULL DEFAULT FALSE,
    notes       TEXT
);

CREATE TABLE IF NOT EXISTS training.workouts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_day_id     UUID NOT NULL REFERENCES training.plan_days(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL,
    sport           TEXT NOT NULL CHECK (sport IN ('run','cycle','swim','strength','core','brick')),
    title           TEXT NOT NULL,
    duration_min    INTEGER,
    distance_km     NUMERIC(6,2),
    intensity_zone  INTEGER CHECK (intensity_zone BETWEEN 1 AND 5),
    tss             INTEGER,
    description     TEXT,
    structure       JSONB,
    sort_order      INTEGER NOT NULL DEFAULT 0
);

-- ─── WORKOUT LOGS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training.workout_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workout_id          UUID REFERENCES training.workouts(id) ON DELETE SET NULL,
    user_id             UUID NOT NULL,
    log_date            DATE NOT NULL,
    actual_duration_min INTEGER,
    actual_distance_km  NUMERIC(6,2),
    avg_hr              INTEGER,
    max_hr              INTEGER,
    avg_power_watts     INTEGER,
    calories_burned     INTEGER,
    perceived_effort    INTEGER CHECK (perceived_effort BETWEEN 1 AND 10),
    notes               TEXT,
    source              TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','suunto','strava')),
    external_id         TEXT,
    raw_data            JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── TRAINING LOAD (ATL/CTL/TSB) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training.training_load (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    date    DATE NOT NULL,
    atl     NUMERIC(6,2),
    ctl     NUMERIC(6,2),
    tsb     NUMERIC(6,2),
    UNIQUE (user_id, date)
);

-- ─── FOOD DATABASE (public, no RLS) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training.food_database (
    id                  SERIAL PRIMARY KEY,
    name                TEXT NOT NULL,
    name_de             TEXT,
    name_pl             TEXT,
    category            TEXT CHECK (category IN ('meat','fish','grain','vegetable','fruit','dairy','legume','fat','beverage','egg','nut','supplement')),
    calories_per_100g   NUMERIC(6,1),
    protein_per_100g    NUMERIC(6,2),
    carbs_per_100g      NUMERIC(6,2),
    fat_per_100g        NUMERIC(6,2),
    fiber_per_100g      NUMERIC(6,2),
    iron_per_100g       NUMERIC(7,3),
    calcium_per_100g    NUMERIC(7,2),
    vitamin_d_per_100g  NUMERIC(7,3),
    vitamin_b12_per_100g NUMERIC(7,3),
    vitamin_c_per_100g  NUMERIC(7,2),
    magnesium_per_100g  NUMERIC(7,2),
    potassium_per_100g  NUMERIC(7,2),
    zinc_per_100g       NUMERIC(7,3),
    sodium_per_100g     NUMERIC(7,2),
    source              TEXT NOT NULL DEFAULT 'curated'
);

-- ─── FOOD LOG ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training.food_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL,
    log_date    DATE NOT NULL,
    meal_type   TEXT CHECK (meal_type IN ('breakfast','lunch','dinner','snack','pre_workout','post_workout')),
    food_id     INTEGER REFERENCES training.food_database(id),
    food_name   TEXT NOT NULL,
    amount_g    NUMERIC(7,1) NOT NULL,
    calories    NUMERIC(6,1),
    protein_g   NUMERIC(6,2),
    carbs_g     NUMERIC(6,2),
    fat_g       NUMERIC(6,2),
    fiber_g     NUMERIC(6,2),
    nutrients   JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── NUTRITION TARGETS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training.nutrition_targets (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL,
    date             DATE NOT NULL,
    calories_kcal    INTEGER,
    protein_g        NUMERIC(6,1),
    carbs_g          NUMERIC(6,1),
    fat_g            NUMERIC(6,1),
    fiber_g          NUMERIC(6,1),
    water_ml         INTEGER,
    iron_mg          NUMERIC(6,2),
    calcium_mg       NUMERIC(6,1),
    vitamin_d_mcg    NUMERIC(6,2),
    vitamin_b12_mcg  NUMERIC(6,2),
    vitamin_c_mg     NUMERIC(6,1),
    magnesium_mg     NUMERIC(6,1),
    potassium_mg     NUMERIC(6,1),
    zinc_mg          NUMERIC(6,2),
    sodium_mg        NUMERIC(6,1),
    UNIQUE (user_id, date)
);

-- ─── SLEEP LOG ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training.sleep_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL,
    log_date      DATE NOT NULL,
    target_hours  NUMERIC(3,1),
    actual_hours  NUMERIC(3,1),
    quality       INTEGER CHECK (quality BETWEEN 1 AND 5),
    notes         TEXT,
    UNIQUE (user_id, log_date)
);

-- ─── SYNC ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training.sync_tokens (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL,
    provider         TEXT NOT NULL CHECK (provider IN ('suunto','strava')),
    access_token     TEXT,
    refresh_token    TEXT,
    expires_at       TIMESTAMPTZ,
    scope            TEXT,
    provider_user_id TEXT,
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS training.sync_log (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID NOT NULL,
    provider             TEXT NOT NULL,
    synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activities_imported  INTEGER DEFAULT 0,
    status               TEXT CHECK (status IN ('success','error')),
    error_msg            TEXT
);

-- ─── AI COACH ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training.ai_sessions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL,
    goal_id    UUID REFERENCES training.goals(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS training.ai_messages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES training.ai_sessions(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
    content    TEXT NOT NULL,
    model      TEXT,
    tokens_used INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── INDEXES ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_goals_user ON training.goals(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_days_user_date ON training.plan_days(user_id, date);
CREATE INDEX IF NOT EXISTS idx_workouts_plan_day ON training.workouts(plan_day_id);
CREATE INDEX IF NOT EXISTS idx_workout_logs_user_date ON training.workout_logs(user_id, log_date);
CREATE INDEX IF NOT EXISTS idx_food_log_user_date ON training.food_log(user_id, log_date);
CREATE INDEX IF NOT EXISTS idx_nutrition_targets_user_date ON training.nutrition_targets(user_id, date);
CREATE INDEX IF NOT EXISTS idx_training_load_user_date ON training.training_load(user_id, date);
CREATE INDEX IF NOT EXISTS idx_food_database_name ON training.food_database USING gin(to_tsvector('simple', name));

-- ─── ROW LEVEL SECURITY ──────────────────────────────────────────────────────
-- Enable RLS on all user-scoped tables
DO $$ DECLARE t TEXT; BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'users','profiles','goals','training_plans','plan_weeks','plan_days','workouts',
    'workout_logs','training_load','food_log','nutrition_targets','sleep_log',
    'sync_tokens','sync_log','ai_sessions','ai_messages'
  ]) LOOP
    EXECUTE format('ALTER TABLE training.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE training.%I FORCE ROW LEVEL SECURITY', t);

    -- SELECT/UPDATE/DELETE policy
    EXECUTE format(
      'CREATE POLICY user_isolation ON training.%I
       USING (user_id = current_setting(''training.current_user_id'', true)::uuid)',
      t
    );
    -- INSERT policy
    EXECUTE format(
      'CREATE POLICY user_insert ON training.%I FOR INSERT
       WITH CHECK (user_id = current_setting(''training.current_user_id'', true)::uuid)',
      t
    );
  END LOOP;
END $$;

-- users table uses id not user_id
DROP POLICY IF EXISTS user_isolation ON training.users;
DROP POLICY IF EXISTS user_insert ON training.users;
ALTER TABLE training.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_isolation ON training.users
  USING (id = current_setting('training.current_user_id', true)::uuid);
CREATE POLICY user_insert ON training.users FOR INSERT WITH CHECK (true);

-- food_database is public — no RLS
ALTER TABLE training.food_database DISABLE ROW LEVEL SECURITY;

-- ─── GRANTS ──────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA training TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA training TO erp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA training TO erp_app;

-- ─── SEED: FOOD DATABASE ─────────────────────────────────────────────────────
INSERT INTO training.food_database
  (name, name_de, name_pl, category, calories_per_100g, protein_per_100g, carbs_per_100g,
   fat_per_100g, fiber_per_100g, iron_per_100g, calcium_per_100g, vitamin_d_per_100g,
   vitamin_b12_per_100g, vitamin_c_per_100g, magnesium_per_100g, potassium_per_100g,
   zinc_per_100g, sodium_per_100g)
VALUES
-- MEAT
('Chicken Breast','Hähnchenbrust','Pierś z kurczaka','meat',165,31.0,0,3.6,0,0.70,11,0.030,0.34,0,29,256,1.0,74),
('Beef Steak (lean)','Rindersteak (mager)','Stek wołowy','meat',215,26.1,0,12.0,0,2.60,18,0.009,2.50,0,22,318,5.3,59),
('Pork Tenderloin','Schweinefilet','Polędwiczka wieprzowa','meat',143,26.0,0,3.5,0,1.00,5,0.530,0.63,0,28,421,2.5,53),
('Turkey Breast','Putenbrust','Pierś z indyka','meat',135,30.1,0,1.0,0,1.40,21,0.000,0.32,0,32,339,2.0,63),
('Salmon','Lachs','Łosoś','fish',208,20.4,0,13.4,0,0.34,9,11.000,3.18,0,29,363,0.5,59),
('Tuna (canned)','Thunfisch','Tuńczyk w puszce','fish',116,25.5,0,1.0,0,1.30,11,0.000,2.95,0,32,288,0.8,247),
('Sardines','Sardinen','Sardynki','fish',208,24.6,0,11.5,0,2.92,382,4.800,8.94,0,39,397,1.3,505),
('Mackerel','Makrele','Makrela','fish',205,19.0,0,13.9,0,1.44,12,8.340,8.71,0,30,314,0.6,90),
('Eggs','Eier','Jajka','egg',155,13.0,1.1,11.0,0,1.75,56,2.000,1.11,0,12,138,1.3,124),
('Egg Whites','Eiweiß','Białko jajka','egg',52,10.9,0.7,0.2,0,0.08,7,0.000,0.09,0,11,163,0.0,166),
-- GRAIN
('White Rice (cooked)','Weißer Reis gekocht','Biały ryż gotowany','grain',130,2.7,28.2,0.3,0.4,0.20,10,0.000,0.00,0,12,35,0.5,1),
('Brown Rice (cooked)','Brauner Reis gekocht','Brązowy ryż gotowany','grain',123,2.7,25.6,1.0,1.8,0.52,10,0.000,0.00,0,44,79,0.7,1),
('Spaghetti (cooked)','Nudeln gekocht','Makaron gotowany','grain',158,5.8,30.9,0.9,1.8,0.63,7,0.000,0.00,0,18,45,0.5,1),
('Oats','Haferflocken','Płatki owsiane','grain',389,17.0,66.3,6.9,10.6,4.72,54,0.000,0.00,0,177,429,3.6,2),
('Whole Wheat Bread','Vollkornbrot','Chleb pełnoziarnisty','grain',265,9.0,49.0,3.5,6.0,2.50,73,0.000,0.00,0,76,248,1.5,450),
('White Bread','Weißbrot','Chleb biały','grain',265,9.4,49.2,3.2,2.7,2.43,150,0.000,0.00,0,23,115,0.8,490),
('Quinoa (cooked)','Quinoa gekocht','Komosa ryżowa gotowana','grain',120,4.4,21.3,1.9,2.8,1.49,17,0.000,0.00,0,64,172,1.1,7),
('Sweet Potato (baked)','Süßkartoffel','Batat','vegetable',90,2.0,20.7,0.1,3.3,0.69,38,0.000,0.00,19.6,27,475,0.3,36),
('Potato (boiled)','Kartoffel','Ziemniaki','vegetable',87,1.9,20.1,0.1,1.8,0.31,5,0.000,0.00,7.4,22,379,0.3,5),
('Banana','Banane','Banan','fruit',89,1.1,22.8,0.3,2.6,0.26,5,0.000,0.00,8.7,27,358,0.2,1),
-- DAIRY
('Greek Yogurt (full)','Griechischer Joghurt','Jogurt grecki','dairy',97,9.0,3.9,5.0,0,0.07,110,0.010,0.47,0,11,141,0.5,35),
('Cottage Cheese','Hüttenkäse','Serek wiejski','dairy',98,11.1,3.4,4.5,0,0.07,83,0.000,0.43,0,8,104,0.4,364),
('Milk (whole)','Vollmilch','Mleko pełne','dairy',61,3.2,4.8,3.3,0,0.03,113,0.002,0.36,0,11,150,0.4,43),
('Whey Protein Powder','Whey Protein','Białko serwatki','dairy',403,80.0,8.0,8.0,0,1.00,150,0.000,1.50,0,40,400,2.0,130),
-- VEGETABLE
('Broccoli','Brokkoli','Brokuły','vegetable',34,2.8,6.6,0.4,2.6,0.73,47,0.000,0.00,89.2,21,316,0.4,33),
('Spinach','Spinat','Szpinak','vegetable',23,2.9,3.6,0.4,2.2,2.71,99,0.000,0.00,28.1,79,558,0.5,79),
('Kale','Grünkohl','Jarmuż','vegetable',49,4.3,8.8,0.9,3.6,1.47,150,0.000,0.00,120.0,47,491,0.4,38),
('Sweet Corn','Mais','Kukurydza','vegetable',86,3.2,18.7,1.2,2.0,0.52,2,0.000,0.00,6.8,37,270,0.5,15),
('Carrot','Karotte','Marchew','vegetable',41,0.9,9.6,0.2,2.8,0.30,33,0.000,0.00,5.9,12,320,0.2,69),
('Avocado','Avocado','Awokado','fruit',160,2.0,8.5,14.7,6.7,0.55,12,0.000,0.00,10.0,29,485,0.6,7),
-- FRUIT
('Apple','Apfel','Jabłko','fruit',52,0.3,13.8,0.2,2.4,0.12,6,0.000,0.00,4.6,5,107,0.0,1),
('Orange','Orange','Pomarańcza','fruit',47,0.9,11.8,0.1,2.4,0.10,40,0.000,0.00,53.2,10,181,0.1,0),
('Blueberries','Heidelbeeren','Jagody','fruit',57,0.7,14.5,0.3,2.4,0.28,6,0.000,0.00,9.7,6,77,0.2,1),
('Strawberries','Erdbeeren','Truskawki','fruit',32,0.7,7.7,0.3,2.0,0.41,16,0.000,0.00,58.8,13,153,0.1,1),
-- LEGUME
('Lentils (cooked)','Linsen','Soczewica','legume',116,9.0,20.1,0.4,7.9,3.33,19,0.000,0.00,1.5,36,369,1.3,2),
('Chickpeas (cooked)','Kichererbsen','Ciecierzyca','legume',164,8.9,27.4,2.6,7.6,2.89,49,0.000,0.00,1.3,48,291,1.5,7),
('Black Beans (cooked)','Schwarze Bohnen','Czarna fasola','legume',132,8.9,23.7,0.5,8.7,2.10,27,0.000,0.00,0.0,70,355,1.0,1),
-- NUTS & FAT
('Almonds','Mandeln','Migdały','nut',579,21.2,21.6,49.9,12.5,3.71,264,0.000,0.00,0.0,270,733,3.1,1),
('Peanut Butter','Erdnussbutter','Masło orzechowe','nut',588,25.1,20.1,50.4,6.0,1.74,49,0.000,0.00,0.0,168,558,2.5,17),
('Olive Oil','Olivenöl','Oliwa z oliwek','fat',884,0,0,100.0,0,0.56,1,0.000,0.00,0.0,0,1,0.0,2),
-- BEVERAGES
('Sports Drink (isotonic)','Sportgetränk','Napój izotoniczny','beverage',26,0,6.5,0,0,0,10,0.000,0.00,0.0,3,30,0.0,410),
('Whole Milk','Vollmilch','Mleko pełne','beverage',61,3.2,4.8,3.3,0,0.03,113,0.002,0.36,0,11,150,0.4,43),
('Orange Juice','Orangensaft','Sok pomarańczowy','beverage',45,0.7,10.4,0.2,0.2,0.20,11,0.000,0.00,50.0,11,200,0.1,1)
ON CONFLICT DO NOTHING;
