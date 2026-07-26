"use client";

import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { useSyncExternalStore } from "react";

const subscribe = (onStoreChange: () => void) => {
  window.addEventListener("popstate", onStoreChange);

  return () => window.removeEventListener("popstate", onStoreChange);
};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "<docs-origin>";

interface InstallCommandProps {
  readonly environment?: string;
}

export const InstallCommand = ({ environment }: InstallCommandProps) => {
  const origin = useSyncExternalStore(subscribe, getOrigin, getServerOrigin);
  const shell = environment === undefined ? "sh" : `${environment} sh`;
  const command = `curl -fsSL ${origin}/install.sh | ${shell}`;

  return (
    <CodeBlock>
      <Pre>
        <code>{command}</code>
      </Pre>
    </CodeBlock>
  );
};
