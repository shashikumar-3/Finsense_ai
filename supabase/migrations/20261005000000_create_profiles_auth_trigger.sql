CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text,
  username text,
  avatar text,
  avatar_url text,
  auth_provider text NOT NULL DEFAULT 'email',
  membership text NOT NULL DEFAULT 'Starter account',
  plan_status text NOT NULL DEFAULT 'Active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX profiles_username_idx ON public.profiles (username);

CREATE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  metadata jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
BEGIN
  INSERT INTO public.profiles (
    id,
    display_name,
    username,
    avatar,
    avatar_url,
    auth_provider,
    membership,
    plan_status
  )
  VALUES (
    NEW.id,
    COALESCE(metadata ->> 'full_name', metadata ->> 'name', NEW.email, 'FinSense user'),
    COALESCE(
      metadata ->> 'username',
      NULLIF(lower(split_part(COALESCE(NEW.email, ''), '@', 1)), ''),
      'user-' || replace(NEW.id::text, '-', '')
    ),
    metadata ->> 'avatar',
    COALESCE(metadata ->> 'avatar_url', metadata ->> 'picture'),
    COALESCE(NEW.raw_app_meta_data ->> 'provider', metadata ->> 'auth_provider', 'email'),
    COALESCE(metadata ->> 'membership', 'Starter account'),
    COALESCE(metadata ->> 'plan_status', 'Active')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE FUNCTION public.set_profile_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER profiles_set_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_profile_updated_at();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own
ON public.profiles FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()));

CREATE POLICY profiles_insert_own
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY profiles_update_own
ON public.profiles FOR UPDATE TO authenticated
USING (id = (SELECT auth.uid()))
WITH CHECK (id = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_profile_updated_at() FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.profiles (
  id,
  display_name,
  username,
  avatar,
  avatar_url,
  auth_provider,
  membership,
  plan_status
)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', u.email, 'FinSense user'),
  COALESCE(
    u.raw_user_meta_data ->> 'username',
    NULLIF(lower(split_part(COALESCE(u.email, ''), '@', 1)), ''),
    'user-' || replace(u.id::text, '-', '')
  ),
  u.raw_user_meta_data ->> 'avatar',
  COALESCE(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture'),
  COALESCE(u.raw_app_meta_data ->> 'provider', u.raw_user_meta_data ->> 'auth_provider', 'email'),
  COALESCE(u.raw_user_meta_data ->> 'membership', 'Starter account'),
  COALESCE(u.raw_user_meta_data ->> 'plan_status', 'Active')
FROM auth.users AS u
ON CONFLICT (id) DO NOTHING;
