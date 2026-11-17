CREATE TABLE public.portfolios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  base_currency text NOT NULL DEFAULT 'INR'
    CHECK (base_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.portfolio_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES public.portfolios (id) ON DELETE CASCADE,
  symbol text NOT NULL CHECK (symbol <> '' AND symbol = upper(btrim(symbol))),
  exchange text NOT NULL CHECK (exchange <> '' AND exchange = upper(btrim(exchange))),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  transaction_type text NOT NULL CHECK (transaction_type IN ('BUY', 'SELL')),
  quantity numeric NOT NULL
    CHECK (quantity > 0 AND quantity < 'Infinity'::numeric),
  unit_price numeric NOT NULL
    CHECK (unit_price > 0 AND unit_price < 'Infinity'::numeric),
  fees numeric NOT NULL DEFAULT 0
    CHECK (fees >= 0 AND fees < 'Infinity'::numeric),
  executed_at timestamptz NOT NULL DEFAULT now() CHECK (isfinite(executed_at)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- This table is a database-maintained projection of the transaction ledger.
CREATE TABLE public.portfolio_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES public.portfolios (id) ON DELETE CASCADE,
  symbol text NOT NULL CHECK (symbol <> '' AND symbol = upper(btrim(symbol))),
  exchange text NOT NULL CHECK (exchange <> '' AND exchange = upper(btrim(exchange))),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  quantity numeric NOT NULL DEFAULT 0
    CHECK (quantity >= 0 AND quantity < 'Infinity'::numeric),
  average_purchase_price numeric NOT NULL DEFAULT 0
    CHECK (average_purchase_price >= 0 AND average_purchase_price < 'Infinity'::numeric),
  realized_pnl numeric NOT NULL DEFAULT 0
    CHECK (realized_pnl > '-Infinity'::numeric AND realized_pnl < 'Infinity'::numeric),
  last_transaction_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portfolio_holdings_position_key
    UNIQUE (portfolio_id, symbol, exchange, currency),
  CONSTRAINT portfolio_holdings_zero_quantity_cost_check
    CHECK (quantity > 0 OR average_purchase_price = 0)
);

CREATE INDEX portfolios_user_created_at_idx
  ON public.portfolios (user_id, created_at DESC);

CREATE INDEX portfolio_transactions_ledger_idx
  ON public.portfolio_transactions
    (portfolio_id, symbol, exchange, currency, executed_at, created_at, id);

CREATE INDEX portfolio_transactions_portfolio_executed_at_idx
  ON public.portfolio_transactions (portfolio_id, executed_at DESC);

CREATE SCHEMA portfolio_private;
REVOKE ALL ON SCHEMA portfolio_private FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION portfolio_private.set_portfolio_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$function$;

CREATE FUNCTION portfolio_private.lock_portfolio_transaction_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  target_portfolio_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.portfolio_id IS DISTINCT FROM OLD.portfolio_id THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'a transaction cannot be moved between portfolios';
    END IF;
    target_portfolio_id := NEW.portfolio_id;
  ELSIF TG_OP = 'DELETE' THEN
    target_portfolio_id := OLD.portfolio_id;
  ELSE
    target_portfolio_id := NEW.portfolio_id;
  END IF;

  UPDATE public.portfolios AS p
  SET updated_at = clock_timestamp()
  WHERE p.id = target_portfolio_id
  RETURNING p.id INTO target_portfolio_id;

  IF NOT FOUND THEN
    -- A missing parent during DELETE is the portfolio's ON DELETE CASCADE.
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'transaction portfolio does not exist';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION portfolio_private.rebuild_portfolio_holding(
  target_portfolio_id uuid,
  target_symbol text,
  target_exchange text,
  target_currency text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  ledger_row record;
  current_quantity numeric := 0;
  current_average_cost numeric := 0;
  realized_profit_loss numeric := 0;
  has_transactions boolean := false;
  latest_transaction_at timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.portfolios AS p
    WHERE p.id = target_portfolio_id
  ) THEN
    DELETE FROM public.portfolio_holdings AS h
    WHERE h.portfolio_id = target_portfolio_id
      AND h.symbol = target_symbol
      AND h.exchange = target_exchange
      AND h.currency = target_currency;
    RETURN;
  END IF;

  FOR ledger_row IN
    SELECT t.transaction_type, t.quantity, t.unit_price, t.fees, t.executed_at
    FROM public.portfolio_transactions AS t
    WHERE t.portfolio_id = target_portfolio_id
      AND t.symbol = target_symbol
      AND t.exchange = target_exchange
      AND t.currency = target_currency
    ORDER BY t.executed_at, t.created_at, t.id
  LOOP
    has_transactions := true;
    latest_transaction_at := ledger_row.executed_at;

    IF ledger_row.transaction_type = 'BUY' THEN
      current_average_cost :=
        (current_quantity * current_average_cost
          + ledger_row.quantity * ledger_row.unit_price
          + ledger_row.fees)
        / (current_quantity + ledger_row.quantity);
      current_quantity := current_quantity + ledger_row.quantity;
    ELSE
      IF ledger_row.quantity > current_quantity THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'portfolio transaction would result in an oversold holding';
      END IF;

      realized_profit_loss := realized_profit_loss
        + ledger_row.quantity * ledger_row.unit_price
        - ledger_row.fees
        - ledger_row.quantity * current_average_cost;
      current_quantity := current_quantity - ledger_row.quantity;

      IF current_quantity = 0 THEN
        current_average_cost := 0;
      END IF;
    END IF;
  END LOOP;

  IF NOT has_transactions THEN
    DELETE FROM public.portfolio_holdings AS h
    WHERE h.portfolio_id = target_portfolio_id
      AND h.symbol = target_symbol
      AND h.exchange = target_exchange
      AND h.currency = target_currency;
    RETURN;
  END IF;

  INSERT INTO public.portfolio_holdings (
    portfolio_id,
    symbol,
    exchange,
    currency,
    quantity,
    average_purchase_price,
    realized_pnl,
    last_transaction_at,
    updated_at
  )
  VALUES (
    target_portfolio_id,
    target_symbol,
    target_exchange,
    target_currency,
    current_quantity,
    current_average_cost,
    realized_profit_loss,
    latest_transaction_at,
    clock_timestamp()
  )
  ON CONFLICT (portfolio_id, symbol, exchange, currency)
  DO UPDATE SET
    quantity = EXCLUDED.quantity,
    average_purchase_price = EXCLUDED.average_purchase_price,
    realized_pnl = EXCLUDED.realized_pnl,
    last_transaction_at = EXCLUDED.last_transaction_at,
    updated_at = EXCLUDED.updated_at;
END;
$function$;

CREATE FUNCTION portfolio_private.refresh_holdings_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  position record;
BEGIN
  FOR position IN
    SELECT DISTINCT n.portfolio_id, n.symbol, n.exchange, n.currency
    FROM new_portfolio_transactions AS n
    ORDER BY n.portfolio_id, n.symbol, n.exchange, n.currency
  LOOP
    PERFORM portfolio_private.rebuild_portfolio_holding(
      position.portfolio_id, position.symbol, position.exchange, position.currency
    );
  END LOOP;
  RETURN NULL;
END;
$function$;

CREATE FUNCTION portfolio_private.refresh_holdings_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  position record;
BEGIN
  FOR position IN
    SELECT DISTINCT o.portfolio_id, o.symbol, o.exchange, o.currency
    FROM old_portfolio_transactions AS o
    ORDER BY o.portfolio_id, o.symbol, o.exchange, o.currency
  LOOP
    PERFORM portfolio_private.rebuild_portfolio_holding(
      position.portfolio_id, position.symbol, position.exchange, position.currency
    );
  END LOOP;
  RETURN NULL;
END;
$function$;

CREATE FUNCTION portfolio_private.refresh_holdings_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  position record;
BEGIN
  FOR position IN
    SELECT affected.portfolio_id, affected.symbol, affected.exchange, affected.currency
    FROM (
      SELECT o.portfolio_id, o.symbol, o.exchange, o.currency
      FROM old_portfolio_transactions AS o
      UNION
      SELECT n.portfolio_id, n.symbol, n.exchange, n.currency
      FROM new_portfolio_transactions AS n
    ) AS affected
    ORDER BY affected.portfolio_id, affected.symbol, affected.exchange, affected.currency
  LOOP
    PERFORM portfolio_private.rebuild_portfolio_holding(
      position.portfolio_id, position.symbol, position.exchange, position.currency
    );
  END LOOP;
  RETURN NULL;
END;
$function$;

CREATE TRIGGER portfolios_set_updated_at
BEFORE UPDATE ON public.portfolios
FOR EACH ROW EXECUTE FUNCTION portfolio_private.set_portfolio_updated_at();

CREATE TRIGGER portfolio_transactions_lock_ledger
BEFORE INSERT OR UPDATE OR DELETE ON public.portfolio_transactions
FOR EACH ROW EXECUTE FUNCTION portfolio_private.lock_portfolio_transaction_ledger();

CREATE TRIGGER portfolio_transactions_set_updated_at
BEFORE UPDATE ON public.portfolio_transactions
FOR EACH ROW EXECUTE FUNCTION portfolio_private.set_portfolio_updated_at();

CREATE TRIGGER portfolio_transactions_rebuild_after_insert
AFTER INSERT ON public.portfolio_transactions
REFERENCING NEW TABLE AS new_portfolio_transactions
FOR EACH STATEMENT EXECUTE FUNCTION portfolio_private.refresh_holdings_after_insert();

CREATE TRIGGER portfolio_transactions_rebuild_after_delete
AFTER DELETE ON public.portfolio_transactions
REFERENCING OLD TABLE AS old_portfolio_transactions
FOR EACH STATEMENT EXECUTE FUNCTION portfolio_private.refresh_holdings_after_delete();

CREATE TRIGGER portfolio_transactions_rebuild_after_update
AFTER UPDATE ON public.portfolio_transactions
REFERENCING OLD TABLE AS old_portfolio_transactions NEW TABLE AS new_portfolio_transactions
FOR EACH STATEMENT EXECUTE FUNCTION portfolio_private.refresh_holdings_after_update();

ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_holdings ENABLE ROW LEVEL SECURITY;

CREATE POLICY portfolios_select_own
ON public.portfolios FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY portfolios_insert_own
ON public.portfolios FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY portfolios_update_own
ON public.portfolios FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY portfolios_delete_own
ON public.portfolios FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY portfolio_transactions_select_own
ON public.portfolio_transactions FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.portfolios AS p
    WHERE p.id = portfolio_id
      AND p.user_id = (SELECT auth.uid())
  )
);

CREATE POLICY portfolio_transactions_insert_own
ON public.portfolio_transactions FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.portfolios AS p
    WHERE p.id = portfolio_id
      AND p.user_id = (SELECT auth.uid())
  )
);

CREATE POLICY portfolio_transactions_update_own
ON public.portfolio_transactions FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.portfolios AS p
    WHERE p.id = portfolio_id
      AND p.user_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.portfolios AS p
    WHERE p.id = portfolio_id
      AND p.user_id = (SELECT auth.uid())
  )
);

CREATE POLICY portfolio_transactions_delete_own
ON public.portfolio_transactions FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.portfolios AS p
    WHERE p.id = portfolio_id
      AND p.user_id = (SELECT auth.uid())
  )
);

CREATE POLICY portfolio_holdings_select_own
ON public.portfolio_holdings FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.portfolios AS p
    WHERE p.id = portfolio_id
      AND p.user_id = (SELECT auth.uid())
  )
);

REVOKE ALL ON TABLE
  public.portfolios,
  public.portfolio_transactions,
  public.portfolio_holdings
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, DELETE ON TABLE public.portfolios TO authenticated;
GRANT INSERT (user_id, name, base_currency)
  ON TABLE public.portfolios TO authenticated;
GRANT UPDATE (name, base_currency)
  ON TABLE public.portfolios TO authenticated;

GRANT SELECT, DELETE ON TABLE public.portfolio_transactions TO authenticated;
GRANT INSERT (
  portfolio_id, symbol, exchange, currency, transaction_type,
  quantity, unit_price, fees, executed_at
) ON TABLE public.portfolio_transactions TO authenticated;
GRANT UPDATE (
  symbol, exchange, currency, transaction_type, quantity, unit_price, fees, executed_at
) ON TABLE public.portfolio_transactions TO authenticated;

GRANT SELECT ON TABLE public.portfolio_holdings TO authenticated;

REVOKE ALL ON FUNCTION portfolio_private.set_portfolio_updated_at()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION portfolio_private.lock_portfolio_transaction_ledger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION portfolio_private.rebuild_portfolio_holding(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION portfolio_private.refresh_holdings_after_insert()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION portfolio_private.refresh_holdings_after_delete()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION portfolio_private.refresh_holdings_after_update()
  FROM PUBLIC, anon, authenticated, service_role;
