/**
 * @openapi
 * components:
 *   schemas:
 *     RefCodeDTO:
 *       type: object
 *       properties:
 *         wsOwnerTypeCode: { type: string }
 *         wsTypeCode: { type: string }
 *         wsSourceCode: { type: string }
 *         wsStatusCode: { type: string }
 *         reasonCode: { type: string }
 *     DWPWaterSystemDTO:
 *       type: object
 *       properties:
 *         waterSystemId: { type: string, description: "PWS ID (e.g., MS0250008)" }
 *         name: { type: string, description: "Official water system name" }
 *         localName: { type: string, description: "Common/local name" }
 *         altPANumber: { type: string, description: "Primacy agency alternate number" }
 *         swPCT: { type: number, description: "Surface water %" }
 *         swPurchasePCT: { type: number, description: "Purchased surface water %" }
 *         gwPCT: { type: number, description: "Ground water %" }
 *         gwPurchasePCT: { type: number, description: "Purchased ground water %" }
 *         gwUDIPCT: { type: number, description: "GW under direct influence %" }
 *         gwUDIPurchasePCT: { type: number, description: "Purchased GW UDI %" }
 *         fedPopulation: { type: integer, description: "Federal population served" }
 *         grandTotalPopulation: { type: integer, description: "Grand total population" }
 *         daysServingCount: { type: integer, description: "Days per year serving 25+ persons" }
 *         ownerType: { $ref: '#/components/schemas/RefCodeDTO' }
 *         waterSystemType: { $ref: '#/components/schemas/RefCodeDTO' }
 *         waterSystemSourceType: { $ref: '#/components/schemas/RefCodeDTO' }
 *         fedWaterSystemType: { $ref: '#/components/schemas/RefCodeDTO' }
 *         fedWaterSystemSourceType: { $ref: '#/components/schemas/RefCodeDTO' }
 *         waterSystemStatus: { $ref: '#/components/schemas/RefCodeDTO' }
 *         waterSystemStatusDt: { type: string, format: date-time }
 *         waterSystemStatusReason: { $ref: '#/components/schemas/RefCodeDTO' }
 *         paStatusNotes: { type: string }
 *         notes: { type: string }
 *         seasonalInd: { type: string, nullable: true }
 *         wholeSalerInd: { type: string, nullable: true }
 *         createLanId: { type: string }
 *         updateLanId: { type: string }
 *         createDt: { type: string, format: date-time }
 *         updateDt: { type: string, format: date-time }
 */

const { Router } = require('express');
const path = require('path');
const db = require('../db');

const router = Router();

// Demo data — loaded once on first request when in demo mode
let _demoData = null;
function getDemoData() {
  if (!_demoData) {
    _demoData = require(path.join(__dirname, '..', 'demo', 'water-systems.json'));
  }
  return _demoData;
}

// In-memory filtering for demo mode
function filterDemo(data, query) {
  let results = [...data];

  if (query.waterSystemId) {
    const prefix = query.waterSystemId.toUpperCase();
    results = results.filter(ws => ws.waterSystemId?.startsWith(prefix));
  }
  if (query.name) {
    const term = query.name.toLowerCase();
    results = results.filter(ws => ws.name?.toLowerCase().includes(term));
  }
  if (query.wsStatusCode) {
    results = results.filter(ws => ws.waterSystemStatus?.wsStatusCode === query.wsStatusCode);
  }
  if (query.fedWSSourceCode) {
    results = results.filter(ws => ws.fedWaterSystemSourceType?.wsSourceCode === query.fedWSSourceCode);
  }
  if (query.fedWSTypeCode) {
    results = results.filter(ws => ws.fedWaterSystemType?.wsTypeCode === query.fedWSTypeCode);
  }
  if (query.wsOwnerTypeCode) {
    results = results.filter(ws => ws.ownerType?.wsOwnerTypeCode === query.wsOwnerTypeCode);
  }
  if (query.fedPopulationFrom) {
    const min = Number(query.fedPopulationFrom);
    results = results.filter(ws => ws.fedPopulation >= min);
  }
  if (query.fedPopulationTo) {
    const max = Number(query.fedPopulationTo);
    results = results.filter(ws => ws.fedPopulation <= max);
  }

  return results;
}

// In-memory sorting for demo mode
const DEMO_SORT_FIELDS = {
  name: 'name',
  waterSystemId: 'waterSystemId',
  wsStatusCode: ws => ws.waterSystemStatus?.wsStatusCode,
  fedWSTypeCode: ws => ws.fedWaterSystemType?.wsTypeCode,
  fedWSSourceCode: ws => ws.fedWaterSystemSourceType?.wsSourceCode,
  fedPopulation: 'fedPopulation',
  wsOwnerTypeCode: ws => ws.ownerType?.wsOwnerTypeCode,
  localName: 'localName',
  createDt: 'createDt',
};

function sortDemo(data, sortColumns, sortOrders) {
  if (!sortColumns) return data;
  const cols = sortColumns.split(',').map(s => s.trim());
  const orders = (sortOrders || '').split(',').map(s => s.trim().toUpperCase());

  return data.sort((a, b) => {
    for (let i = 0; i < cols.length; i++) {
      const field = DEMO_SORT_FIELDS[cols[i]];
      if (!field) continue;
      const dir = orders[i] === 'DESC' ? -1 : 1;
      const valA = typeof field === 'function' ? field(a) : a[field];
      const valB = typeof field === 'function' ? field(b) : b[field];
      if (valA == null && valB == null) continue;
      if (valA == null) return dir;
      if (valB == null) return -dir;
      if (valA < valB) return -dir;
      if (valA > valB) return dir;
    }
    return 0;
  });
}

// SDWIS/STATE schema — configurable per installation
// Default 'dbo' works for SQL Server; Oracle/PostgreSQL installations may use 'msr30' or other.
// SDWIS/STATE schema prefix — most installations use default namespace (no prefix).
// Set SDWIS_SCHEMA to 'msr30' or 'dbo' if your tables are in a named schema.
const SCHEMA_PREFIX = process.env.SDWIS_SCHEMA ? `${process.env.SDWIS_SCHEMA}.` : '';
const ST_CODE = process.env.SDWIS_ST_CODE || 'MS';

// Column mapping: SS (tinwsys) → SF API field names
// Source: mapper.py analysis of DWP_WATER_SYSTEM
function mapRow(row) {
  return {
    waterSystemId: row.number0?.trim() || null,
    name: row.name,
    localName: row.local_name,
    altPANumber: row.alternate_st_num,
    swPCT: row.surf_wtr_ratio != null ? Number(row.surf_wtr_ratio) : null,
    swPurchasePCT: row.surf_wtr_pur_ratio != null ? Number(row.surf_wtr_pur_ratio) : null,
    gwPCT: row.grnd_wtr_ratio != null ? Number(row.grnd_wtr_ratio) : null,
    gwPurchasePCT: row.grnd_wtr_pur_ratio != null ? Number(row.grnd_wtr_pur_ratio) : null,
    gwUDIPCT: row.grnd_wtr_udi_ratio != null ? Number(row.grnd_wtr_udi_ratio) : null,
    gwUDIPurchasePCT: row.grnd_wtr_udi_purch != null ? Number(row.grnd_wtr_udi_purch) : null,
    fedPopulation: row.d_population_count,
    grandTotalPopulation: row.d_population_count, // same value in SS
    daysServingCount: row.days_serving_count,
    ownerType: row.owner_type_code ? { wsOwnerTypeCode: row.owner_type_code?.trim() } : null,
    waterSystemType: row.pws_st_type_cd ? { wsTypeCode: row.pws_st_type_cd?.trim() } : null,
    waterSystemSourceType: row.d_st_prim_src_cd ? { wsSourceCode: row.d_st_prim_src_cd?.trim() } : null,
    fedWaterSystemType: row.d_pws_fed_type_cd ? { wsTypeCode: row.d_pws_fed_type_cd?.trim() } : null,
    fedWaterSystemSourceType: row.d_fed_prim_src_cd ? { wsSourceCode: row.d_fed_prim_src_cd?.trim() } : null,
    waterSystemStatus: row.activity_status_cd ? { wsStatusCode: row.activity_status_cd?.trim() } : null,
    waterSystemStatusDt: row.activity_date,
    waterSystemStatusReason: row.activity_reason_cd ? { reasonCode: row.activity_reason_cd?.trim() } : null,
    paStatusNotes: row.activity_rsn_txt,
    notes: row.memo_text,
    seasonalInd: null,       // SF-only, no SS equivalent
    wholeSalerInd: null,     // SF-only, no SS equivalent
    createLanId: row.d_initial_userid?.trim() || null,
    updateLanId: row.d_userid_code?.trim() || null,
    createDt: row.d_initial_ts,
    updateDt: row.d_last_updt_ts,
  };
}

// Valid sort columns: API field name → SS column name
const SORT_COLUMNS = {
  name: 'name',
  waterSystemId: 'number0',
  wsStatusCode: 'activity_status_cd',
  fedWSTypeCode: 'd_pws_fed_type_cd',
  fedWSSourceCode: 'd_fed_prim_src_cd',
  fedPopulation: 'd_population_count',
  seasonalInd: null, // not sortable in SS
  wsOwnerTypeCode: 'owner_type_code',
  localName: 'local_name',
  createDt: 'd_initial_ts',
};

/**
 * @openapi
 * /inventory/water-system:
 *   get:
 *     summary: List water systems
 *     description: Returns a paginated list of water systems with optional filters and sorting.
 *     tags: [Water System]
 *     parameters:
 *       - in: query
 *         name: waterSystemId
 *         schema: { type: string }
 *         description: PWS ID starts-with filter (e.g., MS035)
 *       - in: query
 *         name: name
 *         schema: { type: string }
 *         description: Water system name contains filter (case-insensitive)
 *       - in: query
 *         name: wsStatusCode
 *         schema: { type: string }
 *         description: "Exact status code (A=Active, I=Inactive)"
 *       - in: query
 *         name: fedWSSourceCode
 *         schema: { type: string }
 *         description: "Federal water source (GW, SW, GWP, SWP)"
 *       - in: query
 *         name: fedWSTypeCode
 *         schema: { type: string }
 *         description: "Federal system type (C, NC, NTNC, NP)"
 *       - in: query
 *         name: wsOwnerTypeCode
 *         schema: { type: string }
 *         description: "Owner type code (F=Federal, L=Local, P=Private, S=State)"
 *       - in: query
 *         name: fedPopulationFrom
 *         schema: { type: integer }
 *         description: Minimum population (inclusive)
 *       - in: query
 *         name: fedPopulationTo
 *         schema: { type: integer }
 *         description: Maximum population (inclusive)
 *       - in: query
 *         name: pageNumber
 *         schema: { type: integer, default: 0 }
 *         description: Page number (0-indexed)
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 10, maximum: 100 }
 *         description: Results per page
 *       - in: query
 *         name: sortColumns
 *         schema: { type: string }
 *         description: "Comma-separated sort fields: name, waterSystemId, wsStatusCode, fedWSTypeCode, fedWSSourceCode, fedPopulation, wsOwnerTypeCode, localName, createDt"
 *       - in: query
 *         name: sortOrders
 *         schema: { type: string }
 *         description: "Comma-separated ASC/DESC (must match sortColumns count)"
 *     responses:
 *       200:
 *         description: Paginated list of water systems
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: object, nullable: true }
 *                 resultSummary:
 *                   type: object
 *                   properties:
 *                     totalCount: { type: integer }
 *                     pageNumber: { type: integer }
 *                     pageSize: { type: integer }
 *                     totalPages: { type: integer }
 *                 waterSystems:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/DWPWaterSystemDTO'
 */
router.get('/', async (req, res) => {
  try {
    const pageNumber = Math.max(0, parseInt(req.query.pageNumber) || 0);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 10));

    let totalCount, waterSystems;

    if (db.mode === 'demo') {
      // Demo: in-memory filter/sort/paginate
      let filtered = filterDemo(getDemoData(), req.query);
      filtered = sortDemo(filtered, req.query.sortColumns, req.query.sortOrders);
      totalCount = filtered.length;
      waterSystems = filtered.slice(pageNumber * pageSize, (pageNumber + 1) * pageSize);
    } else {
      // Database: SQL query
      const conditions = [`ws.tinwsys_st_code = '${ST_CODE}'`];
      const params = [];
      let paramIdx = 1;

      if (req.query.waterSystemId) {
        conditions.push(`TRIM(ws.number0) LIKE $${paramIdx++}`);
        params.push(`${req.query.waterSystemId}%`);
      }
      if (req.query.name) {
        conditions.push(`ws.name ILIKE $${paramIdx++}`);
        params.push(`%${req.query.name}%`);
      }
      if (req.query.wsStatusCode) {
        conditions.push(`ws.activity_status_cd = $${paramIdx++}`);
        params.push(req.query.wsStatusCode);
      }
      if (req.query.fedWSSourceCode) {
        conditions.push(`TRIM(ws.d_fed_prim_src_cd) = $${paramIdx++}`);
        params.push(req.query.fedWSSourceCode);
      }
      if (req.query.fedWSTypeCode) {
        conditions.push(`TRIM(ws.d_pws_fed_type_cd) = $${paramIdx++}`);
        params.push(req.query.fedWSTypeCode);
      }
      if (req.query.wsOwnerTypeCode) {
        conditions.push(`TRIM(ws.owner_type_code) = $${paramIdx++}`);
        params.push(req.query.wsOwnerTypeCode);
      }
      if (req.query.fedPopulationFrom) {
        conditions.push(`ws.d_population_count >= $${paramIdx++}`);
        params.push(Number(req.query.fedPopulationFrom));
      }
      if (req.query.fedPopulationTo) {
        conditions.push(`ws.d_population_count <= $${paramIdx++}`);
        params.push(Number(req.query.fedPopulationTo));
      }

      let orderBy = 'ws.name ASC';
      if (req.query.sortColumns) {
        const cols = req.query.sortColumns.split(',');
        const orders = (req.query.sortOrders || '').split(',');
        const parts = [];
        for (let i = 0; i < cols.length; i++) {
          const ssCol = SORT_COLUMNS[cols[i].trim()];
          if (ssCol) {
            const dir = (orders[i] || '').trim().toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
            parts.push(`ws.${ssCol} ${dir}`);
          }
        }
        if (parts.length) orderBy = parts.join(', ');
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const countResult = await db.query(
        `SELECT COUNT(*) as total FROM ${SCHEMA_PREFIX}tinwsys ws ${where}`,
        params
      );
      totalCount = parseInt(countResult[0].total);

      const rows = await db.query(
        `SELECT * FROM ${SCHEMA_PREFIX}tinwsys ws ${where}
         ORDER BY ${orderBy}
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...params, pageSize, pageNumber * pageSize]
      );
      waterSystems = rows.map(mapRow);
    }

    res.json({
      error: null,
      resultSummary: {
        totalCount,
        pageNumber,
        pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
      },
      waterSystems,
    });
  } catch (err) {
    console.error('Error listing water systems:', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

/**
 * @openapi
 * /inventory/water-system/{waterSystemId}:
 *   get:
 *     summary: Get a water system by ID
 *     description: Returns a single water system by its PWS ID.
 *     tags: [Water System]
 *     parameters:
 *       - in: path
 *         name: waterSystemId
 *         required: true
 *         schema: { type: string }
 *         description: PWS ID (e.g., MS0250008)
 *     responses:
 *       200:
 *         description: Water system found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: object, nullable: true }
 *                 waterSystem:
 *                   $ref: '#/components/schemas/DWPWaterSystemDTO'
 *       404:
 *         description: Water system not found
 */
router.get('/:waterSystemId', async (req, res) => {
  try {
    let waterSystem;

    if (db.mode === 'demo') {
      waterSystem = getDemoData().find(ws => ws.waterSystemId === req.params.waterSystemId) || null;
    } else {
      const rows = await db.query(
        `SELECT * FROM ${SCHEMA_PREFIX}tinwsys ws
         WHERE TRIM(ws.number0) = $1 AND ws.tinwsys_st_code = '${ST_CODE}'`,
        [req.params.waterSystemId]
      );
      waterSystem = rows.length ? mapRow(rows[0]) : null;
    }

    if (!waterSystem) {
      return res.status(404).json({
        error: { message: `Water system ${req.params.waterSystemId} not found` },
      });
    }

    res.json({ error: null, waterSystem });
  } catch (err) {
    console.error('Error getting water system:', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

module.exports = router;
