export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      parsed.origin === origin &&
      parsed.host === request.headers.get("host")
    );
  } catch {
    return false;
  }
}
