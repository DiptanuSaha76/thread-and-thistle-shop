import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Heart,
  ChevronLeft,
  ChevronRight,
  ShoppingBag,
  ArrowRight,
  Truck,
  Ruler,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Breadcrumb, Swatches, Quantity, Benefits, Related, Modal } from "./shared";
import { useStore } from "@/lib/store/state";
import { money, sizes, imageFor, productColours, productSizes, stock, type Product } from "@/lib/store/catalogue";
export function ProductDetail({ product }: { product: Product }) {
  const store = useStore(),
    navigate = useNavigate();
  const [colour, setColour] = useState(product.colour),
    [size, setSize] = useState(""),
    [quantity, setQuantity] = useState(1),
    [error, setError] = useState(""),
    [guide, setGuide] = useState(false),
    [index, setIndex] = useState(0);
  const extra = (product.images ?? []).filter((x) => x !== imageFor(product, colour));
  const images = [imageFor(product, colour), ...extra, product.image]
    .filter((x, i, a) => x && a.indexOf(x) === i)
    .slice(0, 6);
  const productSizeList = productSizes(product);
  const available = stock(product, colour, size) > 0;
  const add = (buy = false) => {
    if (!size) {
      setError("Please select a size before adding to your bag.");
      return;
    }
    if (!available) return;
    store.add({ productId: product.id, colour, size, quantity });
    setError("");
    if (buy) navigate({ to: "/checkout" });
  };
  return (
    <>
      <div className="container product-page">
        <Breadcrumb name={product.name} />
        <div className="product-detail-layout">
          <div className="gallery">
            <div className="thumbnails">
              {images.map((image, i) => (
                <Button
                  key={i}
                  variant="outline"
                  className={index === i ? "thumbnail selected" : "thumbnail"}
                  aria-label={`View image ${i + 1}`}
                  onClick={() => setIndex(i)}
                >
                  <img src={image} alt={`${product.name} view ${i + 1}`} />
                </Button>
              ))}
            </div>
            <div className={`main-product-image gallery-view-${index}`}>
              <img
                src={images[index] ?? images[0]}
                alt={`${colour} oversized t-shirt, view ${index + 1}`}
                width="480"
                height="1024"
              />
              <Button
                variant="floating"
                size="icon"
                className="heart-control"
                aria-label="Toggle product wishlist"
                aria-pressed={store.wishlist.includes(product.id)}
                onClick={() => store.wish(product.id)}
              >
                <Heart className={store.wishlist.includes(product.id) ? "heart-filled" : ""} />
              </Button>
              <Button
                variant="floating"
                size="icon"
                className="gallery-prev"
                aria-label="Previous image"
                onClick={() => setIndex((index + images.length - 1) % images.length)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="floating"
                size="icon"
                className="gallery-next"
                aria-label="Next image"
                onClick={() => setIndex((index + 1) % images.length)}
              >
                <ChevronRight />
              </Button>
              <span className="image-count">{index + 1} / {images.length}</span>
            </div>
          </div>
          <div className="product-info">
            {product.badge && <span className="info-badge">{product.badge}</span>}
            <h1>{product.name.toUpperCase()}</h1>
            <p className="detail-rating">
              ★★★★★{" "}
              <span>
                {product.rating} · {product.reviews} sample reviews
              </span>
            </p>
            <div className="detail-price">
              {money(product.price)}
              <small>Inclusive of all taxes</small>
            </div>
            <p className="product-description">
              {product.description ||
                "Premium oversized t-shirt made with 240 GSM cotton. Designed for everyday comfort with a relaxed fit."}
            </p>
            <div className="variant-group">
              <p>
                Colour: <b>{colour}</b>
              </p>
              <Swatches
                names={productColours(product)}
                selected={colour}
                onChange={(c) => {
                  setColour(c);
                  setIndex(0);
                }}
              />
            </div>
            <div className="variant-group">
              <div className="size-label">
                <p>
                  Size: <b>{size || "Select size"}</b>
                </p>
                <Button variant="link" size="sm" onClick={() => setGuide(true)}>
                  <Ruler />
                  Size Guide
                </Button>
              </div>
              <div className="size-row">
                {productSizeList.map((s) => (
                  <Button
                    key={s}
                    disabled={stock(product, colour, s) === 0}
                    variant={s === size ? "default" : "outline"}
                    aria-pressed={s === size}
                    onClick={() => {
                      setSize(s);
                      setError("");
                    }}
                  >
                    {s}
                  </Button>
                ))}
              </div>
              {error && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="purchase-meta">
              <Quantity value={quantity} onChange={setQuantity} />
              <span className={available ? "stock text-success" : "stock text-destructive"}>
                <Check size={14} />
                {available ? "In Stock" : "Out of stock"}
              </span>
            </div>
            <p className="delivery">
              <Truck size={17} /> Ships in 1–2 days · Pan India delivery
            </p>
            <Button size="lg" className="full-button" disabled={!available} onClick={() => add()}>
              <ShoppingBag />
              ADD TO CART <ArrowRight />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="full-button"
              disabled={!available}
              onClick={() => add(true)}
            >
              BUY NOW <ArrowRight />
            </Button>
            <Benefits compact />
            <div className="product-accordions">
              {[
                [
                  "Product Details",
                  "100% premium cotton. 240 GSM heavyweight fabric with a clean crew neck and dropped shoulders.",
                ],
                [
                  "Size & Fit",
                  "Relaxed oversized silhouette. Choose your usual size for an oversized fit, or size down for a closer fit.",
                ],
                [
                  "Shipping & Returns",
                  "Ships in 1–2 days. Free shipping on orders above ₹999; ₹79 otherwise. 7 days easy returns & exchanges.",
                ],
                [
                  "Care Instructions",
                  "Machine wash cold, inside out with similar colours. Do not bleach. Dry in shade. Iron on low heat.",
                ],
              ].map(([title, text]) => (
                <details key={title}>
                  <summary>{title}</summary>
                  <p>{text}</p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </div>
      <Related exclude={product.id} />
      <Modal
        open={guide}
        onOpenChange={setGuide}
        title="Size Guide"
        description="Oversized fit · Measurements in inches"
      >
        <table className="size-table">
          <thead>
            <tr>
              <th>Size</th>
              <th>Chest</th>
              <th>Length</th>
              <th>Shoulder</th>
            </tr>
          </thead>
          <tbody>
            {sizes.map((s, i) => (
              <tr key={s}>
                <th>{s}</th>
                <td>{40 + i * 2}</td>
                <td>{27 + i}</td>
                <td>{20 + i}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Choose your usual size for our signature oversized fit. Sample measurements; allow a
          1-inch variation.
        </p>
      </Modal>
    </>
  );
}
