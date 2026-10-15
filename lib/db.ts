import { Pool, type PoolClient, type QueryResultRow } from 'pg';

type Settings = { url: string; database: string; instance: string; environment: string };
declare global { var _adminDatabase: { pool: Pool; settings: Settings } | undefined; }

export function databaseSettings(): Settings {
  if (process.env.SHARED_DATABASE_MODE !== 'true' || process.env.CENTRAL_INVENTORY_DATABASE_URL !== undefined)
    throw new Error('Administración requiere exclusivamente el modo de base compartida.');
  const environment = process.env.SHARED_DATABASE_ENVIRONMENT;
  if (!['development', 'production'].includes(environment || '')) throw new Error('Configura el entorno de la base compartida.');
  if (environment === 'production' && process.env.NODE_ENV !== 'production') throw new Error('Desarrollo no puede operar la base de producción.');
  const instance = process.env.SHARED_DATABASE_ID || '';
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(instance)) throw new Error('Configura la identidad de la base compartida.');
  const url = process.env.DATABASE_URL || '';
  let database: string;
  try {
    const parsed = new URL(url);
    database = decodeURIComponent(parsed.pathname.slice(1));
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !database || database.includes('/')) throw Error();
  } catch { throw new Error('Configura una conexión PostgreSQL válida.'); }
  return { url, database, instance: instance.toLowerCase(), environment: environment! };
}

export async function getClient(): Promise<PoolClient> {
  const settings = databaseSettings();
  const previous = global._adminDatabase;
  if (!previous || JSON.stringify(previous.settings) !== JSON.stringify(settings)) {
    global._adminDatabase = { settings, pool: new Pool({
      connectionString: settings.url, application_name: 'sistema_administracion',
      max: 5, connectionTimeoutMillis: 5000,
      options: '-c timezone=America/Mexico_City -c search_path=public -c statement_timeout=15000',
      ssl: process.env.DB_REQUIRE_SSL === 'true' ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined,
    }) };
    if (previous) void previous.pool.end();
  }
  const client = await global._adminDatabase!.pool.connect();
  try {
    const identity = await client.query("SELECT current_database() AS database,to_regclass('shared_runtime.configuration')::text AS configuration");
    if (identity.rows[0]?.database !== settings.database || !identity.rows[0]?.configuration) throw Error('La base no tiene la identidad compartida esperada.');
    const { rows } = await client.query('SELECT version,environment,instance_id::text FROM shared_runtime.configuration WHERE singleton IS TRUE');
    if (rows.length !== 1 || rows[0].version !== 1 || rows[0].environment !== settings.environment || rows[0].instance_id !== settings.instance)
      throw Error('La versión, entorno o instancia de la base compartida no coincide.');
    return client;
  } catch (error) { client.release(true); throw error; }
}

export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) {
  const client = await getClient();
  try { return await client.query<T>(sql, values); } finally { client.release(); }
}

export async function transaction<T>(operation: (client: PoolClient) => Promise<T>) {
  const client = await getClient();
  let broken = false;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { broken = true; }
    throw error;
  } finally { client.release(broken); }
}
