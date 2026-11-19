/**
 * Shiprocket fulfilment API client. SERVER ONLY.
 *
 * This module can create a Shiprocket order, quote serviceability, assign an AWB,
 * request a pickup, and generate a label/manifest. It is intentionally called only
 * from authenticated server functions; no Shiprocket credential or bearer token
 * is returned to the browser.
 */

import { createHash } from "node:crypto";

type UnknownRecord = Record<string, unknown>;

export type CourierQuote = {
  courierId: number;
  courierName: string;
  rate: number | null;
  estimatedDays: string | null;
  etd: string | null;
  codAvailable: boolean;
};

export type ParcelMeasurements = {
  weightKg: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
};

export type ProductShippingSpec = {
  id: string;
  shipping_weight_kg: number | string | null;
  shipping_length_cm: number | string | null;
  shipping_breadth_cm: number | string | null;
  shipping_height_cm: number | string | null;
};

export type ShippingCartItem = { productId: string; quantity: number };

type PickupProfile = { pickupPincode: string; pickupLocation: string };

export type FulfilmentOrder = {
  id: string;
  order_number: string;
  created_at: string;
  status: string;
  payment_method: string;
  payment_status: string;
  subtotal: number | string;
  shipping: number | string;
  discount: number | string;
  ship_name: string;
  ship_phone: string;
  ship_address: string;
  ship_city: string;
  ship_state: string;
  ship_pincode: string;
  order_items: Array<{
    id: string;
    product_id: string | null;
    product_name: string;
    product_slug: string;
    colour: string;
    size: string;
    quantity: number | string;
    unit_price: number | string;
  }>;
};

export type CreatedShipment = {
  shiprocketOrderId: number;
  shiprocketShipmentId: number;
};

/** Stable numeric source reference for Shiprocket. Shiprocket documents that its
 * custom-order reference is a string but advises avoiding alphabetic characters.
 * The hash keeps the reference deterministic for safe reconciliation/retries.
 */
export function buildShiprocketReference(yearthOrderId: string): string {
  const digest = createHash("sha256").update(`YEARTH|${yearthOrderId}`).digest("hex");
  const numeric = (BigInt(`0x${digest.slice(0, 14)}`) % 900_000_000_000_000n) + 100_000_000_000_000n;
  return numeric.toString();
}

export type ShiprocketNdrCase = {
  id: number | null;
  shipmentId: number | null;
  awb: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  productName: string;
  courierName: string;
  reason: string;
  attempts: number;
  raisedAt: string;
  escalationStatus: string;
};

export type AwbResult = { awb: string; courierName: string | null };
export type PickupResult = {
  pickupStatus: string;
  labelUrl: string | null;
  manifestUrl: string | null;
  labelError: boolean;
  manifestError: boolean;
};

export class ShiprocketFulfilmentError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "ShiprocketFulfilmentError";
  }
}

const BASE_URL = "https://apiv2.shiprocket.in";
const TIMEOUT_MS = 20_000;
const TOKEN_TTL_MS = 9 * 24 * 60 * 60 * 1000;
// Reuse the Shiprocket token across requests while the server process stays warm.
let sharedToken: string | null = null;
let sharedTokenExpiresAt = 0;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function readText(value: unknown, max = 200): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function readNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function nestedRecord(body: unknown): UnknownRecord {
  const root = asRecord(body);
  if (!root) return {};
  const response = asRecord(root["response"]);
  const data = asRecord(root["data"]);
  return asRecord(data?.["data"]) ?? data ?? response ?? root;
}

function nestedValue(body: unknown, keys: string[]): unknown {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const seen = new Set<object>();
  function visit(value: unknown, depth: number): unknown {
    if (depth > 8 || !value || typeof value !== "object") return undefined;
    if (seen.has(value as object)) return undefined;
    seen.add(value as object);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found !== undefined && found !== null) return found;
      }
      return undefined;
    }
    const record = value as UnknownRecord;
    for (const [key, child] of Object.entries(record)) {
      if (wanted.has(key.toLowerCase()) && child !== undefined && child !== null) return child;
    }
    for (const child of Object.values(record)) {
      const found = visit(child, depth + 1);
      if (found !== undefined && found !== null) return found;
    }
    return undefined;
  }
  return visit(body, 0);
}

function collectRecords(value: unknown, output: UnknownRecord[] = [], depth = 0, seen = new Set<object>()): UnknownRecord[] {
  if (depth > 8 || !value || typeof value !== "object" || seen.has(value as object)) return output;
  seen.add(value as object);
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, output, depth + 1, seen);
    return output;
  }
  const record = value as UnknownRecord;
  output.push(record);
  for (const child of Object.values(record)) collectRecords(child, output, depth + 1, seen);
  return output;
}

function findArrayByKey(value: unknown, keys: string[], depth = 0, seen = new Set<object>()): unknown[] | null {
  if (depth > 8 || !value || typeof value !== "object" || seen.has(value as object)) return null;
  seen.add(value as object);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findArrayByKey(item, keys, depth + 1, seen);
      if (found) return found;
    }
    return null;
  }
  const record = value as UnknownRecord;
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const [key, child] of Object.entries(record)) {
    if (wanted.has(key.toLowerCase()) && Array.isArray(child)) return child;
  }
  for (const child of Object.values(record)) {
    const found = findArrayByKey(child, keys, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

function responseShape(value: unknown): string {
  const seen = new Set<object>();
  function shape(item: unknown, depth: number): string {
    if (depth > 4) return "…";
    if (!item || typeof item !== "object") return Array.isArray(item) ? "[]" : typeof item;
    if (seen.has(item as object)) return "[circular]";
    seen.add(item as object);
    if (Array.isArray(item)) return item.length ? `[${shape(item[0], depth + 1)}]` : "[]";
    const record = item as UnknownRecord;
    return `{${Object.entries(record).slice(0, 24).map(([key, child]) => `${key}:${shape(child, depth + 1)}`).join(",")}}`;
  }
  return shape(value, 0).slice(0, 900);
}

function deepNumber(value: unknown, keys: string[], excludedValues: number[] = []): number | null {
  const priority = new Map(keys.map((key, index) => [key.toLowerCase(), index]));
  const excluded = new Set(excludedValues.filter((value) => Number.isSafeInteger(value)));
  const candidates: Array<{ rank: number; depth: number; value: number }> = [];
  const seen = new Set<object>();

  function visit(item: unknown, depth: number) {
    if (depth > 10 || !item || typeof item !== "object" || seen.has(item as object)) return;
    seen.add(item as object);
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(item as UnknownRecord)) {
      const rank = priority.get(key.toLowerCase());
      if (rank !== undefined) {
        const parsed = readNumber(child);
        if (parsed !== null && Number.isSafeInteger(parsed) && parsed > 0 && !excluded.has(parsed)) {
          candidates.push({ rank, depth, value: parsed });
        }
      }
      visit(child, depth + 1);
    }
  }

  visit(value, 0);
  candidates.sort((a, b) => a.rank - b.rank || a.depth - b.depth);
  return candidates[0]?.value ?? null;
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1500) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ShiprocketFulfilmentError(`Configure ${name} in your server environment first.`);
  return value;
}

function getPickupProfile(): PickupProfile {
  if (process.env["SHIPROCKET_FULFILLMENT_ENABLED"]?.trim().toLowerCase() !== "true") {
    throw new ShiprocketFulfilmentError("Shiprocket fulfilment is disabled. Set SHIPROCKET_FULFILLMENT_ENABLED=true on the server.");
  }
  const pickupPincode = process.env["SHIPROCKET_PICKUP_PINCODE"]?.trim() || "799120";
  const pickupLocation = requiredEnv("SHIPROCKET_PICKUP_LOCATION");
  if (!/^\d{6}$/.test(pickupPincode)) throw new ShiprocketFulfilmentError("SHIPROCKET_PICKUP_PINCODE must be a six-digit PIN code.");
  return { pickupPincode, pickupLocation };
}

function positiveMeasure(value: unknown, label: string, max: number): number {
  const parsed = readNumber(value);
  if (parsed === null || parsed <= 0 || parsed > max) {
    throw new ShiprocketFulfilmentError(`${label} must be greater than 0 and at most ${max}.`);
  }
  return parsed;
}

export function validateParcelMeasurements(parcel: ParcelMeasurements): ParcelMeasurements {
  return {
    weightKg: positiveMeasure(parcel.weightKg, "Parcel weight (kg)", 30),
    lengthCm: positiveMeasure(parcel.lengthCm, "Parcel length (cm)", 200),
    breadthCm: positiveMeasure(parcel.breadthCm, "Parcel breadth (cm)", 200),
    heightCm: positiveMeasure(parcel.heightCm, "Parcel height (cm)", 200),
  };
}

/**
 * Estimate a parcel for the read-only PIN checker from per-product packed-unit data.
 * The weight is summed by quantity; the estimate stacks products using the largest
 * length/breadth and summed heights. Admin must enter the final measured outer parcel
 * dimensions before creating a real Shiprocket shipment.
 */
export function estimateParcelFromProducts(
  products: ProductShippingSpec[],
  items: ShippingCartItem[],
): ParcelMeasurements {
  if (!items.length || items.length > 50) throw new ShiprocketFulfilmentError("Your cart does not contain a valid number of shipping items.");
  const byId = new Map(products.map((product) => [product.id, product]));
  let weightKg = 0;
  let lengthCm = 0;
  let breadthCm = 0;
  let heightCm = 0;
  let totalUnits = 0;

  for (const item of items) {
    if (!item.productId || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) {
      throw new ShiprocketFulfilmentError("One or more cart items have invalid shipping quantities.");
    }
    const product = byId.get(item.productId);
    if (!product) throw new ShiprocketFulfilmentError("A product in your cart is no longer available for shipping. Refresh your cart.");
    const unitWeight = positiveMeasure(product.shipping_weight_kg, `Shipping weight for product ${item.productId}`, 30);
    const unitLength = positiveMeasure(product.shipping_length_cm, `Package length for product ${item.productId}`, 200);
    const unitBreadth = positiveMeasure(product.shipping_breadth_cm, `Package breadth for product ${item.productId}`, 200);
    const unitHeight = positiveMeasure(product.shipping_height_cm, `Package height for product ${item.productId}`, 200);
    weightKg += unitWeight * item.quantity;
    lengthCm = Math.max(lengthCm, unitLength);
    breadthCm = Math.max(breadthCm, unitBreadth);
    heightCm += unitHeight * item.quantity;
    totalUnits += item.quantity;
  }

  if (totalUnits > 100) throw new ShiprocketFulfilmentError("Your cart exceeds the maximum shipment item count.");
  return validateParcelMeasurements({
    weightKg: Math.round(weightKg * 1000) / 1000,
    lengthCm,
    breadthCm,
    heightCm,
  });
}

function money(value: number | string | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { first: (parts.shift() || "Customer").slice(0, 50), last: parts.join(" ").slice(0, 50) };
}

function extractCourierQuotes(body: unknown): CourierQuote[] {
  const rowsValue = nestedValue(body, ["available_courier_companies"]);
  const rows = Array.isArray(rowsValue) ? rowsValue : [];
  return rows
    .map((item) => asRecord(item))
    .filter((item): item is UnknownRecord => !!item)
    .map((item) => ({
      courierId: readNumber(item["courier_company_id"] ?? item["id"]) ?? 0,
      courierName: readText(item["courier_name"], 100) || "Courier",
      rate: readNumber(item["rate"] ?? item["freight_charge"] ?? item["cost"]),
      estimatedDays: readText(item["estimated_delivery_days"], 40) || null,
      etd: readText(item["etd"], 50) || null,
      codAvailable: Number(item["cod"] ?? 0) === 1 || item["cod"] === true,
    }))
    .filter((item) => item.courierId > 0)
    .sort((a, b) => (a.rate ?? Number.MAX_SAFE_INTEGER) - (b.rate ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 20);
}

export function createShiprocketFulfilmentClient(fetchImpl: typeof fetch = fetch) {
  const email = requiredEnv("SHIPROCKET_API_EMAIL");
  const password = requiredEnv("SHIPROCKET_API_PASSWORD");
  async function rawRequest(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(`${BASE_URL}${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new ShiprocketFulfilmentError("Shiprocket could not be reached. Check your connection and try again.");
    }
  }

  async function login(force = false): Promise<string> {
    if (!force && sharedToken && Date.now() < sharedTokenExpiresAt) return sharedToken;
    const response = await rawRequest("/v1/external/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new ShiprocketFulfilmentError("Shiprocket API user authentication failed. Check the second API user's email/password and active status.");
      throw new ShiprocketFulfilmentError(`Shiprocket authentication failed (HTTP ${response.status}).`);
    }
    const nextToken = nestedValue(body, ["token"]);
    if (typeof nextToken !== "string" || nextToken.length < 20) throw new ShiprocketFulfilmentError("Shiprocket returned an invalid authentication token.");
    sharedToken = nextToken;
    sharedTokenExpiresAt = Date.now() + TOKEN_TTL_MS;
    return sharedToken;
  }

  async function request(path: string, method: "GET" | "POST", payload?: UnknownRecord, retry = true): Promise<unknown> {
    const bearer = await login();
    const response = await rawRequest(path, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${bearer}`,
        ...(payload ? { "content-type": "application/json" } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    if (response.status === 401 && retry) {
      await login(true);
      return request(path, method, payload, false);
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new ShiprocketFulfilmentError("Shiprocket rejected the API request. Check API user permissions.");
      if (response.status === 429) throw new ShiprocketFulfilmentError("Shiprocket API rate limit reached. Please wait and retry.");
      const root = asRecord(body);
      const message = readText(root?.["message"] ?? root?.["error"] ?? root?.["errors"], 220);
      throw new ShiprocketFulfilmentError(message || `Shiprocket API request failed (HTTP ${response.status}).`);
    }
    const root = asRecord(body);
    if (root?.["status"] === false || root?.["success"] === false) {
      const message = readText(root["message"] ?? root["error"], 220);
      throw new ShiprocketFulfilmentError(message || "Shiprocket could not complete that action.");
    }
    return body;
  }

  function dimensionsQuery(parcel: ParcelMeasurements) {
    const validated = validateParcelMeasurements(parcel);
    return {
      length: String(validated.lengthCm),
      breadth: String(validated.breadthCm),
      height: String(validated.heightCm),
      weight: String(validated.weightKg),
    };
  }

  async function checkByPincode(input: {
    deliveryPincode: string;
    cod: boolean;
    declaredValue?: number;
    parcel: ParcelMeasurements;
  }) {
    const profile = getPickupProfile();
    if (!/^\d{6}$/.test(input.deliveryPincode)) throw new ShiprocketFulfilmentError("Enter a valid six-digit delivery PIN code.");
    const parcel = validateParcelMeasurements(input.parcel);
    const params = new URLSearchParams({
      pickup_postcode: profile.pickupPincode,
      delivery_postcode: input.deliveryPincode,
      cod: input.cod ? "1" : "0",
      ...dimensionsQuery(parcel),
    });
    if (input.declaredValue && input.declaredValue > 0) params.set("declared_value", String(Math.round(input.declaredValue)));
    const body = await request(`/v1/external/courier/serviceability/?${params.toString()}`, "GET");
    return {
      pickupPincode: profile.pickupPincode,
      deliveryPincode: input.deliveryPincode,
      weightKg: parcel.weightKg,
      couriers: extractCourierQuotes(body),
    };
  }

  async function checkForOrder(input: { shiprocketOrderId: number; deliveryPincode: string }) {
    const profile = getPickupProfile();
    const params = new URLSearchParams({
      pickup_postcode: profile.pickupPincode,
      delivery_postcode: input.deliveryPincode,
      order_id: String(input.shiprocketOrderId),
    });
    const body = await request(`/v1/external/courier/serviceability/?${params.toString()}`, "GET");
    return extractCourierQuotes(body);
  }

  async function createOrder(order: FulfilmentOrder, customerEmail: string, rawParcel: ParcelMeasurements, sourceReference: string): Promise<CreatedShipment> {
    const profile = getPickupProfile();
    const parcel = validateParcelMeasurements(rawParcel);
    const itemCount = order.order_items.reduce((sum, item) => sum + Math.max(0, Math.floor(money(item.quantity))), 0);
    if (!itemCount || !order.order_items.length) throw new ShiprocketFulfilmentError("This order has no valid shipment items.");
    const { first, last } = splitName(order.ship_name);
    const phone = order.ship_phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    if (!/^[6-9]\d{9}$/.test(phone)) throw new ShiprocketFulfilmentError("The order has an invalid Indian mobile number. Update the customer address before creating a shipment.");
    if (!/^[1-9]\d{5}$/.test(order.ship_pincode)) throw new ShiprocketFulfilmentError("The order has an invalid delivery PIN code.");
    if (!customerEmail || !customerEmail.includes("@")) throw new ShiprocketFulfilmentError("The customer account has no valid email address for Shiprocket.");

    const orderItems = order.order_items.map((item) => ({
      name: `${readText(item.product_name, 90) || "YEARTH product"} - ${readText(item.colour, 24)} / ${readText(item.size, 12)}`.slice(0, 120),
      sku: readText([item.product_slug || item.product_id || item.id, item.colour, item.size].filter(Boolean).join("-"), 80).replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-"),
      units: Math.max(1, Math.floor(money(item.quantity))),
      selling_price: money(item.unit_price),
      discount: 0,
      tax: 0,
      hsn: "",
    }));
    const subtotal = money(order.subtotal);
    if (!/^\d{12,15}$/.test(sourceReference)) throw new ShiprocketFulfilmentError("The Shiprocket source reference must be a 12–15 digit numeric value.");
    const payload: UnknownRecord = {
      // This is YEARTH's source/channel reference. Shiprocket returns its own
      // internal numeric order_id separately; future calls must use that ID.
      order_id: sourceReference,
      comment: `YEARTH order ${readText(order.order_number, 40)}`,
      order_date: new Date(order.created_at).toISOString().slice(0, 19).replace("T", " "),
      pickup_location: profile.pickupLocation,
      billing_customer_name: first,
      billing_last_name: last,
      billing_address: readText(order.ship_address, 180),
      billing_address_2: "",
      billing_city: readText(order.ship_city, 60),
      billing_pincode: Number(order.ship_pincode),
      billing_state: readText(order.ship_state, 60),
      billing_country: "India",
      billing_email: customerEmail,
      billing_phone: Number(phone),
      shipping_is_billing: true,
      order_items: orderItems,
      payment_method: order.payment_method.toLowerCase() === "cod" ? "COD" : "Prepaid",
      shipping_charges: money(order.shipping),
      giftwrap_charges: 0,
      transaction_charges: 0,
      total_discount: money(order.discount),
      sub_total: subtotal,
      length: parcel.lengthCm,
      breadth: parcel.breadthCm,
      height: parcel.heightCm,
      weight: parcel.weightKg,
    };
    const body = await request("/v1/external/orders/create/adhoc", "POST", payload);
    let shiprocketOrderId = deepNumber(body, ["shiprocket_order_id", "order_id"], [Number(sourceReference)]);
    // Some response wrappers echo the submitted channel reference at a shallow
    // level and return Shiprocket's real internal order_id under payload/data.
    // Exclude the source reference during traversal so the parser can continue
    // and select the nested internal order ID instead of discarding the first match.
    let shiprocketShipmentId = deepNumber(body, ["shiprocket_shipment_id", "shipment_id"]);
    if (!shiprocketShipmentId) {
      const shipments = findArrayByKey(body, ["shipments", "shipment"]);
      const firstShipment = shipments?.length ? asRecord(shipments[0]) : null;
      shiprocketShipmentId = readNumber(firstShipment?.["shipment_id"] ?? firstShipment?.["id"]);
    }

    // Shiprocket's create response normally returns internal order_id and
    // shipment_id. Parse all matching numeric candidates rather than stopping at
    // an earlier non-numeric nested order_id value from a response wrapper.
    // If the response omits either ID, reconcile using the numeric source ref.
    if (!shiprocketOrderId || !shiprocketShipmentId) {
      const recovered = await findOrderByReference(sourceReference);
      if (recovered) {
        shiprocketOrderId = recovered.shiprocketOrderId;
        shiprocketShipmentId = recovered.shiprocketShipmentId;
      }
    }
    if (!shiprocketOrderId || !shiprocketShipmentId) {
      const shape = responseShape(body);
      const responseMessage = readText(nestedValue(body, ["message", "error", "errors"]), 220);
      throw new ShiprocketFulfilmentError(
        `Shiprocket returned a successful HTTP response, but YEARTH could not resolve both internal IDs${responseMessage ? ` (message: ${responseMessage})` : ""}. Response shape (values omitted): ${shape}. Shiprocket Orders was searched using source reference ${sourceReference}. Check Orders → All and search this numeric reference; use Reconcile before any retry. Do not create a duplicate.`,
      );
    }
    return { shiprocketOrderId, shiprocketShipmentId };
  }

  async function findOrderByReference(reference: string): Promise<CreatedShipment | null> {
    const cleanReference = readText(reference, 50);
    if (!cleanReference) return null;
    const searchParams = new URLSearchParams({ search: cleanReference, page: "1", per_page: "50" });
    const filterParams = new URLSearchParams({ filter_by: "channel_order_id", filter: cleanReference, page: "1", per_page: "50" });
    let match: UnknownRecord | undefined;
    // The Orders API documents both `search` and `filter_by=channel_order_id`.
    // Use the filter form as a fallback for accounts whose search index behaves
    // differently for custom-channel orders.
    for (const params of [searchParams, filterParams]) {
      const body = await request(`/v1/external/orders?${params.toString()}`, "GET");
      const found = collectRecords(body).find((row) => {
        const candidates = [row["channel_order_id"], row["channel_order_number"], row["order_number"], row["reference_id"], row["order_id"]];
        return candidates.some((candidate) => readText(candidate, 60).toLowerCase() === cleanReference.toLowerCase());
      });
      if (found) { match = found; break; }
    }
    if (!match) return null;

    const shiprocketOrderId = readNumber(match["id"] ?? match["shiprocket_order_id"] ?? match["order_id"]);
    let shiprocketShipmentId = deepNumber(match, ["shipment_id", "shiprocket_shipment_id"]);
    if (!shiprocketShipmentId) {
      const shipments = findArrayByKey(match, ["shipments", "shipment"]);
      const firstShipment = shipments?.length ? asRecord(shipments[0]) : null;
      shiprocketShipmentId = readNumber(firstShipment?.["shipment_id"] ?? firstShipment?.["id"]);
    }
    if (!shiprocketOrderId) return null;

    if (!shiprocketShipmentId) {
      try {
        const details = await request(`/v1/external/orders/show/${shiprocketOrderId}`, "GET");
        shiprocketShipmentId = deepNumber(details, ["shipment_id", "shiprocket_shipment_id"]);
        if (!shiprocketShipmentId) {
          const shipments = findArrayByKey(details, ["shipments", "shipment"]);
          const firstShipment = shipments?.length ? asRecord(shipments[0]) : null;
          shiprocketShipmentId = readNumber(firstShipment?.["shipment_id"] ?? firstShipment?.["id"]);
        }
        if (!shiprocketShipmentId) {
          const detailRecords = collectRecords(details);
          for (const record of detailRecords) {
            const id = readNumber(record["id"]);
            const shipmentLike = "awb_code" in record || "courier" in record || "packages" in record || "pickup_status" in record;
            if (id && shipmentLike) { shiprocketShipmentId = id; break; }
          }
        }
      } catch (error) {
        console.error("[shipping] Shiprocket order lookup details failed:", error instanceof Error ? error.message : "unknown");
      }
    }
    if (!shiprocketShipmentId) return null;
    return { shiprocketOrderId, shiprocketShipmentId };
  }

  async function getNdrCases(page = 1, perPage = 50): Promise<ShiprocketNdrCase[]> {
    const safePage = Math.max(1, Math.min(1000, Math.floor(page)));
    const safePerPage = Math.max(1, Math.min(100, Math.floor(perPage)));
    const params = new URLSearchParams({ page: String(safePage), per_page: String(safePerPage) });
    const body = await request(`/v1/external/ndr/all?${params.toString()}`, "GET");
    const rows = findArrayByKey(body, ["data", "ndr_data", "ndr_details", "ndr_list"]) ?? [];
    return rows.map((value) => {
      const row = asRecord(value) ?? {};
      const history = Array.isArray(row["history"]) ? row["history"].map(asRecord).filter((item): item is UnknownRecord => !!item) : [];
      const latest = history[history.length - 1] ?? {};
      return {
        id: readNumber(row["id"]),
        shipmentId: readNumber(row["shipment_id"]),
        awb: readText(row["awb_code"] ?? row["awb"], 50),
        customerName: readText(row["customer_name"], 90),
        customerPhone: readText(row["customer_phone"] ?? row["phone"], 20),
        customerEmail: readText(row["customer_email"], 120),
        productName: readText(row["product_name"], 120),
        courierName: readText(row["courier"] ?? row["courier_name"], 100),
        reason: readText(latest["ndr_reason"] ?? latest["reason"] ?? row["ndr_reason"] ?? row["reason"], 180),
        attempts: readNumber(row["attempts"] ?? latest["ndr_attempt"]) ?? 0,
        raisedAt: readText(latest["ndr_raised_at"] ?? row["ndr_raised_at"], 40),
        escalationStatus: readText(row["escalation_status"], 60),
      };
    }).filter((item) => item.awb.length > 0);
  }

  async function actOnNdr(input: { awb: string; action: "re-attempt" | "return"; comments: string; phone?: string }): Promise<{ message: string }> {
    const awb = readText(input.awb, 50);
    const comments = readText(input.comments, 250);
    if (!awb || !/^[A-Za-z0-9-]{5,50}$/.test(awb)) throw new ShiprocketFulfilmentError("Enter a valid AWB before submitting an NDR action.");
    if (!comments) throw new ShiprocketFulfilmentError("Add a short comment explaining the NDR action.");
    const phone = input.phone ? input.phone.replace(/\D/g, "") : "";
    if (phone && !/^[6-9]\d{9}$/.test(phone)) throw new ShiprocketFulfilmentError("Enter a valid 10-digit Indian phone number or leave it blank.");
    const body = await request(`/v1/external/ndr/${encodeURIComponent(awb)}/action`, "POST", {
      action: input.action,
      comments,
      ...(phone && input.action === "re-attempt" ? { phone } : {}),
    });
    const message = readText(nestedValue(body, ["message", "status"]), 160) || (input.action === "re-attempt" ? "NDR re-attempt action submitted." : "RTO action submitted.");
    return { message };
  }

  async function assignAwb(shipmentId: number, courierId: number): Promise<AwbResult> {
    const body = await request("/v1/external/courier/assign/awb", "POST", {
      shipment_id: shipmentId,
      courier_id: courierId,
    });
    let awb = readText(nestedValue(body, ["awb_code", "awb"]), 50);
    let courierName = readText(nestedValue(body, ["courier_name"]), 100) || null;
    // Some Shiprocket account responses acknowledge AWB assignment but omit the
    // AWB in the immediate body. Read the created shipment once before failing.
    if (!awb) {
      try {
        const details = await request(`/v1/external/shipments/${shipmentId}`, "GET");
        awb = readText(nestedValue(details, ["awb_code", "awb"]), 50);
        courierName = readText(nestedValue(details, ["courier_name"]), 100) || courierName;
      } catch (error) {
        console.error("[shipping] Shipment detail lookup after AWB assignment failed:", error instanceof Error ? error.message : "unknown");
      }
    }
    if (!awb) throw new ShiprocketFulfilmentError("Shiprocket did not return an AWB and the shipment details endpoint did not show one. Check Shiprocket before assigning again.");
    return { awb, courierName };
  }

  async function requestPickup(shipmentId: number, retry = false): Promise<string> {
    const body = await request("/v1/external/courier/generate/pickup", "POST", {
      shipment_id: shipmentId,
      ...(retry ? { status: "retry" } : {}),
    });
    return readText(nestedValue(body, ["pickup_status", "status", "message"]), 120) || "Pickup request submitted";
  }

  async function generateLabel(shipmentId: number): Promise<string | null> {
    const body = await request("/v1/external/courier/generate/label", "POST", { shipment_id: [shipmentId] });
    return safeHttpsUrl(nestedValue(body, ["label_url", "url"]));
  }

  async function generateManifest(shipmentId: number): Promise<string | null> {
    const body = await request("/v1/external/manifests/generate", "POST", { shipment_id: [shipmentId] });
    return safeHttpsUrl(nestedValue(body, ["manifest_url", "url"]));
  }

  return { checkByPincode, checkForOrder, createOrder, findOrderByReference, getNdrCases, actOnNdr, assignAwb, requestPickup, generateLabel, generateManifest };
}
