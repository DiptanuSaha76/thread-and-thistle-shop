import { createFileRoute } from "@tanstack/react-router";
import { InformationPage } from "@/components/store/information";
import { pageHead } from "@/lib/store/catalogue";
export const Route = createFileRoute("/help")({
  head: () =>
    pageHead(
      "Help Centre",
      "Help Centre for THE YEARTH STORE. Find clear information about your shopping experience.",
    ),
  component: () => <InformationPage type="help" />,
});
