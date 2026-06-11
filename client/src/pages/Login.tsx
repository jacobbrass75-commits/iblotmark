import { useLocation } from "wouter";
import { SignIn } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function localModeEnabled(): boolean {
  return import.meta.env.DEV;
}

export default function Login() {
  const [, setLocation] = useLocation();

  if (clerkPublishableKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <SignIn
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
        />
      </div>
    );
  }

  if (!localModeEnabled()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Authentication Not Configured</CardTitle>
            <CardDescription>
              Set VITE_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY before using this production build.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Content Intelligence</CardTitle>
          <CardDescription>
            Local internal mode is enabled. No sign-in is required on this machine.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button className="w-full" onClick={() => setLocation("/blog")}>
            Open Blog Dashboard
          </Button>
          <Button className="w-full" variant="outline" onClick={() => setLocation("/blog/benchmark")}>
            Open AI Benchmark
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
