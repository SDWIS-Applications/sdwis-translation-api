// Database adapter — supports SQL Server, Oracle, PostgreSQL, and demo mode.
//
// Routes write PostgreSQL-style SQL ($1 params, ILIKE, LIMIT/OFFSET).
// This module translates to the target dialect automatically.
//
// Mode selection (first match wins):
//   DEMO_MODE=true         → demo (bundled JSON, no database)
//   MSSQL_SERVER is set    → mssql (SQL Server — most SDWIS/STATE installations)
//   ORACLE_USER is set     → oracle (Oracle — some SDWIS/STATE installations)
//   otherwise              → postgresql (local dev replica)
//
// Environment variables:
//   MSSQL_SERVER, MSSQL_DATABASE, MSSQL_USER, MSSQL_PASSWORD, MSSQL_PORT
//   ORACLE_USER, ORACLE_PASSWORD, ORACLE_CONNECT_STRING
//   DB_HOST, DB_PORT, DB_NAME, DB_USER  (PostgreSQL)

const FORCE_DEMO = process.env.DEMO_MODE === 'true';
const USE_MSSQL = !FORCE_DEMO && !!process.env.MSSQL_SERVER;
const USE_ORACLE = !FORCE_DEMO && !USE_MSSQL && !!process.env.ORACLE_USER;

let mode, query, pool;

// ---------------------------------------------------------------------------
// Helper: translate PostgreSQL SQL to target dialect
// ---------------------------------------------------------------------------

function translateToOracle(text, params) {
  let sql = text;

  // $1,$2 → :1,:2
  sql = sql.replace(/\$(\d+)/g, ':$1');

  // ILIKE → UPPER(col) LIKE UPPER(val)
  sql = sql.replace(/(\S+)\s+ILIKE\s+(\S+)/gi, 'UPPER($1) LIKE UPPER($2)');

  // LIMIT :N OFFSET :M → Oracle 11g ROWNUM wrapping
  const limitMatch = sql.match(/LIMIT\s+:(\d+)\s+OFFSET\s+:(\d+)/i);
  if (limitMatch && params) {
    const limitIdx = parseInt(limitMatch[1]) - 1;
    const offsetIdx = parseInt(limitMatch[2]) - 1;
    const limit = params[limitIdx];
    const offset = params[offsetIdx];
    sql = sql.replace(/\s*LIMIT\s+:\d+\s+OFFSET\s+:\d+/i, '');
    sql = `SELECT * FROM (
      SELECT a.*, ROWNUM rn FROM (${sql}) a
      WHERE ROWNUM <= ${offset + limit}
    ) WHERE rn > ${offset}`;
    params = params.filter((_, i) => i !== limitIdx && i !== offsetIdx);
  }

  // COUNT(*) as total → COUNT(*) total
  sql = sql.replace(/COUNT\(\*\)\s+as\s+total/gi, 'COUNT(*) total');

  // Build Oracle bind object: { "1": val, "2": val, ... }
  const binds = {};
  if (params) {
    params.forEach((val, i) => { binds[String(i + 1)] = val; });
  }

  return { sql, binds, filteredParams: params };
}

function translateToMssql(text, params) {
  let sql = text;

  // $1,$2 → @p1,@p2
  sql = sql.replace(/\$(\d+)/g, '@p$1');

  // ILIKE → LIKE (SQL Server default collation is case-insensitive)
  sql = sql.replace(/(\S+)\s+ILIKE\s+(\S+)/gi, '$1 LIKE $2');

  // LIMIT @pN OFFSET @pM → OFFSET M ROWS FETCH NEXT N ROWS ONLY
  // (SQL Server 2012+)
  const limitMatch = sql.match(/\s*LIMIT\s+@p(\d+)\s+OFFSET\s+@p(\d+)/i);
  if (limitMatch && params) {
    const limitIdx = parseInt(limitMatch[1]) - 1;
    const offsetIdx = parseInt(limitMatch[2]) - 1;
    const limit = params[limitIdx];
    const offset = params[offsetIdx];
    sql = sql.replace(/\s*LIMIT\s+@p\d+\s+OFFSET\s+@p\d+/i, '');
    sql += ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
    params = params.filter((_, i) => i !== limitIdx && i !== offsetIdx);
  }

  return { sql, filteredParams: params };
}

// ---------------------------------------------------------------------------
// Lowercase column names (Oracle returns UPPERCASE, SQL Server may vary)
// ---------------------------------------------------------------------------

function lowercaseKeys(rows) {
  return rows.map(row => {
    const lower = {};
    for (const [k, v] of Object.entries(row)) {
      lower[k.toLowerCase()] = v;
    }
    return lower;
  });
}

// ---------------------------------------------------------------------------
// Demo mode
// ---------------------------------------------------------------------------

if (FORCE_DEMO) {
  mode = 'demo';
  query = async () => [];
  pool = null;

// ---------------------------------------------------------------------------
// SQL Server mode (most SDWIS/STATE installations)
// ---------------------------------------------------------------------------

} else if (USE_MSSQL) {
  const sql = require('mssql');

  mode = 'mssql';

  const mssqlConfig = {
    server: process.env.MSSQL_SERVER,
    database: process.env.MSSQL_DATABASE || 'SDWIS_STATE',
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    port: parseInt(process.env.MSSQL_PORT || '1433'),
    options: {
      encrypt: process.env.MSSQL_ENCRYPT !== 'false',
      trustServerCertificate: process.env.MSSQL_TRUST_CERT === 'true',
    },
  };

  const poolReady = sql.connect(mssqlConfig).then(p => {
    pool = p;
    console.log('SQL Server connection pool created');
  }).catch(err => {
    console.error('SQL Server connection failed:', err.message);
    console.warn('Falling back to demo mode');
    mode = 'demo';
  });

  query = async function (text, params) {
    await poolReady;
    if (mode === 'demo') return [];

    const { sql: mssqlText, filteredParams } = translateToMssql(text, params ? [...params] : []);

    const request = pool.request();
    if (filteredParams) {
      filteredParams.forEach((val, i) => {
        request.input(`p${i + 1}`, val);
      });
    }

    const result = await request.query(mssqlText);
    return lowercaseKeys(result.recordset || []);
  };

// ---------------------------------------------------------------------------
// Oracle mode
// ---------------------------------------------------------------------------

} else if (USE_ORACLE) {
  const oracledb = require('oracledb');
  // Oracle 11g requires Thick mode (Instant Client)
  try {
    oracledb.initOracleClient();
  } catch (e) {
    if (!e.message.includes('already initialized')) throw e;
  }
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

  mode = 'oracle';
  pool = null;

  const poolConfig = {
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING,
    poolMin: 2,
    poolMax: 10,
    poolIncrement: 1,
  };

  const poolReady = oracledb.createPool(poolConfig).then(p => {
    pool = p;
    console.log('Oracle connection pool created');
  }).catch(err => {
    console.error('Oracle pool creation failed:', err.message);
    console.warn('Falling back to demo mode');
    mode = 'demo';
  });

  query = async function (text, params) {
    await poolReady;
    if (mode === 'demo') return [];

    const { sql: oraText, binds } = translateToOracle(text, params ? [...params] : []);

    let conn;
    try {
      conn = await pool.getConnection();
      const result = await conn.execute(oraText, binds);
      return lowercaseKeys(result.rows || []);
    } finally {
      if (conn) await conn.close();
    }
  };

// ---------------------------------------------------------------------------
// PostgreSQL mode (local dev)
// ---------------------------------------------------------------------------

} else {
  const { Pool } = require('pg');

  pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5435,
    database: process.env.DB_NAME || 'dws_prod',
    user: process.env.DB_USER || 'dba',
    password: process.env.DB_PASSWORD || '',
  });

  mode = 'postgresql';

  query = async function (text, params) {
    const result = await pool.query(text, params);
    return result.rows;
  };

  pool.query('SELECT 1').catch(() => {
    console.warn('PostgreSQL unreachable — switching to demo mode');
    mode = 'demo';
  });
}

module.exports = { get mode() { return mode; }, query, pool };
