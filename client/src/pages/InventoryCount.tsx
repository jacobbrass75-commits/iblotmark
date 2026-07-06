import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import QRCode from "qrcode";
import {
  Calculator,
  Camera,
  Download,
  PackageCheck,
  QrCode,
  Search,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useProducts } from "@/hooks/useProducts";
import {
  type InventoryBin,
  type InventoryCalculation,
  useArchiveInventoryBin,
  useCalculateInventory,
  useCreateInventoryBin,
  useInventoryBins,
  useInventoryCounts,
  useLookupInventoryBin,
} from "@/hooks/useInventory";

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
};

const EMPTY_BIN_WEIGHT_OZ = 56;

function formatNumber(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: value % 1 === 0 ? 0 : Math.min(digits, 2),
  });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

function buildQrPayload(bin: InventoryBin) {
  if (typeof window === "undefined") return bin.qrCode;
  return `${window.location.origin}/blog/inventory?bin=${encodeURIComponent(bin.qrCode)}`;
}

function QrLabel({
  bin,
  onClose,
}: {
  bin: InventoryBin;
  onClose: () => void;
}) {
  const [dataUrl, setDataUrl] = useState("");
  const payload = useMemo(() => buildQrPayload(bin), [bin]);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(payload, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#111827", light: "#ffffff" },
    }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-md bg-background">
        <CardContent className="space-y-4 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">QR Bin Label</h2>
              <p className="text-sm text-muted-foreground">{bin.productTitle}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
          </div>

          <div className="rounded-md border bg-white p-4 text-center text-slate-950">
            <div className="text-xs font-semibold uppercase tracking-wide">iBolt Inventory</div>
            <div className="mt-1 text-lg font-bold">{bin.binLabel}</div>
            {dataUrl ? (
              <img src={dataUrl} alt={`QR code for ${bin.binLabel}`} className="mx-auto mt-3 h-72 w-72" />
            ) : (
              <div className="mx-auto mt-3 flex h-72 w-72 items-center justify-center border text-sm text-slate-500">
                Generating QR
              </div>
            )}
            <div className="mt-3 space-y-1 text-sm">
              <div>{bin.sku ? `SKU: ${bin.sku}` : bin.productTitle}</div>
              <div>Unit: {formatNumber(bin.unitWeightOz, 4)} oz | Tare: {formatNumber(bin.emptyBinWeightOz)} oz</div>
              <div className="font-mono text-xs">{bin.qrCode}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(payload)}>
              Copy QR URL
            </Button>
            {dataUrl && (
              <Button variant="outline" size="sm" asChild>
                <a href={dataUrl} download={`${bin.qrCode}.png`}>
                  <Download className="mr-2 h-4 w-4" />
                  Download PNG
                </a>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function InventoryCount() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: products = [] } = useProducts();
  const [binSearch, setBinSearch] = useState("");
  const { data: bins = [], isLoading: binsLoading } = useInventoryBins(binSearch);
  const { data: counts = [] } = useInventoryCounts(25);
  const createBin = useCreateInventoryBin();
  const archiveBin = useArchiveInventoryBin();
  const lookupBin = useLookupInventoryBin();
  const calculate = useCalculateInventory();

  const [scanInput, setScanInput] = useState("");
  const [selectedBin, setSelectedBin] = useState<InventoryBin | null>(null);
  const [qrBin, setQrBin] = useState<InventoryBin | null>(null);
  const [totalWeight, setTotalWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState<"lb" | "oz">("lb");
  const [roundingMode, setRoundingMode] = useState<"nearest" | "floor" | "ceil">("nearest");
  const [countedBy, setCountedBy] = useState("");
  const [countNotes, setCountNotes] = useState("");
  const [calculationResult, setCalculationResult] = useState<InventoryCalculation | null>(null);

  const [newBin, setNewBin] = useState({
    productId: "",
    productTitle: "",
    sku: "",
    binLabel: "",
    unitWeightOz: "",
    emptyBinWeightOz: String(EMPTY_BIN_WEIGHT_OZ),
    location: "",
    notes: "",
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const initialScanHandled = useRef(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");

  const productsById = useMemo(() => {
    return new Map(products.map((product: any) => [product.id, product]));
  }, [products]);

  const selectedProduct = newBin.productId ? productsById.get(newBin.productId) : null;

  useEffect(() => {
    if (!selectedBin) return;
    const fresh = bins.find((bin) => bin.id === selectedBin.id);
    if (fresh && fresh !== selectedBin) setSelectedBin(fresh);
  }, [bins, selectedBin]);

  useEffect(() => {
    if (initialScanHandled.current) return;
    initialScanHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("bin") || params.get("code") || params.get("qr");
    if (code) {
      setScanInput(code);
      lookupCode(code);
    }
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const lookupCode = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    try {
      const bin = await lookupBin.mutateAsync(trimmed);
      setSelectedBin(bin);
      setCalculationResult(null);
      toast({ title: "Bin loaded", description: `${bin.binLabel} | ${bin.productTitle}` });
    } catch (err: any) {
      toast({ title: "Scan not found", description: err.message, variant: "destructive" });
    }
  };

  const handleProductChange = (productId: string) => {
    const product = productsById.get(productId);
    setNewBin((prev) => ({
      ...prev,
      productId,
      productTitle: product?.title || prev.productTitle,
      sku: product?.sku || product?.handle || prev.sku,
      binLabel: prev.binLabel || `${product?.sku || product?.handle || product?.title || "Product"} - Main Bin`,
    }));
  };

  const handleCreateBin = async () => {
    try {
      const created = await createBin.mutateAsync({
        productId: newBin.productId || null,
        productTitle: newBin.productTitle,
        sku: newBin.sku,
        binLabel: newBin.binLabel,
        unitWeightOz: newBin.unitWeightOz,
        emptyBinWeightOz: newBin.emptyBinWeightOz,
        location: newBin.location,
        notes: newBin.notes,
      });
      setSelectedBin(created);
      setQrBin(created);
      setNewBin({
        productId: "",
        productTitle: "",
        sku: "",
        binLabel: "",
        unitWeightOz: "",
        emptyBinWeightOz: String(EMPTY_BIN_WEIGHT_OZ),
        location: "",
        notes: "",
      });
      toast({ title: "Inventory bin created", description: created.binLabel });
    } catch (err: any) {
      toast({ title: "Could not create bin", description: err.message, variant: "destructive" });
    }
  };

  const handleCalculate = async (save: boolean) => {
    if (!selectedBin) {
      toast({ title: "Select a bin first", description: "Scan a QR code or choose a bin from the list.", variant: "destructive" });
      return;
    }
    try {
      const result = await calculate.mutateAsync({
        binId: selectedBin.id,
        totalWeight,
        weightUnit,
        roundingMode,
        save,
        countedBy,
        notes: countNotes,
      });
      setCalculationResult(result);
      setSelectedBin(result.bin);
      if (save) {
        setCountNotes("");
        toast({ title: "Count saved", description: `${result.quantity.toLocaleString()} units for ${result.bin.binLabel}` });
      }
    } catch (err: any) {
      toast({ title: "Count failed", description: err.message, variant: "destructive" });
    }
  };

  const stopCamera = () => {
    if (scanTimerRef.current) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraActive(false);
  };

  const startCamera = async () => {
    setCameraError("");
    const BarcodeDetectorClass = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!BarcodeDetectorClass) {
      setCameraError("Camera QR detection is not available in this browser. Use a USB scanner, paste the QR URL, or scan the label with the phone camera to open this page.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const detector = new BarcodeDetectorClass({ formats: ["qr_code"] });
      scanTimerRef.current = window.setInterval(async () => {
        if (!videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          const value = codes[0]?.rawValue;
          if (value) {
            setScanInput(value);
            stopCamera();
            await lookupCode(value);
          }
        } catch {
          setCameraError("Camera scan failed. Try better light or use the scanner input.");
          stopCamera();
        }
      }, 500);
    } catch (err: any) {
      setCameraError(err.message || "Could not start camera.");
      stopCamera();
    }
  };

  const countFormula = calculationResult
    ? `(${formatNumber(calculationResult.totalWeightOz)} oz - ${formatNumber(calculationResult.emptyBinWeightOz)} oz) / ${formatNumber(calculationResult.unitWeightOz, 4)} oz = ${formatNumber(calculationResult.rawQuantity, 2)}`
    : selectedBin
      ? `(total oz - ${formatNumber(selectedBin.emptyBinWeightOz)} oz) / ${formatNumber(selectedBin.unitWeightOz, 4)} oz`
      : "(total oz - 56 oz) / unit weight oz";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex min-h-14 items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/blog")}>Back</Button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold">Inventory Count</h1>
              <p className="text-xs text-muted-foreground">QR labels, scanner lookup, and scale-weight quantity math</p>
            </div>
          </div>
          <Badge variant="outline" className="hidden sm:inline-flex">
            Empty bin tare: {EMPTY_BIN_WEIGHT_OZ} oz
          </Badge>
        </div>
      </header>

      <main className="container mx-auto grid gap-4 px-4 py-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <section className="space-y-4">
          <Card>
            <CardContent className="space-y-4 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-base font-semibold">
                    <QrCode className="h-4 w-4" />
                    Scan and Count
                  </h2>
                  <p className="text-sm text-muted-foreground">Scan a bin QR code, enter the scale weight, and save the count.</p>
                </div>
                <Button variant="outline" size="sm" onClick={cameraActive ? stopCamera : startCamera}>
                  <Camera className="mr-2 h-4 w-4" />
                  {cameraActive ? "Stop Camera" : "Camera Scan"}
                </Button>
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Scan QR with USB scanner, paste QR URL, or enter bin code"
                  value={scanInput}
                  autoComplete="off"
                  onChange={(event) => setScanInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") lookupCode(scanInput);
                  }}
                />
                <Button disabled={lookupBin.isPending || !scanInput.trim()} onClick={() => lookupCode(scanInput)}>
                  <Search className="mr-2 h-4 w-4" />
                  Lookup
                </Button>
              </div>

              {(cameraActive || cameraError) && (
                <div className="space-y-2">
                  <video ref={videoRef} className={cameraActive ? "aspect-video w-full rounded-md border bg-black object-cover" : "hidden"} muted playsInline />
                  {cameraError && <p className="text-sm text-destructive">{cameraError}</p>}
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div className="rounded-md border p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Selected Bin</div>
                  {selectedBin ? (
                    <div className="mt-3 space-y-3">
                      <div>
                        <div className="font-semibold">{selectedBin.binLabel}</div>
                        <div className="text-sm text-muted-foreground">{selectedBin.productTitle}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {selectedBin.sku && <Badge variant="outline">SKU {selectedBin.sku}</Badge>}
                        <Badge variant="outline">Unit {formatNumber(selectedBin.unitWeightOz, 4)} oz</Badge>
                        <Badge variant="outline">Tare {formatNumber(selectedBin.emptyBinWeightOz)} oz</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Last count: {selectedBin.lastQuantity?.toLocaleString() || "None"} units
                        {selectedBin.lastCountAt ? ` on ${formatDate(selectedBin.lastCountAt)}` : ""}
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setQrBin(selectedBin)}>
                        <QrCode className="mr-2 h-4 w-4" />
                        Show QR Label
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">No bin loaded yet.</p>
                  )}
                </div>

                <div className="rounded-md border p-4">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px_130px]">
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total Bin Weight</label>
                      <input
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                        inputMode="decimal"
                        placeholder="20"
                        value={totalWeight}
                        onChange={(event) => setTotalWeight(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Unit</label>
                      <select
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                        value={weightUnit}
                        onChange={(event) => setWeightUnit(event.target.value as "lb" | "oz")}
                      >
                        <option value="lb">Pounds</option>
                        <option value="oz">Ounces</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Round</label>
                      <select
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                        value={roundingMode}
                        onChange={(event) => setRoundingMode(event.target.value as "nearest" | "floor" | "ceil")}
                      >
                        <option value="nearest">Nearest</option>
                        <option value="floor">Floor</option>
                        <option value="ceil">Ceil</option>
                      </select>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <input
                      className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                      placeholder="Counted by"
                      value={countedBy}
                      onChange={(event) => setCountedBy(event.target.value)}
                    />
                    <input
                      className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                      placeholder="Notes"
                      value={countNotes}
                      onChange={(event) => setCountNotes(event.target.value)}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="outline" disabled={calculate.isPending || !totalWeight} onClick={() => handleCalculate(false)}>
                      <Calculator className="mr-2 h-4 w-4" />
                      Calculate
                    </Button>
                    <Button disabled={calculate.isPending || !totalWeight || !selectedBin} onClick={() => handleCalculate(true)}>
                      <PackageCheck className="mr-2 h-4 w-4" />
                      Save Count
                    </Button>
                  </div>

                  <div className="mt-4 rounded-md bg-muted/60 p-4">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Formula</div>
                    <div className="mt-1 font-mono text-sm">{countFormula}</div>
                    {calculationResult && (
                      <div className="mt-4 flex flex-wrap items-end gap-4">
                        <div>
                          <div className="text-xs text-muted-foreground">Quantity</div>
                          <div className="text-4xl font-bold">{calculationResult.quantity.toLocaleString()}</div>
                        </div>
                        <div className="pb-1 text-sm text-muted-foreground">
                          Net weight {formatNumber(calculationResult.netWeightOz)} oz, raw count {formatNumber(calculationResult.rawQuantity, 2)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-5">
              <div>
                <h2 className="text-base font-semibold">Create QR Bin Label</h2>
                <p className="text-sm text-muted-foreground">Use Shopify/imported catalog products, then add the measured individual part weight.</p>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Catalog Product</label>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={newBin.productId}
                    onChange={(event) => handleProductChange(event.target.value)}
                  >
                    <option value="">Manual product or SKU</option>
                    {products.slice(0, 500).map((product: any) => (
                      <option key={product.id} value={product.id}>
                        {product.sku ? `${product.sku} | ` : ""}{product.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Bin Label</label>
                  <input
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    value={newBin.binLabel}
                    onChange={(event) => setNewBin((prev) => ({ ...prev, binLabel: event.target.value }))}
                    placeholder="Aisle 2 - IBBZ-33921"
                  />
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-4">
                <div className="space-y-1 lg:col-span-2">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Product Title</label>
                  <input
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    value={newBin.productTitle}
                    onChange={(event) => setNewBin((prev) => ({ ...prev, productTitle: event.target.value }))}
                    placeholder={selectedProduct?.title || "Product name"}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">SKU</label>
                  <input
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    value={newBin.sku}
                    onChange={(event) => setNewBin((prev) => ({ ...prev, sku: event.target.value }))}
                    placeholder="IBBZ-..."
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Location</label>
                  <input
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    value={newBin.location}
                    onChange={(event) => setNewBin((prev) => ({ ...prev, location: event.target.value }))}
                    placeholder="Rack / aisle"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-[180px_180px_minmax(0,1fr)_auto]">
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Unit Weight Oz</label>
                  <input
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    inputMode="decimal"
                    value={newBin.unitWeightOz}
                    onChange={(event) => setNewBin((prev) => ({ ...prev, unitWeightOz: event.target.value }))}
                    placeholder="1.3"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Empty Bin Oz</label>
                  <input
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    inputMode="decimal"
                    value={newBin.emptyBinWeightOz}
                    onChange={(event) => setNewBin((prev) => ({ ...prev, emptyBinWeightOz: event.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</label>
                  <input
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    value={newBin.notes}
                    onChange={(event) => setNewBin((prev) => ({ ...prev, notes: event.target.value }))}
                    placeholder="Optional"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    className="w-full"
                    disabled={createBin.isPending || !newBin.unitWeightOz || (!newBin.productId && !newBin.productTitle)}
                    onClick={handleCreateBin}
                  >
                    <QrCode className="mr-2 h-4 w-4" />
                    Create QR
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-4">
          <Card>
            <CardContent className="space-y-4 pt-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Inventory Bins</h2>
                  <p className="text-sm text-muted-foreground">{bins.length} active labels</p>
                </div>
                <input
                  className="h-9 w-40 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Search bins"
                  value={binSearch}
                  onChange={(event) => setBinSearch(event.target.value)}
                />
              </div>

              <div className="max-h-[560px] space-y-2 overflow-auto pr-1">
                {binsLoading ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">Loading bins...</div>
                ) : bins.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">No inventory bins yet.</div>
                ) : bins.map((bin) => (
                  <div key={bin.id} className={`rounded-md border p-3 ${selectedBin?.id === bin.id ? "border-primary bg-primary/5" : "bg-background"}`}>
                    <div className="flex items-start gap-3">
                      {bin.product?.imageUrl && (
                        <img src={bin.product.imageUrl} alt={bin.productTitle} className="h-12 w-12 rounded object-cover" loading="lazy" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{bin.binLabel}</div>
                        <div className="truncate text-xs text-muted-foreground">{bin.productTitle}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {bin.sku && <Badge variant="outline" className="text-[10px]">SKU {bin.sku}</Badge>}
                          <Badge variant="outline" className="text-[10px]">{formatNumber(bin.unitWeightOz, 4)} oz</Badge>
                          {bin.location && <Badge variant="outline" className="text-[10px]">{bin.location}</Badge>}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-muted-foreground">
                        Last: {bin.lastQuantity?.toLocaleString() || "None"}
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedBin(bin)}>Count</Button>
                        <Button variant="ghost" size="sm" onClick={() => setQrBin(bin)}>QR</Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Archive bin"
                          disabled={archiveBin.isPending}
                          onClick={async () => {
                            try {
                              await archiveBin.mutateAsync(bin.id);
                              if (selectedBin?.id === bin.id) setSelectedBin(null);
                              toast({ title: "Bin archived", description: bin.binLabel });
                            } catch (err: any) {
                              toast({ title: "Archive failed", description: err.message, variant: "destructive" });
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-5">
              <div>
                <h2 className="text-base font-semibold">Recent Counts</h2>
                <p className="text-sm text-muted-foreground">Saved scale calculations for audit trail.</p>
              </div>

              <div className="space-y-2">
                {counts.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">No saved counts yet.</div>
                ) : counts.map((count) => (
                  <div key={count.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{count.productTitle}</div>
                        <div className="text-xs text-muted-foreground">{formatDate(count.createdAt)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-semibold">{count.quantity.toLocaleString()}</div>
                        <div className="text-xs text-muted-foreground">units</div>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      ({formatNumber(count.totalWeightOz)} - {formatNumber(count.emptyBinWeightOz)}) / {formatNumber(count.unitWeightOz, 4)} = {formatNumber(count.rawQuantity, 2)}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </aside>
      </main>

      {qrBin && <QrLabel bin={qrBin} onClose={() => setQrBin(null)} />}
    </div>
  );
}
