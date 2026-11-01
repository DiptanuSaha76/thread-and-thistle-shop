import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthSessionMissingError } from "@supabase/supabase-js";

// ---- Fakes: Supabase client and router (no network, no real project) ----------------------
type Listener = (event: string, session: { user: { id: string } } | null) => void;
type Reply = { data: unknown; error: unknown };
const fake = vi.hoisted(() => ({
  listener: null as Listener | null,
  getUser: null as null | (() => Promise<{ data: { user: unknown }; error: unknown }>),
  profiles: new Map<string, Array<() => Promise<Reply>>>(),
  ensure: vi.fn(async () => ({ data: null, error: null })),
  navigate: vi.fn(),
  unsubscribe: vi.fn(),
  // The real router object is stable between renders; so is this one.
  router: { invalidate: vi.fn(), navigate: vi.fn() },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: Listener) => {
        fake.listener = cb;
        return { data: { subscription: { unsubscribe: fake.unsubscribe } } };
      },
      getUser: () => fake.getUser!(),
      signOut: vi.fn(async () => ({ error: null })),
    },
    from: () => ({
      select: () => ({
        eq: (_column: string, id: string) => ({
          maybeSingle: () => {
            const queue = fake.profiles.get(id) ?? [];
            const next = queue.length > 1 ? queue.shift()! : queue[0];
            return next ? next() : Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    }),
    rpc: (name: string) =>
      name === "ensure_my_profile" ? fake.ensure() : Promise.resolve({ data: null, error: null }),
  },
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => fake.router,
  useNavigate: () => fake.navigate,
}));

import { AuthProvider, useAuth, useCompleteProfileGate } from "./auth";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  email: "c@example.com",
  first_name: "Asha",
  last_name: "Rao",
  name: "Asha Rao",
  phone: "+919876543210",
  phone_country: "IN",
  phone_verified_at: "2026-10-29T10:00:00Z",
  ...over,
});
const ok = (data: unknown) => () => Promise.resolve({ data, error: null });
function deferred() {
  let resolve!: (value: Reply) => void;
  const promise = new Promise<Reply>((r) => (resolve = r));
  return { promise, resolve };
}
const signedIn = (id: string) => {
  fake.getUser = () => Promise.resolve({ data: { user: { id } }, error: null });
};

function Probe() {
  const auth = useAuth();
  const holding = useCompleteProfileGate("/checkout");
  return (
    <pre data-testid="state">
      {JSON.stringify({
        step: auth.step,
        profileReady: auth.profileReady,
        profileError: auth.profileError,
        first: auth.profile?.first_name ?? null,
        id: auth.profile?.id ?? null,
        holding,
      })}
    </pre>
  );
}
const state = () => JSON.parse(screen.getByTestId("state").textContent ?? "{}");
const flush = () => act(async () => {});
function mount() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fake.listener = null;
  fake.profiles.clear();
  fake.ensure.mockClear();
  fake.navigate.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AuthProvider", () => {
  it("does not crash on a profile row with NULL name and phone (the email-link crash)", async () => {
    signedIn(A);
    fake.profiles.set(A, [
      ok(row(A, { first_name: null, last_name: null, phone: null, phone_verified_at: null })),
    ]);
    mount();
    await flush();
    expect(state()).toMatchObject({ step: "complete_profile", first: "", holding: true });
    expect(fake.navigate).toHaveBeenCalledWith({
      to: "/complete-profile",
      search: { next: "/checkout" },
      replace: true,
    });
  });

  it("creates a missing profile once, then asks for SMS verification", async () => {
    signedIn(A);
    fake.profiles.set(A, [ok(null), ok(row(A, { phone_verified_at: null }))]);
    mount();
    await flush();
    expect(fake.ensure).toHaveBeenCalledTimes(1);
    expect(state()).toMatchObject({ step: "verify_phone", first: "Asha", holding: true });
    expect(fake.navigate).toHaveBeenCalledWith({
      to: "/verify-phone",
      search: { next: "/checkout" },
      replace: true,
    });
  });

  it("holds the page without redirecting while the profile is loading", async () => {
    signedIn(A);
    const pending = deferred();
    fake.profiles.set(A, [() => pending.promise]);
    mount();
    await flush();
    expect(state()).toMatchObject({ step: "loading", profileReady: false, holding: false });
    expect(fake.navigate).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ data: row(A), error: null }));
    expect(state()).toMatchObject({ step: "ready", holding: false });
    expect(fake.navigate).not.toHaveBeenCalled();
  });

  it("shows a profile error instead of redirecting or signing out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    signedIn(A);
    fake.profiles.set(A, [() => Promise.resolve({ data: null, error: { message: "boom" } })]);
    mount();
    await flush();
    expect(state()).toMatchObject({ step: "profile_error", holding: false });
    expect(state().profileError).toMatch(/could not be loaded/);
    expect(fake.navigate).not.toHaveBeenCalled();
  });

  it("treats an expired session as signed out", async () => {
    fake.getUser = () =>
      Promise.resolve({ data: { user: null }, error: new AuthSessionMissingError() });
    mount();
    await flush();
    expect(state()).toMatchObject({ step: "signed_out", holding: false });
    expect(fake.navigate).not.toHaveBeenCalled();
  });

  it("ignores a slow profile reply for a previous user", async () => {
    signedIn(A);
    const slowA = deferred();
    fake.profiles.set(A, [() => slowA.promise]);
    fake.profiles.set(B, [ok(row(B, { first_name: "Bina" }))]);
    mount();
    await flush();
    await act(async () => fake.listener!("SIGNED_IN", { user: { id: B } }));
    await flush();
    await act(async () => slowA.resolve({ data: row(A), error: null }));
    expect(state()).toMatchObject({ step: "ready", id: B, first: "Bina" });
  });

  it("does not update state after it is unmounted", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    signedIn(A);
    const pending = deferred();
    fake.profiles.set(A, [() => pending.promise]);
    const view = mount();
    await flush();
    view.unmount();
    await act(async () => pending.resolve({ data: row(A), error: null }));
    expect(fake.unsubscribe).toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("lets complete, verified customers through without redirecting", async () => {
    signedIn(A);
    fake.profiles.set(A, [ok(row(A))]);
    mount();
    await flush();
    expect(state()).toMatchObject({ step: "ready", holding: false });
    expect(fake.navigate).not.toHaveBeenCalled();
  });
});
