import { createFileRoute } from "@tanstack/react-router";
import { AccountPage } from "@/components/store/information";
import { pageHead } from "@/lib/store/catalogue";
export const Route = createFileRoute("/account")({
  head: () =>
    pageHead("Your Account", "Manage your YEARTH account, saved favourites and order history."),
  component: AccountPage,
});
