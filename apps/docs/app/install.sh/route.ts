import installScript from "../../../../packages/cli/install.sh";

const headers = {
  "Cache-Control": "public, max-age=300",
  "Content-Disposition": 'inline; filename="install.sh"',
  "Content-Type": "text/x-shellscript; charset=utf-8",
};

export const GET = () => new Response(installScript, { headers });
