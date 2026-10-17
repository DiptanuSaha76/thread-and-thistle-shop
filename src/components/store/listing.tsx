import { useState } from "react";
import {
  SlidersHorizontal,
  ChevronDown,
  LayoutGrid,
  List,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Breadcrumb, ProductGrid, Modal } from "./shared";
import { products, sizes, money, stock, shopSettings, productColours, productSizes } from "@/lib/store/catalogue";
import { useStore } from "@/lib/store/state";
export function Listing({ collection = "T-Shirts" }: { collection?: string }) {
  useStore();
  const max = shopSettings.priceMax, min = shopSettings.priceMin, on = (f: string) => shopSettings.filters.includes(f);
  const [inStock, setInStock] = useState(false),
    [topRated, setTopRated] = useState(false),
    [onSale, setOnSale] = useState(false);
  const [selectedSizes, setSizes] = useState<string[]>([]),
    [selectedColours, setColours] = useState<string[]>([]),
    [categories, setCategories] = useState<string[]>([]),
    [price, setPrice] = useState(Infinity),
    [sort, setSort] = useState("Featured"),
    [list, setList] = useState(false),
    [sheet, setSheet] = useState(""),
    [page, setPage] = useState(1);
  const toggle = (value: string, values: string[], set: (v: string[]) => void) => {
    set(values.includes(value) ? values.filter((x) => x !== value) : [...values, value]);
    setPage(1);
  };
  const clear = () => {
    setSizes([]);
    setColours([]);
    setCategories([]);
    setPrice(Infinity);
    setInStock(false);
    setTopRated(false);
    setOnSale(false);
    setPage(1);
  };
  const filtered = products
    .filter(
      (p) =>
        p.price <= price &&
        (!categories.length || categories.includes(p.category)) &&
        (!selectedColours.length || productColours(p).some((c) => selectedColours.includes(c))) &&
        (!selectedSizes.length ||
          selectedSizes.some((s) => productColours(p).some((c) => stock(p, c, s) > 0))) &&
        (!inStock || productColours(p).some((c) => productSizes(p).some((s) => stock(p, c, s) > 0))) &&
        (!topRated || p.rating >= 4.5) &&
        (!onSale || (!!p.compareAt && p.compareAt > p.price)),
    )
    .sort((a, b) =>
      sort === "Price: Low to High"
        ? a.price - b.price
        : sort === "Price: High to Low"
          ? b.price - a.price
          : sort === "Top Rated"
            ? b.rating - a.rating
            : sort === "Newest"
              ? products.indexOf(b) - products.indexOf(a)
              : products.indexOf(a) - products.indexOf(b),
    );
  const count =
    selectedSizes.length + selectedColours.length + categories.length + (price < max ? 1 : 0) + +inStock + +topRated + +onSale;
  const sortControl = (
    <select
      className="field sort-select"
      aria-label="Sort products"
      value={sort}
      onChange={(e) => {
        setSort(e.target.value);
        setPage(1);
      }}
    >
      {["Featured", "Newest", "Price: Low to High", "Price: High to Low", "Top Rated"].map((s) => (
        <option key={s}>{s}</option>
      ))}
    </select>
  );
  const filters = (
    <div className="filter-groups">
      <div className="filter-heading">
        <b>FILTERS {count > 0 && `(${count})`}</b>
        <Button variant="link" size="sm" onClick={clear}>
          Clear all
        </Button>
      </div>
      {on("Category") && <details open>
        <summary>Category</summary>
        {shopSettings.categories.map((c) => (
          <label className="check-row" key={c}>
            <input
              type="checkbox"
              checked={categories.includes(c)}
              onChange={() => toggle(c, categories, setCategories)}
            />
            {c}
            <small>{products.filter((p) => p.category === c).length}</small>
          </label>
        ))}
      </details>}
      {on("Size") && <details open>
        <summary>Size</summary>
        <div className="size-row">
          {sizes.map((s) => (
            <Button
              size="sm"
              key={s}
              variant={selectedSizes.includes(s) ? "default" : "outline"}
              aria-pressed={selectedSizes.includes(s)}
              onClick={() => toggle(s, selectedSizes, setSizes)}
            >
              {s}
            </Button>
          ))}
        </div>
      </details>}
      {on("Color") && <details open>
        <summary>Color</summary>
        {shopSettings.colours.map(({ name: c, hex }) => (
          <label className="check-row" key={c}>
            <input
              type="checkbox"
              checked={selectedColours.includes(c)}
              onChange={() => toggle(c, selectedColours, setColours)}
            />
            <span className="colour-dot" style={{ backgroundColor: hex }} />
            {c}
            <small>{products.filter((p) => productColours(p).includes(c)).length}</small>
          </label>
        ))}
      </details>}
      {on("Price") && <details open>
        <summary>Price Range</summary>
        <input
          className="price-range"
          aria-label="Maximum price"
          type="range"
          min={min}
          max={max}
          step="10"
          value={Math.min(price, max)}
          onChange={(e) => {
            setPrice(Number(e.target.value));
            setPage(1);
          }}
        />
        <div className="range-labels">
          <span>{money(min)}</span>
          <span>{money(Math.min(price, max))}</span>
        </div>
      </details>}
      {(on("Availability") || on("Rating") || on("On Sale")) && <details open>
        <summary>More filters</summary>
        {on("Availability") && <label className="check-row"><input type="checkbox" checked={inStock} onChange={(e) => { setInStock(e.target.checked); setPage(1); }} />In stock only</label>}
        {on("Rating") && <label className="check-row"><input type="checkbox" checked={topRated} onChange={(e) => { setTopRated(e.target.checked); setPage(1); }} />Rated 4.5+</label>}
        {on("On Sale") && <label className="check-row"><input type="checkbox" checked={onSale} onChange={(e) => { setOnSale(e.target.checked); setPage(1); }} />On sale</label>}
      </details>}
    </div>
  );
  return (
    <>
      <section className="collection-banner">
        <div className="container">
          <Breadcrumb name={collection} />
          <div className="page-title-row">
            <div>
              <span className="eyebrow">THE EVERYDAY COLLECTION</span>
              <h1>{collection.toUpperCase()}</h1>
              <p>Premium oversized t-shirts for everyday comfort.</p>
            </div>
            <span>{filtered.length} Products</span>
          </div>
        </div>
      </section>
      <section className="container listing-layout">
        <aside className="filter-sidebar">{filters}</aside>
        <div className="listing-main">
          <div className="mobile-filter-chips">
            {["Filters", "Size", "Color", "Sort"].map((label) => (
              <Button
                key={label}
                variant={label === "Filters" ? "default" : "outline"}
                onClick={() => setSheet(label)}
              >
                {label === "Filters" ? <SlidersHorizontal /> : null}
                {label}
                {label === "Filters" && count > 0 ? ` (${count})` : null}
                <ChevronDown />
              </Button>
            ))}
          </div>
          <div className="listing-toolbar">
            <div className="sort-wrap">
              <span>Sort by:</span>
              {sortControl}
            </div>
            <div className="view-toggle">
              <Button
                variant={!list ? "secondary" : "ghost"}
                size="icon"
                aria-label="Grid view"
                aria-pressed={!list}
                onClick={() => setList(false)}
              >
                <LayoutGrid />
              </Button>
              <Button
                variant={list ? "secondary" : "ghost"}
                size="icon"
                aria-label="List view"
                aria-pressed={list}
                onClick={() => setList(true)}
              >
                <List />
              </Button>
            </div>
          </div>
          {filtered.length ? (
            <ProductGrid
              items={filtered.slice((page - 1) * 6, page * 6)}
              showSwatches
              list={list}
            />
          ) : (
            <div className="empty-state">
              <SlidersHorizontal />
              <h2>No pieces found</h2>
              <p>Try opening up your filters a little.</p>
              <Button onClick={clear}>Clear filters</Button>
            </div>
          )}
          {filtered.length > 6 && (
            <nav className="pagination" aria-label="Product pages">
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous page"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft />
              </Button>
              {Array.from({ length: Math.ceil(filtered.length / 6) }, (_, i) => i + 1).map((n) => (
                <Button
                  key={n}
                  variant={n === page ? "default" : "outline"}
                  aria-current={n === page ? "page" : undefined}
                  onClick={() => setPage(n)}
                >
                  {n}
                </Button>
              ))}
              <Button
                variant="outline"
                size="icon"
                aria-label="Next page"
                disabled={page >= Math.ceil(filtered.length / 6)}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight />
              </Button>
            </nav>
          )}
          
        </div>
      </section>
      <div className="mobile-bottom-filter">
        <Button variant="ghost" onClick={() => setSheet("Filters")}>
          <SlidersHorizontal />
          Filters {count > 0 && `(${count})`}
        </Button>
        <Button variant="ghost" onClick={() => setSheet("Sort")}>
          <List />
          Sort
        </Button>
      </div>
      <Modal
        open={!!sheet}
        onOpenChange={(o) => {
          if (!o) setSheet("");
        }}
        title={sheet === "Sort" ? "Sort by" : "Refine your collection"}
        drawer
      >
        {sheet === "Sort" ? sortControl : filters}
        <Button size="lg" onClick={() => setSheet("")}>
          Show {filtered.length} products
        </Button>
      </Modal>
    </>
  );
}
