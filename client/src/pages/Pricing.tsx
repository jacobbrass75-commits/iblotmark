import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const VENMO_HANDLE = import.meta.env.VITE_VENMO_HANDLE || "@your-venmo-handle";

interface TierFeature {
  label: string;
  free: string;
  pro: string;
  max: string;
}

const features: TierFeature[] = [
  { label: "Documents", free: "5 active", pro: "50 active", max: "Unlimited" },
  { label: "Projects", free: "1", pro: "10", max: "Unlimited" },
  { label: "Storage", free: "50 MB", pro: "500 MB", max: "5 GB" },
  { label: "Citations", free: "10/day (Chicago)", pro: "Unlimited (all formats)", max: "Unlimited (all formats)" },
  { label: "OCR", free: "PaddleOCR", pro: "GPT-4o-mini Vision", max: "GPT-4o Vision" },
  { label: "Chat History", free: "Last 5", pro: "Unlimited", max: "Unlimited" },
  { label: "Output Tokens/mo", free: "50K", pro: "500K", max: "2M" },
  { label: "AI Writing", free: "---", pro: "Quick Draft (Haiku 4.5)", max: "Quick + Deep Write (Sonnet 4.5)" },
  { label: "Source Verified", free: "---", pro: "---", max: "Yes" },
  { label: "Export", free: "---", pro: "DOCX / PDF", max: "Bulk Export" },
  { label: "Chrome Extension", free: "---", pro: "Yes", max: "Yes" },
  { label: "Bibliography Gen", free: "---", pro: "Yes", max: "Yes" },
  { label: "En-dash Toggle", free: "---", pro: "Yes", max: "Yes" },
];

function VenmoButton({ amount, label }: { amount: string; label: string }) {
  const venmoUrl = `https://venmo.com/${VENMO_HANDLE.replace("@", "")}?txn=pay&amount=${amount}&note=ScholarMark%20${label}`;
  return (
    <Button asChild className="w-full">
      <a href={venmoUrl} target="_blank" rel="noopener noreferrer">
        Pay with Venmo
      </a>
    </Button>
  );
}

export default function Pricing() {
  const { user, isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  const currentTier = user?.tier ?? "free";

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">ScholarMark Pricing</h1>
            <p className="text-muted-foreground mt-1">
              Choose the plan that fits your research needs
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isSignedIn ? (
              <>
                <Button variant="ghost" onClick={() => setLocation("/")}>
                  Dashboard
                </Button>
                <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
                  {user?.email}
                </div>
              </>
            ) : (
              <Button onClick={() => setLocation("/sign-in")}>Sign In</Button>
            )}
          </div>
        </div>

        {/* Tier Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {/* Free */}
          <Card className={currentTier === "free" ? "border-primary" : ""}>
            <CardHeader>
              <CardTitle>Free</CardTitle>
              <CardDescription>Get started with the basics</CardDescription>
              <div className="text-3xl font-bold mt-2">$0<span className="text-sm font-normal text-muted-foreground">/mo</span></div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>5 active documents</p>
              <p>1 project</p>
              <p>50 MB storage</p>
              <p>10 citations/day (Chicago)</p>
              <p>PaddleOCR</p>
              <p>50K output tokens/mo</p>
            </CardContent>
            <CardFooter>
              {currentTier === "free" ? (
                <Button className="w-full" variant="outline" disabled>Current Plan</Button>
              ) : (
                <Button className="w-full" variant="outline" onClick={() => setLocation("/sign-up")}>
                  Sign Up Free
                </Button>
              )}
            </CardFooter>
          </Card>

          {/* Pro */}
          <Card className={`border-2 ${currentTier === "pro" ? "border-primary" : "border-primary/50"}`}>
            <CardHeader>
              <div className="text-xs font-semibold uppercase text-primary mb-1">Most Popular</div>
              <CardTitle>Pro</CardTitle>
              <CardDescription>For serious researchers</CardDescription>
              <div className="text-3xl font-bold mt-2">$14<span className="text-sm font-normal text-muted-foreground">/mo</span></div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>50 active documents</p>
              <p>10 projects</p>
              <p>500 MB storage</p>
              <p>Unlimited citations (all formats)</p>
              <p>GPT-4o-mini Vision OCR</p>
              <p>500K output tokens/mo</p>
              <p>AI Writing: Quick Draft (Haiku 4.5)</p>
              <p>DOCX/PDF export</p>
              <p>Chrome extension</p>
              <p>Bibliography generation</p>
            </CardContent>
            <CardFooter>
              {currentTier === "pro" ? (
                <Button className="w-full" disabled>Current Plan</Button>
              ) : (
                <VenmoButton amount="14" label="Pro" />
              )}
            </CardFooter>
          </Card>

          {/* Max */}
          <Card className={currentTier === "max" ? "border-primary" : ""}>
            <CardHeader>
              <CardTitle>Max</CardTitle>
              <CardDescription>Unlimited power for your thesis</CardDescription>
              <div className="text-3xl font-bold mt-2">$50<span className="text-sm font-normal text-muted-foreground">/mo</span></div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>Unlimited documents</p>
              <p>Unlimited projects</p>
              <p>5 GB storage</p>
              <p>All citation formats</p>
              <p>GPT-4o Vision OCR</p>
              <p>2M output tokens/mo</p>
              <p>Quick Draft + Deep Write (Sonnet 4.5)</p>
              <p>Source Verified pipeline</p>
              <p>Bulk export</p>
              <p>Everything in Pro</p>
            </CardContent>
            <CardFooter>
              {currentTier === "max" ? (
                <Button className="w-full" disabled>Current Plan</Button>
              ) : (
                <VenmoButton amount="50" label="Max" />
              )}
            </CardFooter>
          </Card>
        </div>

        {/* Feature Comparison Table */}
        <h2 className="text-xl font-semibold mb-4">Full Feature Comparison</h2>
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left p-3 font-medium">Feature</th>
                <th className="text-center p-3 font-medium">Free</th>
                <th className="text-center p-3 font-medium">Pro ($14/mo)</th>
                <th className="text-center p-3 font-medium">Max ($50/mo)</th>
              </tr>
            </thead>
            <tbody>
              {features.map((f, i) => (
                <tr key={f.label} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                  <td className="p-3 font-medium">{f.label}</td>
                  <td className="p-3 text-center text-muted-foreground">{f.free}</td>
                  <td className="p-3 text-center">{f.pro}</td>
                  <td className="p-3 text-center">{f.max}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
