// Node-based handler tests supply only these Deno APIs. The real Edge runtime
// is checked separately with deno check and its own configuration.
declare namespace Deno {
  const env: { get(key: string): string | undefined };
  function serve(
    handler: (request: Request) => Response | Promise<Response>,
  ): void;
}
