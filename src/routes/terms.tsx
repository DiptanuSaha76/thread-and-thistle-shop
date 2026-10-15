import { createFileRoute } from "@tanstack/react-router";
import { InformationPage } from "@/components/store/information";
import { pageHead } from "@/lib/store/catalogue";
export const Route = createFileRoute("/terms")({
  head: () =>
    pageHead(
      "Terms & Conditions",
      "Terms & Conditions for THE YEARTH STORE. Find clear information about your shopping experience.",
    ),
  component: () => <InformationPage type="terms" />,
});
