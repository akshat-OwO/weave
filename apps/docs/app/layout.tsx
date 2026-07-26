import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";

import "./global.css";

export const metadata: Metadata = {
  description:
    "Create disposable, sandboxed Linux virtual machines from your terminal.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ),
  title: {
    default: "Weave",
    template: "%s | Weave",
  },
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
