import { createFileRoute } from "@tanstack/react-router";
import { OrdersPage } from "@/components/store/orders";
import { pageHead } from "@/lib/store/catalogue";
export const Route = createFileRoute("/orders")({
  head: () =>
    pageHead("My Orders", "View your YEARTH demo orders, track progress and manage orders."),
  component: OrdersPage,
});
