CREATE TABLE public.profiles (
 id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 first_name text NOT NULL DEFAULT '' CHECK (char_length(first_name) <= 100),
 last_name text NOT NULL DEFAULT '' CHECK (char_length(last_name) <= 100),
 phone text NOT NULL DEFAULT '' CHECK (char_length(phone) <= 20),
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own profile" ON public.profiles FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id);
CREATE POLICY "Update own profile" ON public.profiles FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = id) WITH CHECK ((SELECT auth.uid()) = id);
CREATE FUNCTION public.create_customer_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 INSERT INTO public.profiles (id, first_name, last_name, phone) VALUES (NEW.id, left(coalesce(NEW.raw_user_meta_data->>'first_name', NEW.raw_user_meta_data->>'full_name', ''),100), left(coalesce(NEW.raw_user_meta_data->>'last_name',''),100), left(coalesce(NEW.raw_user_meta_data->>'phone',''),20));
 RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_customer_profile() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER customer_profile_on_signup AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.create_customer_profile();