import { createFileRoute } from "@tanstack/react-router";
import { VerifyPhonePage } from "@/components/store/auth";
import { pageHead } from "@/lib/store/catalogue";
export const Route = createFileRoute("/verify-phone")({
  validateSearch: (s: Record<string, unknown>): { next?: string | undefined } => ({
    next: typeof s["next"] === "string" ? s["next"] : undefined,
  }),
  head: () =>
    pageHead(
      "Verify Your Mobile Number",
      "Confirm the mobile number on your YEARTH STORE account.",
    ),
  component: function Page() {
    const q = Route.useSearch();
    return <VerifyPhonePage next={q.next} />;
  },
});
