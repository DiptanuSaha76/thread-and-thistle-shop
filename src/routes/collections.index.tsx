import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Breadcrumb, ProductGrid } from "@/components/store/shared";
import { products, pageHead } from "@/lib/store/catalogue";
export const Route = createFileRoute("/collections/")({
  head: () =>
    pageHead(
      "Collections",
      "Explore THE YEARTH STORE collections. Premium oversized tees and considered everyday streetwear.",
    ),
  component: CollectionsIndex,
});
function CollectionsIndex() {
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
      <p className="collection-note">8 considered colours & styles · Premium 240 GSM cotton</p>
      <div className="collections-cards">
        <ProductGrid items={products.slice(0, 4)} />
      </div>
    </section>
  );
}
