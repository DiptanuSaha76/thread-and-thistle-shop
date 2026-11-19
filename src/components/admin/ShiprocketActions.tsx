import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, PackageCheck, RefreshCw, Save, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  assignShiprocketAwb,
  prepareShiprocketShipment,
  requestShiprocketPickup,
  reconcileShiprocketShipment,
  saveShiprocketParcel,
} from "@/lib/shipping/functions";
import type { Database } from "@/integrations/supabase/types";

type Fulfilment = Database["public"]["Tables"]["shiprocket_fulfillments"]["Row"];
type Courier = {
  courierId: number;
  courierName: string;
  rate: number | null;
  estimatedDays: string | null;
  etd: string | null;
  codAvailable: boolean;
};
type ParcelForm = { weightKg: string; lengthCm: string; breadthCm: string; heightCm: string };
const emptyParcel: ParcelForm = { weightKg: "", lengthCm: "", breadthCm: "", heightCm: "" };

export function ShiprocketActions({
  orderId,
  fulfilment,
}: {
  orderId: string;
  fulfilment?: Fulfilment;
}) {
  const queryClient = useQueryClient();
  const saveParcel = useServerFn(saveShiprocketParcel);
  const prepare = useServerFn(prepareShiprocketShipment);
  const assign = useServerFn(assignShiprocketAwb);
  const requestPickup = useServerFn(requestShiprocketPickup);
  const reconcile = useServerFn(reconcileShiprocketShipment);
  const [needsRetryConfirmation, setNeedsRetryConfirmation] = useState(false);
  const [parcel, setParcel] = useState<ParcelForm>(emptyParcel);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [selectedCourier, setSelectedCourier] = useState("");
  const [busy, setBusy] = useState<"parcel" | "prepare" | "awb" | "pickup" | "">("");

  useEffect(() => {
    setParcel({
      weightKg: fulfilment?.parcel_weight_kg == null ? "" : String(fulfilment.parcel_weight_kg),
      lengthCm: fulfilment?.parcel_length_cm == null ? "" : String(fulfilment.parcel_length_cm),
      breadthCm: fulfilment?.parcel_breadth_cm == null ? "" : String(fulfilment.parcel_breadth_cm),
      heightCm: fulfilment?.parcel_height_cm == null ? "" : String(fulfilment.parcel_height_cm),
    });
  }, [
    fulfilment?.parcel_weight_kg,
    fulfilment?.parcel_length_cm,
    fulfilment?.parcel_breadth_cm,
    fulfilment?.parcel_height_cm,
  ]);

  useEffect(() => {
    setNeedsRetryConfirmation(!!fulfilment?.order_create_attempted_at && !fulfilment?.shiprocket_order_id);
  }, [fulfilment?.order_create_attempted_at, fulfilment?.shiprocket_order_id]);

  const queryParcel = useMemo(() => ({
    weightKg: Number(parcel.weightKg),
    lengthCm: Number(parcel.lengthCm),
    breadthCm: Number(parcel.breadthCm),
    heightCm: Number(parcel.heightCm),
  }), [parcel]);
  const parcelValid = Object.values(queryParcel).every((value) => Number.isFinite(value) && value > 0);
  const parcelMatchesSaved = parcelValid &&
    Number(fulfilment?.parcel_weight_kg) === queryParcel.weightKg &&
    Number(fulfilment?.parcel_length_cm) === queryParcel.lengthCm &&
    Number(fulfilment?.parcel_breadth_cm) === queryParcel.breadthCm &&
    Number(fulfilment?.parcel_height_cm) === queryParcel.heightCm;
  const parcelLocked = !!fulfilment?.shiprocket_order_id || !!fulfilment?.awb;

  async function refreshAdmin() {
    await queryClient.invalidateQueries({ queryKey: ["admin"] });
  }

  async function persistParcel() {
    if (!parcelValid) {
      toast.error("Enter valid positive weight and all three parcel dimensions.");
      return;
    }
    setBusy("parcel");
    try {
      await saveParcel({ data: { orderId, parcel: queryParcel } });
      toast.success("Measured parcel details saved.");
      await refreshAdmin();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Parcel measurements could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function loadCouriers(confirmNoExistingOrder = false) {
    if (!parcelMatchesSaved && !fulfilment?.shiprocket_order_id) {
      toast.error("Save the final packed parcel measurements first.");
      return;
    }
    setBusy("prepare");
    try {
      const result = await prepare({ data: { orderId, confirmNoExistingOrder } });
      if (result.state === "needs_confirmation") {
        setNeedsRetryConfirmation(true);
        toast.warning(result.message);
        await refreshAdmin();
        return;
      }
      setNeedsRetryConfirmation(false);
      setCouriers(result.couriers);
      setSelectedCourier(result.couriers[0] ? String(result.couriers[0].courierId) : "");
      if (result.couriers.length) toast.success("Shiprocket order is linked. Select a courier to assign the AWB.");
      else toast.error("Shiprocket order exists, but no courier is currently serviceable for this destination.");
      await refreshAdmin();
    } catch (error) {
      setNeedsRetryConfirmation(true);
      toast.error(error instanceof Error ? error.message : "Could not prepare the Shiprocket order. Use reconciliation before retrying.");
      await refreshAdmin();
    } finally {
      setBusy("");
    }
  }

  async function reconcileExisting() {
    setBusy("prepare");
    try {
      const result = await reconcile({ data: { orderId } });
      if (!result.found) {
        setNeedsRetryConfirmation(true);
        toast.error(`No matching Shiprocket order found by reference ${result.reference}. Verify the Shiprocket Orders panel before retrying.`);
      } else {
        setNeedsRetryConfirmation(false);
        setCouriers(result.couriers);
        setSelectedCourier(result.couriers[0] ? String(result.couriers[0].courierId) : "");
        toast.success(`Recovered Shiprocket order #${result.shiprocketOrderId} and shipment #${result.shiprocketShipmentId}.`);
      }
      await refreshAdmin();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Shiprocket order reconciliation failed.");
    } finally {
      setBusy("");
    }
  }

  function retryAfterManualCheck() {
    const confirmed = window.confirm(
      "I checked the Shiprocket Orders panel and confirmed this YEARTH order reference is not present. Create a new Shiprocket order now?",
    );
    if (confirmed) void loadCouriers(true);
  }

  async function assignAwb() {
    if (!selectedCourier) {
      toast.error("Select a courier first.");
      return;
    }
    setBusy("awb");
    try {
      const result = await assign({ data: { orderId, courierId: Number(selectedCourier) } });
      toast.success(`AWB assigned${result.courierName ? ` with ${result.courierName}` : ""}. Pickup has not been requested yet.`);
      await refreshAdmin();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not assign the AWB.");
    } finally {
      setBusy("");
    }
  }

  async function pickupAndDocuments() {
    setBusy("pickup");
    try {
      const result = await requestPickup({ data: { orderId } });
      toast.success(result.pickupStatus || "Pickup request submitted.");
      if (result.labelError || result.manifestError) toast.error("Pickup was requested. One or more documents could not be generated; retry documents below.");
      await refreshAdmin();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Pickup request failed.");
    } finally {
      setBusy("");
    }
  }

  const hasAwb = !!fulfilment?.awb;
  const documentsComplete = !!fulfilment?.label_url && !!fulfilment?.manifest_url;
  const updateParcel = (key: keyof ParcelForm, value: string) => setParcel((current) => ({ ...current, [key]: value }));

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b className="flex items-center gap-2"><Truck size={16} /> Shiprocket fulfilment</b>
        <span className="text-xs text-muted-foreground">{fulfilment?.fulfilment_status?.replaceAll("_", " ") || "not created"}</span>
      </div>

      <fieldset className="space-y-2 rounded-md border border-border p-3" disabled={parcelLocked} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}>
        <legend className="px-1 text-sm font-semibold">Actual packed parcel measurements</legend>
        <p className="text-xs text-muted-foreground">Measure the final outer parcel (including the shipping mailer/box) after packing. Product-level shipping specs are only used for the customer PIN-code estimate.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="text-xs">Weight (kg)<input className="field mt-1" type="number" min="0.001" max="30" step="0.001" value={parcel.weightKg} onChange={(event) => updateParcel("weightKg", event.target.value)} placeholder="0.450" /></label>
          <label className="text-xs">Length (cm)<input className="field mt-1" type="number" min="0.1" max="200" step="0.1" value={parcel.lengthCm} onChange={(event) => updateParcel("lengthCm", event.target.value)} placeholder="32" /></label>
          <label className="text-xs">Breadth (cm)<input className="field mt-1" type="number" min="0.1" max="200" step="0.1" value={parcel.breadthCm} onChange={(event) => updateParcel("breadthCm", event.target.value)} placeholder="26" /></label>
          <label className="text-xs">Height (cm)<input className="field mt-1" type="number" min="0.1" max="200" step="0.1" value={parcel.heightCm} onChange={(event) => updateParcel("heightCm", event.target.value)} placeholder="4" /></label>
        </div>
        {fulfilment?.parcel_measured_at && <p className="text-xs text-muted-foreground">Saved measurement: {new Date(fulfilment.parcel_measured_at).toLocaleString()}</p>}
        {!parcelLocked && (
          <Button type="button" size="sm" variant="outline" disabled={!!busy || !parcelValid || parcelMatchesSaved} onClick={() => void persistParcel()}>
            {busy === "parcel" ? <RefreshCw className="animate-spin" /> : <Save size={16} />}
            {parcelMatchesSaved ? "Measurements saved" : "Save measured parcel"}
          </Button>
        )}
        {parcelLocked && <p className="text-xs text-muted-foreground">Measurements are locked because the Shiprocket order has already been created.</p>}
      </fieldset>

      {fulfilment?.shiprocket_reference && <p className="text-xs text-muted-foreground">Shiprocket source reference: <b className="select-all">{fulfilment.shiprocket_reference}</b> · Search this number under Shiprocket Orders → All if reconciling.</p>}
      {fulfilment?.shiprocket_order_id && <p className="text-sm text-muted-foreground">Shiprocket order #{fulfilment.shiprocket_order_id} · Shipment #{fulfilment.shiprocket_shipment_id}</p>}
      {hasAwb && <div className="space-y-1 text-sm"><p>Courier: <b>{fulfilment?.courier_name || "Assigned"}</b></p><p>AWB: <b className="select-all">{fulfilment?.awb}</b></p>{fulfilment?.pickup_status && <p>Pickup: {fulfilment.pickup_status}</p>}</div>}

      {!hasAwb && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={!!busy || (!fulfilment?.shiprocket_order_id && !parcelMatchesSaved)} onClick={() => void loadCouriers(false)}>
              {busy === "prepare" ? <RefreshCw className="animate-spin" /> : <PackageCheck size={16} />}
              {fulfilment?.shiprocket_order_id ? "Refresh courier options" : "Create Shiprocket order & get couriers"}
            </Button>
            {(needsRetryConfirmation || (!!fulfilment?.order_create_attempted_at && !fulfilment?.shiprocket_order_id)) && !fulfilment?.shiprocket_order_id && (
              <>
                <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={() => void reconcileExisting()}>
                  {busy === "prepare" ? <RefreshCw className="animate-spin" /> : <RefreshCw size={15} />}
                  Check Shiprocket Orders
                </Button>
                <Button type="button" size="sm" variant="destructive" disabled={!!busy || !parcelMatchesSaved} onClick={retryAfterManualCheck}>
                  Retry after manual verification
                </Button>
              </>
            )}
          </div>
          {fulfilment?.order_create_error && !fulfilment?.shiprocket_order_id && <p className="text-xs text-destructive">Previous create attempt: {fulfilment.order_create_error}</p>}
          {couriers.length > 0 && <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-52 flex-1 text-sm">Courier partner
              <select className="field mt-1" value={selectedCourier} onChange={(event) => setSelectedCourier(event.target.value)}>
                {couriers.map((courier) => <option key={courier.courierId} value={courier.courierId}>{courier.courierName} · {courier.rate === null ? "Rate unavailable" : `₹${courier.rate.toFixed(2)}`}{courier.estimatedDays ? ` · ${courier.estimatedDays} days` : ""}</option>)}
              </select>
            </label>
            <Button type="button" size="sm" disabled={!!busy || !selectedCourier} onClick={() => void assignAwb()}>{busy === "awb" ? <RefreshCw className="animate-spin" /> : <Truck size={16} />}Assign AWB</Button>
          </div>}
          <p className="text-xs text-muted-foreground">Creating the Shiprocket order does not book a pickup. AWB assignment and pickup are separate admin actions.</p>
        </>
      )}

      {hasAwb && !documentsComplete && <Button type="button" size="sm" disabled={!!busy} onClick={() => void pickupAndDocuments()}>{busy === "pickup" ? <RefreshCw className="animate-spin" /> : <Truck size={16} />}{fulfilment?.pickup_status ? "Retry label / manifest" : "Request pickup + generate documents"}</Button>}
      {hasAwb && documentsComplete && <p className="text-sm text-emerald-700">Pickup requested and shipping documents generated.</p>}
      <div className="flex flex-wrap gap-3 text-sm">
        {fulfilment?.label_url && <a href={fulfilment.label_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">Shipping label <ExternalLink size={13} /></a>}
        {fulfilment?.manifest_url && <a href={fulfilment.manifest_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">Manifest <ExternalLink size={13} /></a>}
      </div>
    </div>
  );
}
