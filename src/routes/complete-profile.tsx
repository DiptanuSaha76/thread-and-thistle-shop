import { createFileRoute } from "@tanstack/react-router";
import { CompleteProfilePage } from "@/components/store/auth";
import { pageHead } from "@/lib/store/catalogue";
export const Route = createFileRoute("/complete-profile")({
  validateSearch: (
    s: Record<string, unknown>,
  ): { next?: string | undefined; edit?: boolean | undefined } => ({
    next: typeof s["next"] === "string" ? s["next"] : undefined,
    edit: s["edit"] === true || s["edit"] === "true" ? true : undefined,
  }),
  head: () =>
    pageHead(
      "Complete Your Profile",
      "Add your name and mobile number to your YEARTH STORE account.",
    ),
  component: function Page() {
    const q = Route.useSearch();
    return <CompleteProfilePage next={q.next} edit={q.edit} />;
  },
});
