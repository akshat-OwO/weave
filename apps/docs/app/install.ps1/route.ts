import installScript from "../../../../packages/cli/install.ps1";

const headers = {
  "Cache-Control": "public, max-age=300",
  "Content-Disposition": 'inline; filename="install.ps1"',
  "Content-Type": "text/plain; charset=utf-8",
};

export const GET = () => new Response(installScript, { headers });
