import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, RefreshCw, RotateCcw, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { actOnShiprocketNdr, getShiprocketNdrCases } from "@/lib/shipping/functions";

type NdrCase = {
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
  yearthOrderNumber?: string | null;
};

export function ShiprocketNdrPanel() {
  const queryClient = useQueryClient();
  const fetchCases = useServerFn(getShiprocketNdrCases);
  const submitAction = useServerFn(actOnShiprocketNdr);
  const query = useQuery({
    queryKey: ["shiprocket-ndr"],
    queryFn: () => fetchCases(),
    retry: false,
    refetchInterval: 2 * 60 * 1000,
  });
  const [comments, setComments] = useState<Record<string, string>>({});
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [busyAwb, setBusyAwb] = useState("");

  async function act(item: NdrCase, action: "re-attempt" | "return") {
    const note = (comments[item.awb] ?? "").trim();
    if (note.length < 2) {
      toast.error("Add a short comment before submitting the NDR action.");
      return;
    }
    if (action === "return" && !window.confirm(`Request return to origin for AWB ${item.awb}? This is a real courier action.`)) return;
    setBusyAwb(item.awb);
    try {
      const result = await submitAction({ data: { awb: item.awb, action, comments: note, phone: phones[item.awb] ?? "" } });
      toast.success(result.message);
      await queryClient.invalidateQueries({ queryKey: ["shiprocket-ndr"] });
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The NDR action could not be submitted.");
    } finally {
      setBusyAwb("");
    }
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2"><AlertTriangle size={20} /> Delivery exceptions / NDR</h2>
          <p className="text-sm text-muted-foreground">Live NDR cases returned by Shiprocket. Actions below are sent to the courier workflow.</p>
        </div>
        <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
          <RefreshCw size={16} className={query.isFetching ? "animate-spin" : ""} /> Refresh NDR
        </Button>
      </header>

      {query.isPending && <p role="status" className="text-muted-foreground">Loading Shiprocket NDR cases…</p>}
      {query.isError && <div className="rounded-lg border border-destructive/40 p-4 text-sm"><b>Could not load NDR cases.</b><p className="mt-1 text-muted-foreground">{query.error instanceof Error ? query.error.message : "Check Shiprocket API permissions and try again."}</p></div>}
      {query.data && query.data.length === 0 && <div className="rounded-lg border border-border p-6 text-center"><Truck className="mx-auto mb-2"/><b>No open NDR cases returned</b><p className="mt-1 text-sm text-muted-foreground">Shiprocket did not return any NDR cases for this API user.</p></div>}

      <div className="space-y-4">
        {(query.data ?? []).map((raw) => {
          const item = raw as NdrCase;
          return (
            <article key={`${item.awb}-${item.id ?? "ndr"}`} className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{item.yearthOrderNumber ? `${item.yearthOrderNumber} · ` : "Unmatched YEARTH order · "}{item.customerName || "Customer"}</h3>
                  <p className="text-sm text-muted-foreground">AWB: <b className="select-all">{item.awb}</b> · {item.courierName || "Courier not reported"}</p>
                </div>
                <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">NDR · {item.attempts} attempt(s)</span>
              </div>
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <p><span className="text-muted-foreground">Reason:</span> {item.reason || "Not provided"}</p>
                <p><span className="text-muted-foreground">NDR raised:</span> {item.raisedAt || "Not provided"}</p>
                <p><span className="text-muted-foreground">Phone:</span> {item.customerPhone || "Not provided"}</p>
                <p><span className="text-muted-foreground">Email:</span> {item.customerEmail || "Not provided"}</p>
                {item.productName && <p className="sm:col-span-2"><span className="text-muted-foreground">Product:</span> {item.productName}</p>}
                {item.escalationStatus && <p className="sm:col-span-2"><span className="text-muted-foreground">Escalation:</span> {item.escalationStatus}</p>}
              </div>
              {!item.yearthOrderNumber && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">This AWB is not currently linked to a YEARTH order. Verify the AWB before taking an action.</p>}
              <label className="block text-sm">Action comment
                <input className="field mt-1" value={comments[item.awb] ?? ""} onChange={(event) => setComments((previous) => ({ ...previous, [item.awb]: event.target.value }))} placeholder="e.g. Customer confirmed address and is available tomorrow" maxLength={250}/>
              </label>
              <label className="block text-sm">Updated customer phone (optional, re-attempt only)
                <input className="field mt-1" value={phones[item.awb] ?? item.customerPhone ?? ""} onChange={(event) => setPhones((previous) => ({ ...previous, [item.awb]: event.target.value }))} placeholder="10-digit mobile" inputMode="numeric" maxLength={15}/>
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={!!busyAwb || !item.yearthOrderNumber} onClick={() => void act(item, "re-attempt")}>
                  {busyAwb === item.awb ? <RefreshCw className="animate-spin" size={16}/> : <RotateCcw size={16}/>} Request re-attempt
                </Button>
                <Button type="button" size="sm" variant="destructive" disabled={!!busyAwb || !item.yearthOrderNumber} onClick={() => void act(item, "return")}>
                  {busyAwb === item.awb ? <RefreshCw className="animate-spin" size={16}/> : <ArrowRight size={16}/>} Return to origin
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">NDR actions are real Shiprocket requests. Re-attempt requires a verified delivery instruction; Return to origin can initiate a reverse movement. Fake-attempt is intentionally not exposed because Shiprocket may require supporting evidence.</p>
    </section>
  );
}
