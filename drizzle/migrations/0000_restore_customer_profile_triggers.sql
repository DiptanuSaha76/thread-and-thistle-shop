REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (name) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
COMMENT ON COLUMN public.profiles.first_name IS 'DEPRECATED: replaced by name';
COMMENT ON COLUMN public.profiles.last_name IS 'DEPRECATED: replaced by name';
COMMENT ON COLUMN public.profiles.phone IS 'DEPRECATED: not collected or used';
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