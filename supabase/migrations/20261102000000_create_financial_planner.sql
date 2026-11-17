CREATE TABLE public.financial_planning_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  age integer CHECK (age IS NULL OR age BETWEEN 18 AND 100),
  retirement_age integer CHECK (retirement_age IS NULL OR retirement_age BETWEEN 18 AND 120),
  monthly_take_home numeric NOT NULL DEFAULT 0 CHECK (monthly_take_home >= 0 AND monthly_take_home < 'Infinity'::numeric),
  essential_monthly_expenses numeric NOT NULL DEFAULT 0 CHECK (essential_monthly_expenses >= 0 AND essential_monthly_expenses < 'Infinity'::numeric),
  monthly_debt_payments numeric NOT NULL DEFAULT 0 CHECK (monthly_debt_payments >= 0 AND monthly_debt_payments < 'Infinity'::numeric),
  emergency_months numeric NOT NULL DEFAULT 3 CHECK (emergency_months BETWEEN 0 AND 24),
  expected_return_percent numeric NOT NULL DEFAULT 8 CHECK (expected_return_percent > -99 AND expected_return_percent <= 1000),
  inflation_percent numeric NOT NULL DEFAULT 6 CHECK (inflation_percent > -99 AND inflation_percent <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.financial_planning_cashflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('income','expense')),
  category text NOT NULL CHECK (length(btrim(category)) > 0),
  amount numeric NOT NULL CHECK (amount >= 0 AND amount < 'Infinity'::numeric),
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly','annual','weekly','one_time')),
  is_estimated boolean NOT NULL DEFAULT true,
  effective_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.financial_planning_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (length(btrim(kind)) > 0),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  current_value numeric NOT NULL CHECK (current_value >= 0 AND current_value < 'Infinity'::numeric),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  is_estimated boolean NOT NULL DEFAULT true,
  linked_portfolio_id uuid REFERENCES public.portfolios(id) ON DELETE SET NULL,
  expected_return_percent numeric CHECK (expected_return_percent IS NULL OR (expected_return_percent > -99 AND expected_return_percent <= 1000)),
  is_liquid boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.financial_planning_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  category text NOT NULL DEFAULT 'other',
  target_amount numeric NOT NULL CHECK (target_amount >= 0 AND target_amount < 'Infinity'::numeric),
  target_date date NOT NULL,
  current_amount numeric NOT NULL DEFAULT 0 CHECK (current_amount >= 0 AND current_amount < 'Infinity'::numeric),
  monthly_contribution numeric NOT NULL DEFAULT 0 CHECK (monthly_contribution >= 0 AND monthly_contribution < 'Infinity'::numeric),
  priority integer NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  inflation_percent numeric CHECK (inflation_percent IS NULL OR (inflation_percent > -99 AND inflation_percent <= 1000)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX financial_planning_cashflows_user_idx ON public.financial_planning_cashflows(user_id, effective_date DESC);
CREATE INDEX financial_planning_assets_user_idx ON public.financial_planning_assets(user_id);
CREATE INDEX financial_planning_goals_user_idx ON public.financial_planning_goals(user_id, target_date);

ALTER TABLE public.financial_planning_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_planning_cashflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_planning_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_planning_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY financial_planning_profiles_own ON public.financial_planning_profiles FOR ALL TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY financial_planning_cashflows_own ON public.financial_planning_cashflows FOR ALL TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY financial_planning_assets_own ON public.financial_planning_assets FOR ALL TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY financial_planning_goals_own ON public.financial_planning_goals FOR ALL TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.financial_planning_profiles, public.financial_planning_cashflows, public.financial_planning_assets, public.financial_planning_goals FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_planning_profiles, public.financial_planning_cashflows, public.financial_planning_assets, public.financial_planning_goals TO authenticated;
