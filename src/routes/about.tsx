import { createFileRoute } from "@tanstack/react-router";
import { AboutPage } from "@/components/store/information";
import { pageHead } from "@/lib/store/catalogue";
export const Route = createFileRoute("/about")({
  head: () =>
    pageHead(
      "About YEARTH",
      "Considered everyday clothing. Discover THE YEARTH STORE and our premium cotton essentials.",
    ),
  component: AboutPage,
});
