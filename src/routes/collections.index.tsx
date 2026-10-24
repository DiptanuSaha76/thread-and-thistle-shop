import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Breadcrumb, ProductGrid } from "@/components/store/shared";
import { products, pageHead } from "@/lib/store/catalogue";
import { useStore } from "@/lib/store/state";

export const Route = createFileRoute("/collections/")({
  head: () =>
    pageHead(
      "Collections",
      "Explore THE YEARTH STORE collections. Premium oversized tees and considered everyday streetwear.",
    ),
  component: CollectionsIndex,
});

function CollectionsIndex() {
  const store = useStore();

  return (
    <section className="container standard-page">
      <Breadcrumb name="Collections" />
      <div className="collections-intro">
        <span className="eyebrow">LESS, BUT BETTER</span>
        <h1>Our Collections</h1>
        <p className="page-subtitle">The pieces that make every day feel like you.</p>
      </div>
      <Link to="/collections/$slug" params={{ slug: "t-shirts" }} className="collection-tile-title">
        T-SHIRTS <ArrowRight size={20} />
      </Link>
      <p className="collection-note">Colours &amp; styles · Premium 240 GSM cotton</p>
      <div className="collections-cards">
        {products.length > 0 ? (
          <ProductGrid key={store.version} items={products.slice(0, 4)} />
        ) : (
          <p className="info-note" role="status">
            {!store.catalogueReady
              ? "Loading products…"
              : store.catalogueError
                ? "We couldn't load products right now. Please refresh the page."
                : "No products are currently available."}
          </p>
        )}
      </div>
    </section>
  );
}
