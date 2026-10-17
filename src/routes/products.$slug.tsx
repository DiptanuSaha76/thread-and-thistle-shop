import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store/state";
import { ProductDetail } from "@/components/store/product-detail";
import { products, pageHead } from "@/lib/store/catalogue";
export const Route = createFileRoute("/products/$slug")({
  loader: ({ params }) => {
    const p = products.find((p) => p.slug === params.slug);
    return p ? { ...p, slug: params.slug } : { slug: params.slug, missing: true as const };
  },
  head: ({ loaderData }) =>
    pageHead(
      loaderData && "name" in loaderData ? loaderData.name : "Product",
      loaderData && "name" in loaderData
        ? `${loaderData.name}: premium 240 GSM oversized cotton, ₹${loaderData.price}. Choose your colour and fit at THE YEARTH STORE.`
        : "This YEARTH product is unavailable.",
    ),
  component: Product,
});
function Product() {
  const data = Route.useLoaderData();
  const store = useStore();
  const p = products.find((x) => x.slug === data.slug) ?? ("name" in data ? data : undefined);
  if (!p)
    return (
      <section className="container empty-state">
        <h1>{store.catalogueReady ? "Product unavailable" : "Loading…"}</h1>
      </section>
    );
  return <ProductDetail key={p.id + store.version} product={p} />;
}
