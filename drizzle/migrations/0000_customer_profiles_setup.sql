ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '';
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (name) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Update own profile" ON public.profiles;
CREATE POLICY "Read own profile" ON public.profiles FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id);
CREATE POLICY "Update own profile" ON public.profiles FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = id) WITH CHECK ((SELECT auth.uid()) = id);
CREATE OR REPLACE FUNCTION public.create_customer_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 INSERT INTO public.profiles (id, name, email) VALUES (NEW.id, left(coalesce(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', ''),200), coalesce(NEW.email,''));
 RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_customer_profile() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS customer_profile_on_signup ON auth.users;
CREATE TRIGGER customer_profile_on_signup AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.create_customer_profile();
CREATE OR REPLACE FUNCTION public.sync_customer_email() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 UPDATE public.profiles SET email = coalesce(NEW.email,'') WHERE id = NEW.id;
 RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_customer_email() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS customer_email_changed ON auth.users;
CREATE TRIGGER customer_email_changed AFTER UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION public.sync_customer_email();