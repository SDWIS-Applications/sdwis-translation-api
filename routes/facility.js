/**
 * @openapi
 * components:
 *   schemas:
 *     DWPFacilityDTO:
 *       type: object
 *       properties:
 *         facilityId: { type: integer, description: "Internal facility sequence (tinwsf_is_number)" }
 *         fedFacilityId: { type: integer, description: "Federal facility ID" }
 *         dwpWaterSystem:
 *           type: object
 *           description: "Parent water system summary (DWPWaterSystemInfoDTO)"
 *           properties:
 *             waterSystemId: { type: string }
 *             name: { type: string }
 *         constructedDt: { type: string, format: date-time }
 *         paAssignedId: { type: string, description: "PA-assigned facility identifier" }
 *         name: { type: string }
 *         localName: { type: string }
 *         sellTreatmentType: { type: object, properties: { sellTreatmentTypeCode: { type: string } } }
 *         facilityType: { type: object, properties: { facilityTypeCode: { type: string } } }
 *         nonPipeType: { type: object, properties: { nonPipeTypeCode: { type: string } } }
 *         waterType: { type: object, properties: { facilityWaterTypeCode: { type: string } } }
 *         waterTypeDt: { type: string, format: date-time }
 *         facilityFiltration: { type: object, properties: { facilityFiltrationCode: { type: string } } }
 *         filtrationDt: { type: string, format: date-time }
 *         facilityAvailability: { type: object, properties: { facilityAvailabilityCode: { type: string } } }
 *         facilityStatus: { type: object, properties: { facilityStatusCode: { type: string } } }
 *         facilityStatusDt: { type: string, format: date-time }
 *         fedStatusCode: { type: string }
 *         facilityStatusReason: { type: object, properties: { facStatusReasonCode: { type: string } } }
 *         treatmentStatus: { type: object, properties: { treatmentStatusCode: { type: string } } }
 *         srcInd: { type: string }
 *         avgWaterQuantityPCT: { type: number }
 *         maintenanceDt: { type: string, format: date-time }
 *         swapStatus: { type: object, properties: { swapStatusCode: { type: string } } }
 *         swapStatusDt: { type: string, format: date-time }
 *         usgsHUC: { type: string }
 *         storetCode: { type: string }
 *         riverReachInd: { type: string }
 *         riverReachMiles: { type: number }
 *         waterBodyName: { type: string }
 *         paStatusNotes: { type: string }
 *         notes: { type: string }
 */

const { Router } = require('express');
const path = require('path');
const db = require('../db');

const router = Router();

// Demo data — loaded once on first request
let _demoData = null;
function getDemoData() {
  if (!_demoData) {
    _demoData = require(path.join(__dirname, '..', 'demo', 'facilities.json'));
  }
  return _demoData;
}

// In-memory filtering for demo mode
function filterDemo(data, query) {
  let results = [...data];

  if (query.waterSystemId) {
    const prefix = query.waterSystemId.toUpperCase();
    results = results.filter(f => f.dwpWaterSystem?.waterSystemId?.startsWith(prefix));
  }
  if (query.facilityId) {
    const id = Number(query.facilityId);
    results = results.filter(f => f.facilityId === id);
  }
  if (query.name) {
    const term = query.name.toLowerCase();
    results = results.filter(f => f.name?.toLowerCase().includes(term));
  }
  if (query.facilityTypeCode) {
    results = results.filter(f => f.facilityType?.facilityTypeCode === query.facilityTypeCode);
  }
  if (query.facilityStatusCode) {
    results = results.filter(f => f.facilityStatus?.facilityStatusCode === query.facilityStatusCode);
  }
  if (query.facilityAvailabilityCode) {
    results = results.filter(f => f.facilityAvailability?.facilityAvailabilityCode === query.facilityAvailabilityCode);
  }
  if (query.srcInd) {
    results = results.filter(f => f.srcInd?.toUpperCase() === query.srcInd.toUpperCase());
  }
  if (query.facilityWaterTypeCode) {
    results = results.filter(f => f.waterType?.facilityWaterTypeCode === query.facilityWaterTypeCode);
  }
  if (query.treatmentStatusCode) {
    results = results.filter(f => f.treatmentStatus?.treatmentStatusCode === query.treatmentStatusCode);
  }
  if (query.paAssignedId) {
    const prefix = query.paAssignedId.toUpperCase();
    results = results.filter(f => f.paAssignedId?.toUpperCase().startsWith(prefix));
  }
  if (query.fedFacilityId) {
    const id = Number(query.fedFacilityId);
    results = results.filter(f => f.fedFacilityId === id);
  }

  return results;
}

// In-memory sorting for demo mode
const DEMO_SORT_FIELDS = {
  facilityId: 'facilityId',
  name: 'name',
  fedFacilityId: 'fedFacilityId',
  paAssignedId: 'paAssignedId',
  srcInd: 'srcInd',
  facilityWaterTypeCode: f => f.waterType?.facilityWaterTypeCode,
  facilityStatusCode: f => f.facilityStatus?.facilityStatusCode,
  facilityAvailabilityCode: f => f.facilityAvailability?.facilityAvailabilityCode,
  treatmentStatusCode: f => f.treatmentStatus?.treatmentStatusCode,
  avgWaterQuantityPCT: 'avgWaterQuantityPCT',
  facilityTypeCode: f => f.facilityType?.facilityTypeCode,
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
const SCHEMA_PREFIX = process.env.SDWIS_SCHEMA ? `${process.env.SDWIS_SCHEMA}.` : '';
const ST_CODE = process.env.SDWIS_ST_CODE || 'MS';

// Column mapping: SS (tinwsf + tinwsys) → SF API field names
// Source: mapper.py analysis of DWP_FACILITY (38/43 matched)
// Join to tinwsys for dwpWaterSystem (DWPWaterSystemInfoDTO)
function mapRow(row) {
  return {
    facilityId: row.tinwsf_is_number,
    fedFacilityId: row.external_sys_num,
    dwpWaterSystem: {
      waterSystemId: row.ws_pwsid?.trim() || null,
      name: row.ws_name || null,
    },
    constructedDt: row.constructed_date,
    paAssignedId: row.st_asgn_ident_cd?.trim() || null,
    name: row.name,
    localName: row.local_name,
    sellTreatmentType: row.sell_treat_ind_cd ? { sellTreatmentTypeCode: row.sell_treat_ind_cd.trim() } : null,
    facilityType: row.type_code ? { facilityTypeCode: row.type_code.trim() } : null,
    nonPipeType: row.non_pipe_fac_tp_cd ? { nonPipeTypeCode: row.non_pipe_fac_tp_cd.trim() } : null,
    waterType: row.water_type_code ? { facilityWaterTypeCode: row.water_type_code.trim() } : null,
    waterTypeDt: row.water_type_code_dt,
    facilityFiltration: row.filtration_status ? { facilityFiltrationCode: row.filtration_status.trim() } : null,
    filtrationDt: row.filtration_stat_dt,
    facilityAvailability: row.availability_code ? { facilityAvailabilityCode: row.availability_code.trim() } : null,
    facilityStatus: row.activity_status_cd ? { facilityStatusCode: row.activity_status_cd.trim() } : null,
    facilityStatusDt: row.activity_date,
    fedStatusCode: row.activity_status_cd?.trim() || null,
    facilityStatusReason: row.activity_reason_cd ? { facStatusReasonCode: row.activity_reason_cd.trim() } : null,
    treatmentStatus: row.treatment_stat_cd ? { treatmentStatusCode: row.treatment_stat_cd.trim() } : null,
    srcInd: row.d_source_flag?.trim() || null,
    avgWaterQuantityPCT: row.avg_pct_water_qty != null ? Number(row.avg_pct_water_qty) : null,
    maintenanceDt: row.physical_modif_dt,
    swapStatus: row.swap_report_status ? { swapStatusCode: row.swap_report_status.trim() } : null,
    swapStatusDt: row.swap_rpt_status_dt,
    usgsHUC: row.usgs_hydro_unit_cd?.trim() || null,
    storetCode: row.storet_ext_hydro_u?.trim() || null,
    riverReachInd: row.on_rvr_rch_ind_cd?.trim() || null,
    riverReachMiles: row.rvr_rch_miles_qty != null ? Number(row.rvr_rch_miles_qty) : null,
    waterBodyName: row.wtr_body_nm_txt,
    paStatusNotes: row.activity_rsn_txt,
    notes: row.directions_text,
    lastReportedToFedDt: null, // SF-only, no SS equivalent
    createId: row.d_initial_userid?.trim() || null,
    removeId: null,            // SF-only, no SS equivalent
    updateId: row.d_userid_code?.trim() || null,
    createDt: row.d_initial_ts,
    removeDt: null,            // SF-only, no SS equivalent
    updateDt: row.d_last_updt_ts,
  };
}

// Valid sort columns: API field name → SS column expression
// Used for ORDER BY clause construction
const SORT_COLUMNS = {
  facilityId: 'f.tinwsf_is_number',
  name: 'f.name',
  fedFacilityId: 'f.external_sys_num',
  paAssignedId: 'f.st_asgn_ident_cd',
  srcInd: 'f.d_source_flag',
  facilityWaterTypeCode: 'f.water_type_code',
  facilityStatusCode: 'f.activity_status_cd',
  facilityAvailabilityCode: 'f.availability_code',
  treatmentStatusCode: 'f.treatment_stat_cd',
  avgWaterQuantityPCT: 'f.avg_pct_water_qty',
  facilityTypeCode: 'f.type_code',
};

/**
 * @openapi
 * /inventory/water-system/facility:
 *   get:
 *     summary: List facilities
 *     description: Returns a paginated list of facilities with optional filters and sorting.
 *     tags: [Facility]
 *     parameters:
 *       - in: query
 *         name: waterSystemId
 *         schema: { type: string }
 *         description: PWS ID starts-with filter (e.g., MS035)
 *       - in: query
 *         name: facilityId
 *         schema: { type: integer }
 *         description: Exact facility ID filter
 *       - in: query
 *         name: name
 *         schema: { type: string }
 *         description: Facility name contains filter (case-insensitive)
 *       - in: query
 *         name: facilityTypeCode
 *         schema: { type: string }
 *         description: "Facility type (WL=Well, TP=Treatment Plant, IN=Intake, ST=Storage, DS=Distribution)"
 *       - in: query
 *         name: facilityStatusCode
 *         schema: { type: string }
 *         description: "Facility status code (A=Active, I=Inactive)"
 *       - in: query
 *         name: facilityAvailabilityCode
 *         schema: { type: string }
 *         description: "Facility availability code (I=In Use, O=Not In Use)"
 *       - in: query
 *         name: srcInd
 *         schema: { type: string }
 *         description: "Source indicator (Y/N)"
 *       - in: query
 *         name: facilityWaterTypeCode
 *         schema: { type: string }
 *         description: "Water type (GW, SW, GWP, SWP)"
 *       - in: query
 *         name: treatmentStatusCode
 *         schema: { type: string }
 *         description: "Treatment status code"
 *       - in: query
 *         name: paAssignedId
 *         schema: { type: string }
 *         description: PA-assigned ID starts-with filter
 *       - in: query
 *         name: fedFacilityId
 *         schema: { type: integer }
 *         description: Exact federal facility ID filter
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
 *         description: "Comma-separated sort fields: facilityId, name, fedFacilityId, paAssignedId, srcInd, facilityWaterTypeCode, facilityStatusCode, facilityAvailabilityCode, treatmentStatusCode, avgWaterQuantityPCT, facilityTypeCode"
 *       - in: query
 *         name: sortOrders
 *         schema: { type: string }
 *         description: "Comma-separated ASC/DESC (must match sortColumns count)"
 *     responses:
 *       200:
 *         description: Paginated list of facilities
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
 *                 facilities:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/DWPFacilityDTO'
 */
router.get('/', async (req, res) => {
  try {
    const pageNumber = Math.max(0, parseInt(req.query.pageNumber) || 0);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 10));

    let totalCount, facilities;

    if (db.mode === 'demo') {
      let filtered = filterDemo(getDemoData(), req.query);
      filtered = sortDemo(filtered, req.query.sortColumns, req.query.sortOrders);
      totalCount = filtered.length;
      facilities = filtered.slice(pageNumber * pageSize, (pageNumber + 1) * pageSize);
    } else {
      // Join tinwsf → tinwsys to get waterSystemId (PWSID)
      const from = `${SCHEMA_PREFIX}tinwsf f
        JOIN ${SCHEMA_PREFIX}tinwsys ws
          ON f.tinwsys_is_number = ws.tinwsys_is_number
         AND f.tinwsys_st_code = ws.tinwsys_st_code`;

      const conditions = [`f.tinwsys_st_code = '${ST_CODE}'`];
      const params = [];
      let paramIdx = 1;

      if (req.query.waterSystemId) {
        conditions.push(`TRIM(ws.number0) LIKE $${paramIdx++}`);
        params.push(`${req.query.waterSystemId}%`);
      }
      if (req.query.facilityId) {
        conditions.push(`f.tinwsf_is_number = $${paramIdx++}`);
        params.push(Number(req.query.facilityId));
      }
      if (req.query.name) {
        conditions.push(`f.name ILIKE $${paramIdx++}`);
        params.push(`%${req.query.name}%`);
      }
      if (req.query.facilityTypeCode) {
        conditions.push(`TRIM(f.type_code) = $${paramIdx++}`);
        params.push(req.query.facilityTypeCode);
      }
      if (req.query.facilityStatusCode) {
        conditions.push(`TRIM(f.activity_status_cd) = $${paramIdx++}`);
        params.push(req.query.facilityStatusCode);
      }
      if (req.query.facilityAvailabilityCode) {
        conditions.push(`TRIM(f.availability_code) = $${paramIdx++}`);
        params.push(req.query.facilityAvailabilityCode);
      }
      if (req.query.srcInd) {
        conditions.push(`TRIM(f.d_source_flag) = $${paramIdx++}`);
        params.push(req.query.srcInd.toUpperCase());
      }
      if (req.query.facilityWaterTypeCode) {
        conditions.push(`TRIM(f.water_type_code) = $${paramIdx++}`);
        params.push(req.query.facilityWaterTypeCode);
      }
      if (req.query.treatmentStatusCode) {
        conditions.push(`TRIM(f.treatment_stat_cd) = $${paramIdx++}`);
        params.push(req.query.treatmentStatusCode);
      }
      if (req.query.paAssignedId) {
        conditions.push(`TRIM(f.st_asgn_ident_cd) LIKE $${paramIdx++}`);
        params.push(`${req.query.paAssignedId}%`);
      }
      if (req.query.fedFacilityId) {
        conditions.push(`f.external_sys_num = $${paramIdx++}`);
        params.push(Number(req.query.fedFacilityId));
      }

      let orderBy = 'f.name ASC';
      if (req.query.sortColumns) {
        const cols = req.query.sortColumns.split(',');
        const orders = (req.query.sortOrders || '').split(',');
        const parts = [];
        for (let i = 0; i < cols.length; i++) {
          const ssCol = SORT_COLUMNS[cols[i].trim()];
          if (ssCol) {
            const dir = (orders[i] || '').trim().toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
            parts.push(`${ssCol} ${dir}`);
          }
        }
        if (parts.length) orderBy = parts.join(', ');
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const countResult = await db.query(
        `SELECT COUNT(*) as total FROM ${from} ${where}`,
        params
      );
      totalCount = parseInt(countResult[0].total);

      const rows = await db.query(
        `SELECT f.*, TRIM(ws.number0) as ws_pwsid, ws.name as ws_name FROM ${from} ${where}
         ORDER BY ${orderBy}
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...params, pageSize, pageNumber * pageSize]
      );
      facilities = rows.map(mapRow);
    }

    res.json({
      error: null,
      resultSummary: {
        totalCount,
        pageNumber,
        pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
      },
      facilities,
    });
  } catch (err) {
    console.error('Error listing facilities:', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

/**
 * @openapi
 * /inventory/water-system/facility/{facilityId}:
 *   get:
 *     summary: Get a facility by ID
 *     description: Returns a single facility by its internal ID (tinwsf_is_number).
 *     tags: [Facility]
 *     parameters:
 *       - in: path
 *         name: facilityId
 *         required: true
 *         schema: { type: integer }
 *         description: Facility ID (internal sequence number)
 *     responses:
 *       200:
 *         description: Facility found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: object, nullable: true }
 *                 facility:
 *                   $ref: '#/components/schemas/DWPFacilityDTO'
 *       404:
 *         description: Facility not found
 */
router.get('/:facilityId', async (req, res) => {
  try {
    let facility;

    if (db.mode === 'demo') {
      const id = Number(req.params.facilityId);
      facility = getDemoData().find(f => f.facilityId === id) || null;
    } else {
      const rows = await db.query(
        `SELECT f.*, TRIM(ws.number0) as ws_pwsid, ws.name as ws_name
         FROM ${SCHEMA_PREFIX}tinwsf f
         JOIN ${SCHEMA_PREFIX}tinwsys ws
           ON f.tinwsys_is_number = ws.tinwsys_is_number
          AND f.tinwsys_st_code = ws.tinwsys_st_code
         WHERE f.tinwsf_is_number = $1 AND f.tinwsys_st_code = '${ST_CODE}'`,
        [Number(req.params.facilityId)]
      );
      facility = rows.length ? mapRow(rows[0]) : null;
    }

    if (!facility) {
      return res.status(404).json({
        error: { message: `Facility ${req.params.facilityId} not found` },
      });
    }

    res.json({ error: null, facility });
  } catch (err) {
    console.error('Error getting facility:', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

module.exports = router;
