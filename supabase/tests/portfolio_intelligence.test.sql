BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(27);

INSERT INTO auth.users (id, aud, role, email)
VALUES
  ('a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'portfolio-owner-a@example.test'),
  ('a1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'portfolio-owner-b@example.test');

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

INSERT INTO public.portfolios (user_id, name)
VALUES (
  'a1000000-0000-4000-8000-000000000001',
  'Average cost test'
);

INSERT INTO public.portfolios (user_id, name)
VALUES (
  'a1000000-0000-4000-8000-000000000001',
  'Secondary test portfolio'
);

SELECT is(
  (SELECT count(*) FROM public.portfolios),
  2::bigint,
  'one user can own multiple portfolios'
);

SELECT ok(
  (SELECT count(*) = 6
      AND bool_and(
        NOT has_function_privilege('anon', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
        AND NOT has_function_privilege('service_role', f.oid, 'EXECUTE')
      )
      AND NOT has_schema_privilege('anon', 'portfolio_private', 'USAGE')
      AND NOT has_schema_privilege('authenticated', 'portfolio_private', 'USAGE')
      AND NOT has_schema_privilege('service_role', 'portfolio_private', 'USAGE')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_proc AS public_function
        JOIN pg_namespace AS public_schema ON public_schema.oid = public_function.pronamespace
        CROSS JOIN LATERAL aclexplode(
          COALESCE(public_function.proacl, acldefault('f', public_function.proowner))
        ) AS privilege
        WHERE public_schema.nspname = 'portfolio_private'
          AND privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      )
   FROM pg_proc AS f
   JOIN pg_namespace AS n ON n.oid = f.pronamespace
   WHERE n.nspname = 'portfolio_private'),
  'API roles and PUBLIC cannot execute private trigger functions'
);
SELECT throws_ok(
  $$SELECT portfolio_private.rebuild_portfolio_holding(
      '00000000-0000-4000-8000-000000000000', 'TCS', 'NSE', 'INR'
    )$$,
  '42501',
  'permission denied for schema portfolio_private',
  'authenticated users cannot call the privileged recalculation function'
);

INSERT INTO public.portfolio_transactions (
  portfolio_id, symbol, exchange, currency, transaction_type,
  quantity, unit_price, fees, executed_at
)
VALUES
  (
    (SELECT id FROM public.portfolios WHERE name = 'Average cost test'),
    'TCS', 'NSE', 'INR', 'BUY', 10, 100, 10, '2026-01-01T10:00:00Z'
  ),
  (
    (SELECT id FROM public.portfolios WHERE name = 'Average cost test'),
    'TCS', 'NSE', 'INR', 'SELL', 4, 120, 4, '2026-02-01T10:00:00Z'
  );

SELECT is(
  (SELECT quantity FROM public.portfolio_holdings
  WHERE portfolio_id = (SELECT id FROM public.portfolios WHERE name = 'Average cost test')
     AND symbol = 'TCS' AND exchange = 'NSE' AND currency = 'INR'),
  6::numeric,
  'partial sale retains the unsold quantity'
);
SELECT is(
  (SELECT average_purchase_price FROM public.portfolio_holdings
  WHERE portfolio_id = (SELECT id FROM public.portfolios WHERE name = 'Average cost test')
     AND symbol = 'TCS' AND exchange = 'NSE' AND currency = 'INR'),
  101::numeric,
  'buy fees are included in average purchase cost'
);
SELECT is(
  (SELECT realized_pnl FROM public.portfolio_holdings
  WHERE portfolio_id = (SELECT id FROM public.portfolios WHERE name = 'Average cost test')
     AND symbol = 'TCS' AND exchange = 'NSE' AND currency = 'INR'),
  72::numeric,
  'partial-sale fees reduce realized profit'
);

INSERT INTO public.portfolio_transactions (
  portfolio_id, symbol, exchange, currency, transaction_type,
  quantity, unit_price, fees, executed_at
)
VALUES (
  (SELECT id FROM public.portfolios WHERE name = 'Average cost test'),
  'TCS', 'NSE', 'INR', 'SELL', 6, 110, 6, '2026-03-01T10:00:00Z'
);

SELECT is(
  (SELECT quantity FROM public.portfolio_holdings
  WHERE portfolio_id = (SELECT id FROM public.portfolios WHERE name = 'Average cost test')
     AND symbol = 'TCS' AND exchange = 'NSE' AND currency = 'INR'),
  0::numeric,
  'complete sale retains the closed position history'
);
SELECT is(
  (SELECT average_purchase_price FROM public.portfolio_holdings
  WHERE portfolio_id = (SELECT id FROM public.portfolios WHERE name = 'Average cost test')
     AND symbol = 'TCS' AND exchange = 'NSE' AND currency = 'INR'),
  0::numeric,
  'average cost resets to zero after a complete sale'
);
SELECT is(
  (SELECT realized_pnl FROM public.portfolio_holdings
  WHERE portfolio_id = (SELECT id FROM public.portfolios WHERE name = 'Average cost test')
     AND symbol = 'TCS' AND exchange = 'NSE' AND currency = 'INR'),
  120::numeric,
  'realized profit includes buy and both sell fees'
);

SELECT throws_ok(
  $$INSERT INTO public.portfolio_transactions (
      portfolio_id, symbol, exchange, currency, transaction_type,
      quantity, unit_price, executed_at
    ) VALUES (
      (SELECT id FROM public.portfolios WHERE name = 'Average cost test'),
      'TCS', 'NSE', 'INR', 'SELL', 1, 100, '2026-04-01T10:00:00Z'
    )$$,
  '23514',
  'portfolio transaction would result in an oversold holding',
  'rejects a sale after the position is fully closed'
);

SELECT throws_ok(
  $$INSERT INTO public.portfolio_transactions (
      portfolio_id, symbol, exchange, currency, transaction_type,
      quantity, unit_price
    ) VALUES (
      (SELECT id FROM public.portfolios WHERE name = 'Average cost test'),
      'INFY', 'NSE', 'INR', 'BUY', 0, 100
    )$$,
  '23514',
  'new row for relation "portfolio_transactions" violates check constraint "portfolio_transactions_quantity_check"',
  'rejects a zero-quantity transaction'
);

INSERT INTO public.portfolio_transactions (
  portfolio_id, symbol, exchange, currency, transaction_type,
  quantity, unit_price, fees, executed_at
)
VALUES
  (
    (SELECT id FROM public.portfolios WHERE name = 'Average cost test'),
    'RELIANCE', 'NSE', 'INR', 'BUY', 10, 10, 0, '2026-01-01T10:00:00Z'
  ),
  (
    (SELECT id FROM public.portfolios WHERE name = 'Average cost test'),
    'RELIANCE', 'NSE', 'INR', 'SELL', 6, 12, 0, '2026-02-01T10:00:00Z'
  );

SELECT set_config(
  'test.portfolio_id',
  (SELECT id::text FROM public.portfolios WHERE name = 'Average cost test'),
  true
);
SELECT set_config(
  'test.transaction_id',
  (SELECT id::text FROM public.portfolio_transactions
   WHERE symbol = 'RELIANCE' AND transaction_type = 'BUY'),
  true
);

SELECT throws_ok(
  $$INSERT INTO public.portfolio_transactions (
      portfolio_id, symbol, exchange, currency, transaction_type,
      quantity, unit_price, executed_at
    ) VALUES (
      (SELECT id FROM public.portfolios WHERE name = 'Average cost test'),
      'RELIANCE', 'NSE', 'INR', 'SELL', 5, 13, '2026-03-01T10:00:00Z'
    )$$,
  '23514',
  'portfolio transaction would result in an oversold holding',
  'rejects a sale larger than the remaining position'
);
SELECT ok(
  (SELECT count(*) = 1 FROM public.portfolio_transactions
   WHERE portfolio_id = (SELECT id FROM public.portfolios WHERE name = 'Average cost test')
     AND symbol = 'RELIANCE' AND transaction_type = 'SELL')
  AND (SELECT quantity = 4 FROM public.portfolio_holdings
       WHERE portfolio_id = (SELECT id FROM public.portfolios WHERE name = 'Average cost test')
         AND symbol = 'RELIANCE' AND exchange = 'NSE' AND currency = 'INR'),
  'failed oversell leaves both ledger and holding unchanged'
);

SELECT throws_ok(
  $$UPDATE public.portfolio_transactions
    SET quantity = 5
    WHERE portfolio_id = (SELECT id FROM public.portfolios WHERE name = 'Average cost test')
      AND symbol = 'RELIANCE' AND transaction_type = 'BUY'$$,
  '23514',
  'portfolio transaction would result in an oversold holding',
  'rejects a historical edit that would cause an oversell'
);
SELECT is(
  (SELECT quantity FROM public.portfolio_transactions
   WHERE portfolio_id = (SELECT id FROM public.portfolios WHERE name = 'Average cost test')
     AND symbol = 'RELIANCE' AND transaction_type = 'BUY'),
  10::numeric,
  'failed historical edit is rolled back'
);

SELECT throws_ok(
  $$DELETE FROM public.portfolio_transactions
    WHERE portfolio_id = (SELECT id FROM public.portfolios WHERE name = 'Average cost test')
      AND symbol = 'RELIANCE' AND transaction_type = 'BUY'$$,
  '23514',
  'portfolio transaction would result in an oversold holding',
  'rejects deleting a historical buy that would cause an oversell'
);
SELECT is(
  (SELECT count(*) FROM public.portfolio_transactions
   WHERE portfolio_id = (SELECT id FROM public.portfolios WHERE name = 'Average cost test')
     AND symbol = 'RELIANCE' AND transaction_type = 'BUY'),
  1::bigint,
  'failed historical delete is rolled back'
);

INSERT INTO public.portfolio_transactions (
  portfolio_id, symbol, exchange, currency, transaction_type,
  quantity, unit_price, executed_at
)
VALUES (
  (SELECT id FROM public.portfolios WHERE name = 'Average cost test'),
  'INFY', 'NSE', 'INR', 'BUY', 3, 50, '2026-01-01T10:00:00Z'
);
SELECT set_config(
  'test.symbol_transaction_id',
  (SELECT id::text FROM public.portfolio_transactions
   WHERE symbol = 'INFY' AND transaction_type = 'BUY'),
  true
);
UPDATE public.portfolio_transactions
SET symbol = 'WIPRO'
WHERE id = current_setting('test.symbol_transaction_id')::uuid;

SELECT is(
  (SELECT count(*) FROM public.portfolio_holdings
   WHERE portfolio_id = (SELECT id FROM public.portfolios WHERE name = 'Average cost test')
     AND symbol = 'INFY'),
  0::bigint,
  'symbol change removes the old derived holding'
);
SELECT is(
  (SELECT quantity FROM public.portfolio_holdings
   WHERE portfolio_id = (SELECT id FROM public.portfolios WHERE name = 'Average cost test')
     AND symbol = 'WIPRO' AND exchange = 'NSE' AND currency = 'INR'),
  3::numeric,
  'symbol change creates the new derived holding'
);

SELECT throws_ok(
  $$INSERT INTO public.portfolio_holdings (
      portfolio_id, symbol, exchange, currency, quantity,
      average_purchase_price, realized_pnl
    ) VALUES (
      (SELECT id FROM public.portfolios WHERE name = 'Average cost test'),
      'FAKE', 'NSE', 'INR', 1, 1, 0
    )$$,
  '42501',
  'permission denied for table portfolio_holdings',
  'authenticated clients cannot write derived holdings directly'
);

SELECT set_config(
  'request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

SELECT is(
  (SELECT count(*) FROM public.portfolios
  WHERE name = 'Average cost test'),
  0::bigint,
  'another user cannot read the portfolio'
);
SELECT is(
  (SELECT count(*) FROM public.portfolio_transactions
  WHERE portfolio_id = (SELECT id FROM public.portfolios WHERE name = 'Average cost test')),
  0::bigint,
  'another user cannot read its transactions'
);
SELECT is(
  (SELECT count(*) FROM public.portfolio_holdings
  WHERE portfolio_id = (SELECT id FROM public.portfolios WHERE name = 'Average cost test')),
  0::bigint,
  'another user cannot read its derived holdings'
);
SELECT throws_ok(
  $$INSERT INTO public.portfolios (user_id, name)
    VALUES ('a1000000-0000-4000-8000-000000000001', 'Foreign portfolio')$$,
  '42501',
  'new row violates row-level security policy for table "portfolios"',
  'another user cannot create a portfolio for someone else'
);
SELECT throws_ok(
  $$INSERT INTO public.portfolio_transactions (
      portfolio_id, symbol, exchange, currency, transaction_type,
      quantity, unit_price
    ) VALUES (
      current_setting('test.portfolio_id')::uuid,
      'TCS', 'NSE', 'INR', 'BUY', 1, 100
    )$$,
  '42501',
  'new row violates row-level security policy for table "portfolio_transactions"',
  'another user cannot add transactions to someone else portfolio'
);
UPDATE public.portfolio_transactions SET unit_price = 999
WHERE id = current_setting('test.transaction_id')::uuid;
SELECT is(
  (SELECT count(*) FROM public.portfolio_transactions
   WHERE id = current_setting('test.transaction_id')::uuid
     AND unit_price = 999),
  0::bigint,
  'another user cannot update someone else transaction'
);
DELETE FROM public.portfolio_transactions
WHERE id = current_setting('test.transaction_id')::uuid;
SELECT is(
  (SELECT count(*) FROM public.portfolio_transactions
   WHERE id = current_setting('test.transaction_id')::uuid),
  0::bigint,
  'another user cannot delete someone else transaction'
);

SELECT * FROM finish();
ROLLBACK;
