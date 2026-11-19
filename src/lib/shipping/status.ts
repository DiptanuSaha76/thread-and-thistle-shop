/**
 * Canonical shipping stages shared by the admin and customer order screens.
 * Database `orders.status` intentionally stays at its legacy four-state model;
 * the detailed fulfilment stage lives in `shiprocket_fulfillments.fulfilment_status`.
 */
export const SHIPMENT_STAGE_OPTIONS = [
  { value: "processing", label: "Processing" },
  { value: "ready_to_ship", label: "Ready to ship" },
  { value: "pickup_scheduled", label: "Pickup scheduled" },
  { value: "picked_up", label: "Picked up" },
  { value: "in_transit", label: "In transit" },
  { value: "out_for_delivery", label: "Out for delivery" },
  { value: "delivered", label: "Delivered" },
  { value: "ndr_action_required", label: "NDR — action required" },
  { value: "rto_initiated", label: "RTO initiated" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export type ShipmentStage = (typeof SHIPMENT_STAGE_OPTIONS)[number]["value"];
export type ShipmentStageLabel = (typeof SHIPMENT_STAGE_OPTIONS)[number]["label"];

const stageValues = new Set<string>(SHIPMENT_STAGE_OPTIONS.map((item) => item.value));

/** Maps internal fulfilment values and legacy order states to one customer-visible stage. */
export function normalizeShipmentStage(
  fulfilmentStatus: string | null | undefined,
  orderStatus: string | null | undefined,
): ShipmentStage {
  const baseStatus = (orderStatus ?? "").trim().toLowerCase();
  // Terminal order states must not be overwritten by an old/stale shipment row.
  if (baseStatus === "cancelled") return "cancelled";
  if (baseStatus === "delivered") return "delivered";

  const saved = (fulfilmentStatus ?? "").trim().toLowerCase();

  if (stageValues.has(saved)) return saved as ShipmentStage;

  // Internal lifecycle values that are not customer-facing dropdown options.
  if (["parcel_measured", "order_created", "awb_linked", "awb_assigned", "tracking_updated"].includes(saved)) {
    return "ready_to_ship";
  }
  if (["pickup_requested", "pickup_generated"].includes(saved)) return "pickup_scheduled";
  if (["ndr_reattempt_requested", "ndr_action_requested"].includes(saved)) return "ndr_action_required";
  if (["rto_requested", "return_requested"].includes(saved)) return "rto_initiated";

  switch (baseStatus) {
    case "shipped":
      return "in_transit";
    default:
      return "processing";
  }
}

export function shipmentStageLabel(stage: ShipmentStage): ShipmentStageLabel {
  return SHIPMENT_STAGE_OPTIONS.find((item) => item.value === stage)?.label ?? "Processing";
}

export function shipmentStageClass(stageLabel: string): string {
  return stageLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Tabs shown to customers; awaiting payment is kept separate from shipment stages. */
export const CUSTOMER_ORDER_STATUS_TABS = [
  "All Orders",
  "Awaiting payment",
  ...SHIPMENT_STAGE_OPTIONS.map((item) => item.label),
] as const;
