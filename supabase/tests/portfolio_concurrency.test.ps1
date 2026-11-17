$ErrorActionPreference = 'Stop'

if (-not $env:LOCAL_SUPABASE_DB_URL) {
  throw 'Set LOCAL_SUPABASE_DB_URL to a disposable local Supabase database URL.'
}

$databaseUri = [Uri]$env:LOCAL_SUPABASE_DB_URL
if ($databaseUri.Host -notin @('localhost', '127.0.0.1', '::1')) {
  throw 'Refusing to run: LOCAL_SUPABASE_DB_URL must use a loopback host.'
}

$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
  throw 'psql is required. Install PostgreSQL client tools or the Supabase CLI.'
}

function Start-PsqlSession {
  param(
    [Parameter(Mandatory)] [string] $Sql
  )

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new($psql.Source)
  $startInfo.Arguments = "--no-psqlrc --dbname `"$env:LOCAL_SUPABASE_DB_URL`" --set=ON_ERROR_STOP=1"
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.UseShellExecute = $false
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw 'Could not start psql session.'
  }

  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  $process.StandardInput.WriteLine($Sql)
  $process.StandardInput.Close()

  return [pscustomobject]@{
    Process = $process
    Stdout = $stdout
    Stderr = $stderr
  }
}

function Wait-PsqlSession {
  param([Parameter(Mandatory)] $Session)

  $Session.Process.WaitForExit()
  return [pscustomobject]@{
    ExitCode = $Session.Process.ExitCode
    Stdout = $Session.Stdout.GetAwaiter().GetResult()
    Stderr = $Session.Stderr.GetAwaiter().GetResult()
  }
}

function Invoke-Psql {
  param([Parameter(Mandatory)] [string] $Sql)

  $session = Start-PsqlSession -Sql $Sql
  $result = Wait-PsqlSession -Session $session
  if ($result.ExitCode -ne 0) {
    throw "Local SQL setup/verification failed: $($result.Stderr)"
  }
  return $result.Stdout.Trim()
}

$ownerId = [guid]::NewGuid().ToString()
$portfolioId = [guid]::NewGuid().ToString()
$email = "portfolio-concurrency-$ownerId@example.test"
$fixtureCreated = $false

try {
  Invoke-Psql @"
BEGIN;
INSERT INTO auth.users (id, aud, role, email)
VALUES ('$ownerId', 'authenticated', 'authenticated', '$email');
INSERT INTO public.portfolios (id, user_id, name)
VALUES ('$portfolioId', '$ownerId', 'Concurrency $portfolioId');
INSERT INTO public.portfolio_transactions (
  portfolio_id, symbol, exchange, currency, transaction_type,
  quantity, unit_price, fees, executed_at
)
VALUES (
  '$portfolioId', 'TCS', 'NSE', 'INR', 'BUY', 10, 100, 0,
  '2026-01-01T10:00:00Z'
);
COMMIT;
"@ | Out-Null
  $fixtureCreated = $true

  $writerA = Start-PsqlSession -Sql @"
BEGIN;
SELECT id FROM public.portfolios WHERE id = '$portfolioId' FOR UPDATE;
SELECT pg_sleep(3);
INSERT INTO public.portfolio_transactions (
  portfolio_id, symbol, exchange, currency, transaction_type,
  quantity, unit_price, fees, executed_at
)
VALUES (
  '$portfolioId', 'TCS', 'NSE', 'INR', 'SELL', 7, 110, 0,
  '2026-02-01T10:00:00Z'
);
COMMIT;
"@

  $writerB = Start-PsqlSession -Sql @"
BEGIN;
INSERT INTO public.portfolio_transactions (
  portfolio_id, symbol, exchange, currency, transaction_type,
  quantity, unit_price, fees, executed_at
)
VALUES (
  '$portfolioId', 'TCS', 'NSE', 'INR', 'SELL', 7, 110, 0,
  '2026-03-01T10:00:00Z'
);
COMMIT;
"@

  $resultA = Wait-PsqlSession -Session $writerA
  $resultB = Wait-PsqlSession -Session $writerB

  if (($resultA.ExitCode -eq 0) -eq ($resultB.ExitCode -eq 0)) {
    throw 'Expected exactly one concurrent sale to commit and the other to be rejected.'
  }

  $state = Invoke-Psql @"
SELECT h.quantity::text || ',' || count(t.id)::text
FROM public.portfolio_holdings AS h
JOIN public.portfolio_transactions AS t ON t.portfolio_id = h.portfolio_id
WHERE h.portfolio_id = '$portfolioId'
  AND h.symbol = 'TCS' AND h.exchange = 'NSE' AND h.currency = 'INR'
GROUP BY h.quantity;
"@
  if ($state -ne '3,2') {
    throw "Expected holding quantity 3 with one committed sale; got '$state'."
  }

  'PASS: concurrent writers serialized; one sale committed and the oversell rolled back.'
}
finally {
  if ($fixtureCreated) {
    Invoke-Psql "DELETE FROM auth.users WHERE id = '$ownerId';" | Out-Null
  }
}
