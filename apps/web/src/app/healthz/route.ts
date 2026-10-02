// Liveness probe for the container orchestrator. Does not call the API.
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ status: 'ok' });
}
