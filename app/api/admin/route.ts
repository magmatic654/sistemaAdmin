import { sameOrigin } from "@/lib/request";
import {
  getState,
  lookupSales,
  movementDetail,
  mutate,
  payoutPreview,
} from "@/lib/data";
import { ValidationError } from "@/lib/domain";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  if (error instanceof ValidationError)
    return Response.json({ error: error.message }, { status: 400, headers });
  const code = (error as { code?: string })?.code;
  if (code === "23505")
    return Response.json(
      {
        error:
          "El ticket, la comisión o el proveedor ya está registrado. Actualiza la pantalla antes de continuar.",
      },
      { status: 409, headers },
    );
  console.error("Administration operation failed", {
    code: code || "internal",
  });
  return Response.json(
    {
      error:
        "No fue posible completar la operación. Verifica la conexión y el esquema de Administración.",
    },
    { status: 503, headers },
  );
}
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.has("payout"))
      return Response.json(
        await payoutPreview(
          params.get("employeeId") || "",
          params.get("period") || "",
          params.get("anchor") || "",
        ),
        { headers },
      );
    if (params.has("ticket"))
      return Response.json(
        { sales: await lookupSales(params.get("ticket")!) },
        { headers },
      );
    if (params.has("detail"))
      return Response.json(await movementDetail(params.get("detail")!), {
        headers,
      });
    return Response.json(await getState(params), { headers });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json(
      { error: "Origen no permitido." },
      { status: 403, headers },
    );
  try {
    if (Number(request.headers.get("content-length") || 0) > 100_000)
      throw new ValidationError("La solicitud es demasiado grande.");
    const raw = await request.text();
    if (raw.length > 100_000)
      throw new ValidationError("La solicitud es demasiado grande.");
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      throw new ValidationError("Solicitud inválida.");
    }
    return Response.json(
      await mutate(input.action, input.payload, input.requestId),
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
