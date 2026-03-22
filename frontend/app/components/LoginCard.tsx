"use client";

import { ExternalLink, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type LoginCardProps = {
  loginUrl: string;
};

export function LoginCard({ loginUrl }: LoginCardProps) {
  return (
    <Card className="border-accent/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-accent" />
          Connect Zerodha
        </CardTitle>
        <CardDescription>
          The dashboard can load live option chain data only after your Kite session is connected.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <p className="max-w-2xl text-sm text-slate-300">
          Click once to log in with Zerodha. After approval, you will be redirected back here and the access token will
          be saved automatically.
        </p>
        <Button asChild size="lg">
          <a href={loginUrl}>
            Connect Zerodha
            <ExternalLink className="ml-2 h-4 w-4" />
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
