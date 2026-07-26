import { ArrowRight, Box, Clock3, ShieldCheck, Terminal } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

interface FeatureProps {
  readonly description: string;
  readonly icon: ReactNode;
  readonly title: string;
}

const Feature = ({ description, icon, title }: FeatureProps) => (
  <article className="bg-fd-background rounded-xl border p-5">
    <div className="bg-fd-primary text-fd-primary-foreground mb-4 flex size-10 items-center justify-center rounded-lg">
      {icon}
    </div>
    <h2 className="font-semibold">{title}</h2>
    <p className="text-fd-muted-foreground mt-2 text-sm leading-6">
      {description}
    </p>
  </article>
);

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-6 py-20 text-center lg:py-28">
        <div className="bg-fd-secondary text-fd-muted-foreground mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
          <Terminal className="size-4" />
          Sandboxed environments from your terminal
        </div>
        <h1 className="max-w-4xl text-5xl font-semibold tracking-tight text-balance sm:text-7xl">
          Disposable Linux VMs, woven in seconds.
        </h1>
        <p className="text-fd-muted-foreground mt-6 max-w-2xl text-lg text-balance sm:text-xl">
          Weave wraps Lima with secure defaults, automatic expiry, and a focused
          command set for short-lived development environments.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            className="bg-fd-primary text-fd-primary-foreground inline-flex h-11 items-center gap-2 rounded-lg px-5 font-medium"
            href="/docs"
          >
            Get started
            <ArrowRight className="size-4" />
          </Link>
          <Link
            className="hover:bg-fd-accent inline-flex h-11 items-center rounded-lg border px-5 font-medium"
            href="https://github.com/akshat-OwO/weave"
          >
            View on GitHub
          </Link>
        </div>
      </section>

      <section className="bg-fd-secondary/30 border-t">
        <div className="mx-auto grid w-full max-w-6xl gap-4 px-6 py-12 md:grid-cols-3">
          <Feature
            description="Host-directory mounts are disabled so guest commands stay inside the VM."
            icon={<ShieldCheck className="size-5" />}
            title="Isolated by default"
          />
          <Feature
            description="Give every environment a TTL and let Weave stop it automatically."
            icon={<Clock3 className="size-5" />}
            title="Automatic expiry"
          />
          <Feature
            description="Start with built-in Node.js and Python templates or bring your own Lima YAML."
            icon={<Box className="size-5" />}
            title="Ready-to-use templates"
          />
        </div>
      </section>
    </main>
  );
}
