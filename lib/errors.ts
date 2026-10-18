const storageMessages = {
  DATABASE_MODE_INVALID:
    "La configuración de las conexiones de Administración está incompleta.",
  ADMIN_PRODUCTION_ACCESS_BLOCKED:
    "La conexión de Administración no está habilitada para este entorno.",
  SOURCE_PRODUCTION_ACCESS_BLOCKED:
    "La lectura de tickets no está habilitada para este entorno.",
  ADMIN_ENVIRONMENT_INVALID:
    "Falta configurar el entorno de la base de Administración.",
  SOURCE_ENVIRONMENT_INVALID:
    "Falta configurar el entorno de la base de tickets.",
  ADMIN_IDENTITY_INVALID:
    "Falta configurar la identidad de la base de Administración.",
  SOURCE_IDENTITY_INVALID:
    "Falta configurar la identidad de la base de tickets.",
  ADMIN_CONNECTION_INVALID:
    "Falta configurar la conexión de la base de Administración.",
  SOURCE_CONNECTION_INVALID:
    "Falta configurar la conexión de la base de tickets.",
  DATABASE_SEPARATION_REQUIRED:
    "Administración necesita una base diferente de la base de tickets.",
  ADMIN_SCHEMA_MISSING:
    "La base de Administración necesita instalar su esquema.",
  SOURCE_SCHEMA_MISSING:
    "La base de tickets no contiene el esquema esperado.",
  ADMIN_IDENTITY_MISMATCH:
    "La identidad o el entorno de la base de Administración no coincide con la configuración.",
  SOURCE_IDENTITY_MISMATCH:
    "La identidad o el entorno de la base de tickets no coincide con la configuración.",
  SOURCE_READ_ONLY_REQUIRED:
    "La conexión de tickets debe ser de sólo lectura.",
  SOURCE_READER_PERMISSIONS_INVALID:
    "La conexión de tickets necesita un usuario exclusivo de sólo lectura.",
  DATABASE_CONNECTION_FAILED:
    "No hay conexión con la base de datos. Intenta de nuevo en un momento.",
  DATABASE_AUTHENTICATION_FAILED:
    "No fue posible acceder a la base de datos. Revisa la configuración del servidor.",
  DATABASE_NOT_FOUND:
    "La base de datos configurada no está disponible.",
  DATABASE_SCHEMA_INCOMPLETE:
    "El esquema de la base de datos está incompleto o desactualizado.",
  DATABASE_PERMISSION_DENIED:
    "La conexión no tiene los permisos necesarios para completar la operación.",
  DATABASE_TLS_FAILED:
    "No fue posible establecer una conexión segura con la base de datos.",
  OPERATION_UNAVAILABLE:
    "No fue posible completar la operación. Intenta de nuevo en un momento.",
} as const;

export type StorageErrorCode = keyof typeof storageMessages;

/** Carries only a known diagnostic code; no connection strings or driver errors. */
export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

const driverCodes: Readonly<Record<string, StorageErrorCode>> = {
  ECONNREFUSED: "DATABASE_CONNECTION_FAILED",
  ECONNRESET: "DATABASE_CONNECTION_FAILED",
  ENOTFOUND: "DATABASE_CONNECTION_FAILED",
  EAI_AGAIN: "DATABASE_CONNECTION_FAILED",
  ETIMEDOUT: "DATABASE_CONNECTION_FAILED",
  EHOSTUNREACH: "DATABASE_CONNECTION_FAILED",
  ENETUNREACH: "DATABASE_CONNECTION_FAILED",
  "08000": "DATABASE_CONNECTION_FAILED",
  "08001": "DATABASE_CONNECTION_FAILED",
  "08003": "DATABASE_CONNECTION_FAILED",
  "08004": "DATABASE_CONNECTION_FAILED",
  "08006": "DATABASE_CONNECTION_FAILED",
  "08007": "DATABASE_CONNECTION_FAILED",
  "08P01": "DATABASE_CONNECTION_FAILED",
  "53300": "DATABASE_CONNECTION_FAILED",
  "57P01": "DATABASE_CONNECTION_FAILED",
  "57P02": "DATABASE_CONNECTION_FAILED",
  "57P03": "DATABASE_CONNECTION_FAILED",
  "28P01": "DATABASE_AUTHENTICATION_FAILED",
  "28000": "DATABASE_AUTHENTICATION_FAILED",
  "3D000": "DATABASE_NOT_FOUND",
  "3F000": "DATABASE_SCHEMA_INCOMPLETE",
  "42P01": "DATABASE_SCHEMA_INCOMPLETE",
  "42703": "DATABASE_SCHEMA_INCOMPLETE",
  "42883": "DATABASE_SCHEMA_INCOMPLETE",
  "42501": "DATABASE_PERMISSION_DENIED",
  "25006": "DATABASE_PERMISSION_DENIED",
  DEPTH_ZERO_SELF_SIGNED_CERT: "DATABASE_TLS_FAILED",
  SELF_SIGNED_CERT_IN_CHAIN: "DATABASE_TLS_FAILED",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "DATABASE_TLS_FAILED",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "DATABASE_TLS_FAILED",
  CERT_HAS_EXPIRED: "DATABASE_TLS_FAILED",
  ERR_TLS_CERT_ALTNAME_INVALID: "DATABASE_TLS_FAILED",
};

/** Never returns a raw error message, SQL, hostname, username or arbitrary code. */
export function storageDiagnostic(error: unknown): {
  code: StorageErrorCode;
  message: string;
} {
  let code: StorageErrorCode = "OPERATION_UNAVAILABLE";
  if (error instanceof StorageError) {
    code = error.code;
  } else if (error !== null && typeof error === "object") {
    const driverCode = (error as { code?: unknown }).code;
    if (typeof driverCode === "string" && Object.hasOwn(driverCodes, driverCode))
      code = driverCodes[driverCode];
    // pg pool timeouts can be ordinary Errors without a driver code.
    else if (
      error instanceof Error &&
      [
        "Connection terminated due to connection timeout",
        "Connection terminated unexpectedly",
        "timeout exceeded when trying to connect",
      ].includes(error.message)
    )
      code = "DATABASE_CONNECTION_FAILED";
    else if (
      error instanceof Error &&
      error.message === "The server does not support SSL connections"
    )
      code = "DATABASE_TLS_FAILED";
  }
  return { code, message: storageMessages[code] };
}
