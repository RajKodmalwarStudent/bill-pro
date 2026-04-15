-- ============================================================
--  BillPro — Supabase Database Setup
--  Run this entire file in: Supabase Dashboard → SQL Editor
-- ============================================================

-- Stocks table
CREATE TABLE IF NOT EXISTS stocks (
  id        BIGSERIAL PRIMARY KEY,
  name      TEXT           NOT NULL,
  cat       TEXT           NOT NULL,
  unit      TEXT           NOT NULL DEFAULT 'pcs',
  cost      DECIMAL(10,2)  NOT NULL DEFAULT 0,
  price     DECIMAL(10,2)  NOT NULL DEFAULT 0,
  qty       INTEGER        NOT NULL DEFAULT 0,
  low       INTEGER        NOT NULL DEFAULT 5,
  sold      INTEGER        NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ   DEFAULT NOW()
);

-- Bills table
CREATE TABLE IF NOT EXISTS bills (
  id           TEXT          PRIMARY KEY,
  billed_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  items        JSONB         NOT NULL DEFAULT '[]',
  subtotal     DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount_pct DECIMAL(5,2)  NOT NULL DEFAULT 0,
  discount_amt DECIMAL(10,2) NOT NULL DEFAULT 0,
  total        DECIMAL(10,2) NOT NULL DEFAULT 0,
  profit       DECIMAL(10,2) NOT NULL DEFAULT 0
);

-- ── Row Level Security ──────────────────────────────────────
-- Option A (simple, anon access — fine for internal store use):
ALTER TABLE stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all_stocks" ON stocks FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_bills"  ON bills  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Option B (disable RLS entirely — only if project is private):
-- ALTER TABLE stocks DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE bills  DISABLE ROW LEVEL SECURITY;

-- ── Sample Seed Data ────────────────────────────────────────
INSERT INTO stocks (name, cat, unit, cost, price, qty, low, sold) VALUES
  ('Basmati Rice',      'Grains',     'kg',   65,  90,  50, 10, 120),
  ('Toor Dal',          'Grains',     'kg',   95, 130,  30,  8,  85),
  ('Amul Butter',       'Dairy',      'pcs',  52,  65,   2, 10, 200),
  ('Whole Wheat Atta',  'Grains',     'kg',   48,  62,  25,  5,  95),
  ('Parle-G Biscuit',   'Snacks',     'pack',  8,  12, 100, 20, 340),
  ('Sunflower Oil',     'Others',     'L',   140, 175,   0,  5,  60),
  ('Colgate Paste',     'Care',       'pcs',  55,  75,  30,  8, 110),
  ('Mango Frooti',      'Beverages',  'pcs',  15,  20,  60, 15, 280),
  ('Lays Chips',        'Snacks',     'pack', 18,  25,  80, 20, 195),
  ('Full Cream Milk',   'Dairy',      'L',    28,  36,  20,  5, 310),
  ('Green Tea',         'Beverages',  'pack', 95, 130,   4,  3,  45),
  ('Tomato',            'Vegetables', 'kg',   30,  45,   5,  2,  88)
ON CONFLICT DO NOTHING;
