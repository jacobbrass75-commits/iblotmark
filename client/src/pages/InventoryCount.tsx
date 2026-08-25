import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import QRCode from "qrcode";
import {
  ArrowLeft,
  Calculator,
  Camera,
  Download,
  PackageCheck,
  QrCode,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useProducts, useSyncShopifyInventory } from "@/hooks/useProducts";
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

type ShopifyInventorySummary = {
  totalAvailable?: number | null;
  tracked?: boolean;
  syncedAt?: string | null;
  inventoryItemCount?: number;
  locationCount?: number;
};

function getShopifyInventorySummary(product: any): ShopifyInventorySummary | null {
  const summary = product?.sourceData?.shopifyInventory;
  return summary && typeof summary === "object" ? summary : null;
}

function formatShopifyQuantity(summary: ShopifyInventorySummary | null) {
  if (!summary) return null;
  if (typeof summary.totalAvailable === "number" && Number.isFinite(summary.totalAvailable)) {
    return `${summary.totalAvailable.toLocaleString()} Shopify units`;
  }
  return summary.tracked === false ? "Not tracked in Shopify" : "Shopify quantity unavailable";
}

function numericValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getCatalogUnitWeightOz(product: any): number | null {
  return numericValue(product?.sourceData?.unitWeightOz)
    || numericValue(product?.sourceData?.partWeightOz)
    || numericValue(product?.specs?.unitWeightOz)
    || numericValue(product?.variants?.find((variant: any) => numericValue(variant?.unitWeightOz))?.unitWeightOz)
    || null;
}

function readableMutationError(error: any): string {
  const message = String(error?.message || "Request failed");
  const jsonStart = message.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(message.slice(jsonStart));
      if (typeof parsed?.error === "string") return parsed.error;
      if (typeof parsed?.message === "string") return parsed.message;
    } catch {
      // Fall through to the original message.
    }
  }
  return message.replace(/^\d+:\s*/, "");
}

function normalizeCatalogScan(raw: string): string {
  const scanned = raw.trim();
  if (!scanned) return "";

  try {
    const url = new URL(scanned);
    for (const key of ["sku", "barcode", "variant", "product", "q"]) {
      const value = url.searchParams.get(key);
      if (value?.trim()) return value.trim();
    }
    const segments = url.pathname.split("/").filter(Boolean);
    const productIndex = segments.findIndex((segment) => segment === "products");
    if (productIndex >= 0 && segments[productIndex + 1]) return segments[productIndex + 1];
    return segments.at(-1) || scanned;
  } catch {
    return scanned;
  }
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function variantValues(variant: any): Array<{ value: string; field: string }> {
  if (!variant || typeof variant !== "object") return [];
  return [
    { value: stringValue(variant.sku) || "", field: "sku" },
    { value: stringValue(variant.barcode) || "", field: "barcode" },
    { value: stringValue(variant.id) || "", field: "variant" },
    { value: stringValue(variant.inventory_item_id || variant.inventoryItemId) || "", field: "inventory" },
    { value: stringValue(variant.title) || "", field: "title" },
  ].filter((item) => item.value);
}

function findCatalogProductForScan(products: any[], raw: string): { product: any; matchedSku: string | null } | null {
  const normalized = normalizeCatalogScan(raw);
  const code = normalized.toLowerCase();
  if (!code) return null;

  let best: { product: any; matchedSku: string | null; score: number } | null = null;

  for (const product of products) {
    const variants = [
      ...(Array.isArray(product.variants) ? product.variants : []),
      ...(Array.isArray(product.sourceData?.shopifyProduct?.variants) ? product.sourceData.shopifyProduct.variants : []),
    ];
    const candidates: Array<{ value: string; field: string }> = [
      { value: stringValue(product.sku) || "", field: "sku" },
      { value: stringValue(product.handle) || "", field: "handle" },
      { value: stringValue(product.title) || "", field: "title" },
      { value: stringValue(product.shopifyId) || "", field: "shopify" },
      ...variants.flatMap(variantValues),
    ].filter((item) => item.value);

    for (const candidate of candidates) {
      const value = candidate.value.toLowerCase();
      let score = 0;
      if (value === code) {
        score = candidate.field === "sku" || candidate.field === "barcode" ? 120 : 100;
      } else if (code.length >= 4 && value.includes(code)) {
        score = candidate.field === "sku" || candidate.field === "barcode" ? 80 : 45;
      }

      if (score > (best?.score || 0)) {
        best = {
          product,
          matchedSku: candidate.field === "sku" || candidate.field === "barcode" ? candidate.value : product.sku || null,
          score,
        };
      }
    }
  }

  return best && best.score >= 45 ? { product: best.product, matchedSku: best.matchedSku } : null;
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
  const syncShopifyInventory = useSyncShopifyInventory();
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
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scanHandledRef = useRef(false);
  const initialScanHandled = useRef(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");

  const productsById = useMemo(() => {
    return new Map(products.map((product: any) => [product.id, product]));
  }, [products]);

  const selectedProduct = newBin.productId ? productsById.get(newBin.productId) : null;
  const selectedProductInventory = getShopifyInventorySummary(selectedProduct);
  const selectedBinInventory = getShopifyInventorySummary(selectedBin?.product);

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
      const match = findCatalogProductForScan(products, trimmed);
      if (match) {
        const product = match.product;
        const sku = match.matchedSku || product.sku || product.handle || "";
        const unitWeightOz = getCatalogUnitWeightOz(product);
        setNewBin((prev) => ({
          ...prev,
          productId: product.id,
          productTitle: product.title || prev.productTitle,
          sku,
          binLabel: prev.binLabel || `${sku || product.title} - Main Bin`,
          unitWeightOz: unitWeightOz ? String(unitWeightOz) : prev.unitWeightOz,
        }));
        setCalculationResult(null);
        toast({
          title: "Product found",
          description: unitWeightOz
            ? "No QR bin exists yet. Unit weight filled from the imported part sheet."
            : "No QR bin exists yet. Add unit weight, then create the bin label.",
        });
        return;
      }

      toast({
        title: "Scan not found",
        description: `${readableMutationError(err)} Create a QR bin first, or sync Shopify with product/inventory read scopes.`,
        variant: "destructive",
      });
    }
  };

  const handleProductChange = (productId: string) => {
    const product = productsById.get(productId);
    const unitWeightOz = getCatalogUnitWeightOz(product);
    setNewBin((prev) => ({
      ...prev,
      productId,
      productTitle: product?.title || prev.productTitle,
      sku: product?.sku || product?.handle || prev.sku,
      binLabel: prev.binLabel || `${product?.sku || product?.handle || product?.title || "Product"} - Main Bin`,
      unitWeightOz: unitWeightOz ? String(unitWeightOz) : prev.unitWeightOz,
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

  const handleShopifyInventorySync = async () => {
    try {
      const result = await syncShopifyInventory.mutateAsync();
      if (result.inventoryError) {
        toast({
          title: "Shopify products synced",
          description: `Inventory blocked: ${result.inventoryError}`,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Shopify inventory synced",
        description: `${result.total} products, ${result.inventoryTrackedItems || 0} inventory items`,
      });
    } catch (err: any) {
      toast({
        title: "Shopify sync failed",
        description: readableMutationError(err),
        variant: "destructive",
      });
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
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    const stream = videoRef.current?.srcObject;
    if (stream instanceof MediaStream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    scanHandledRef.current = false;
    setCameraActive(false);
  };

  const waitForVideoElement = async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (videoRef.current) return videoRef.current;
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    }
    throw new Error("Could not open the camera preview.");
  };

  const startCamera = async () => {
    setCameraError("");
    setCameraActive(true);
    scanHandledRef.current = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is not available in this browser.");
      const video = await waitForVideoElement();
      const reader = new BrowserMultiFormatReader(undefined, {
        delayBetweenScanAttempts: 250,
        delayBetweenScanSuccess: 500,
      });
      const controls = await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        video,
        (result, _error, activeControls) => {
          if (!result || scanHandledRef.current) return;
          scanHandledRef.current = true;
          const value = result.getText();
          activeControls.stop();
          scannerControlsRef.current = null;
          setCameraActive(false);
          setScanInput(value);
          void lookupCode(value);
        },
      );
      if (scanHandledRef.current) {
        controls.stop();
      } else {
        scannerControlsRef.current = controls;
      }
    } catch (err: any) {
      stopCamera();
      if (err?.name === "NotAllowedError") {
        setCameraError("Camera permission was denied. Allow camera access in the browser, then try again.");
      } else {
        setCameraError(err.message || "Could not start camera.");
      }
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
        <div className="container mx-auto flex min-h-14 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:py-0">
          <div className="flex min-w-0 items-start gap-3 sm:items-center">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label="Back to content dashboard"
              onClick={() => setLocation("/blog")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-lg font-bold">Inventory Count</h1>
              <p className="text-xs leading-5 text-muted-foreground">QR labels, scanner lookup, and scale-weight quantity math</p>
            </div>
          </div>
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
            <Button
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              disabled={syncShopifyInventory.isPending}
              onClick={handleShopifyInventorySync}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${syncShopifyInventory.isPending ? "animate-spin" : ""}`} />
              {syncShopifyInventory.isPending ? "Syncing" : "Sync Shopify"}
            </Button>
            <Badge variant="outline" className="hidden sm:inline-flex">
              Empty bin tare: {EMPTY_BIN_WEIGHT_OZ} oz
            </Badge>
          </div>
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
                  <video ref={videoRef} className={cameraActive ? "aspect-video w-full rounded-md border bg-black object-cover" : "hidden"} muted playsInline autoPlay />
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
                        {selectedBinInventory && (
                          <Badge variant="secondary">{formatShopifyQuantity(selectedBinInventory)}</Badge>
                        )}
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

              {selectedProductInventory && (
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                  <div className="font-medium">{formatShopifyQuantity(selectedProductInventory)}</div>
                  <div className="text-xs text-muted-foreground">
                    {selectedProductInventory.inventoryItemCount || 0} inventory items
                    {selectedProductInventory.locationCount ? ` across ${selectedProductInventory.locationCount} locations` : ""}
                    {selectedProductInventory.syncedAt ? ` | synced ${formatDate(selectedProductInventory.syncedAt)}` : ""}
                  </div>
                </div>
              )}

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
                ) : bins.map((bin) => {
                  const binShopifyInventory = getShopifyInventorySummary(bin.product);
                  return (
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
                          {binShopifyInventory && (
                            <Badge variant="secondary" className="text-[10px]">{formatShopifyQuantity(binShopifyInventory)}</Badge>
                          )}
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
                  );
                })}
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
