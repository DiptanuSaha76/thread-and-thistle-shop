import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store/state";
import { ProductDetail } from "@/components/store/product-detail";
import { products, pageHead } from "@/lib/store/catalogue";

export const Route = createFileRoute("/products/$slug")({
  loader: ({ params }) => {
    // This shared array can still be empty while the browser fetch is in flight.
    const product = products.find((item) => item.slug === params.slug);
    return product ? { ...product, slug: params.slug } : { slug: params.slug, missing: true as const };
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
  // Re-check the shared array after StoreProvider finishes loading the catalogue.
  const product = products.find((item) => item.slug === data.slug) ?? ("name" in data ? data : undefined);

  if (!product) {
    return (
      <section className="container empty-state" role="status">
        <h1>
          {!store.catalogueReady
            ? "Loading…"
            : store.catalogueError
              ? "Products couldn't be loaded"
              : "Product unavailable"}
        </h1>
        {store.catalogueError && <p>Please refresh the page and try again.</p>}
      </section>
    );
  }

  return <ProductDetail key={`${product.id}-${store.version}`} product={product} />;
}
