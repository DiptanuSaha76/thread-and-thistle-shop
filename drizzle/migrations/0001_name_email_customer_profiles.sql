ALTER TABLE public.profiles ADD COLUMN name text NOT NULL DEFAULT '' CHECK (char_length(name) <= 200), ADD COLUMN email text NOT NULL DEFAULT '' CHECK (char_length(email) <= 255);
UPDATE public.profiles p SET name = trim(p.first_name || ' ' || p.last_name), email = coalesce(u.email, '') FROM auth.users u WHERE u.id = p.id;
COMMENT ON COLUMN public.profiles.first_name IS 'DEPRECATED: replaced by name';
COMMENT ON COLUMN public.profiles.last_name IS 'DEPRECATED: replaced by name';
COMMENT ON COLUMN public.profiles.phone IS 'DEPRECATED: not collected or used';
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (name) ON public.profiles TO authenticated;
CREATE OR REPLACE FUNCTION public.create_customer_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 INSERT INTO public.profiles (id, name, email) VALUES (NEW.id, left(coalesce(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', ''),200), coalesce(NEW.email,''));
 RETURN NEW;
END;
$$;
CREATE FUNCTION public.sync_customer_email() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 UPDATE public.profiles SET email = coalesce(NEW.email,'') WHERE id = NEW.id;
 RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_customer_email() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER customer_email_changed AFTER UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION public.sync_customer_email();