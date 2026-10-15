import { createFileRoute } from "@tanstack/react-router";
import { CartPage } from "@/components/store/cart";
import { pageHead } from "@/lib/store/catalogue";
export const Route = createFileRoute("/cart")({
  head: () =>
    pageHead(
      "Your Cart",
      "Review your YEARTH shopping bag, update quantities and continue to checkout.",
    ),
  component: CartPage,
});
