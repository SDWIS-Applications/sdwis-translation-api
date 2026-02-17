/**
 * Integration tests for facility endpoints.
 *
 * Runs in demo mode (no database needed) against bundled synthetic data.
 * Demo data: 9 facilities across 4 water systems (XX0010001, XX0020002,
 * XX0030003, XX0050005). Types: WL, TP, ST, DS, IN.
 *
 * Usage:
 *   cd dw_sfties/api
 *   npm test
 */

process.env.DEMO_MODE = 'true';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const express = require('express');
const db = require('../db');
const facilityRoutes = require('../routes/facility');

let server;
let baseUrl;

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${path}`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${body}`));
        }
      });
    }).on('error', reject);
  });
}

before(() => {
  const app = express();
  app.use(express.json());
  app.use('/inventory/water-system/facility', facilityRoutes);

  return new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(() => {
  return new Promise((resolve) => {
    server.close(resolve);
  });
});

// ── List endpoint ──────────────────────────────────────────────────────

describe('GET /inventory/water-system/facility', () => {
  it('returns all 9 demo facilities by default', async () => {
    const { status, body } = await get('/inventory/water-system/facility');
    assert.equal(status, 200);
    assert.equal(body.error, null);
    assert.equal(body.resultSummary.totalCount, 9);
    assert.equal(body.facilities.length, 9);
  });

  it('paginates correctly', async () => {
    const { body } = await get('/inventory/water-system/facility?pageSize=3&pageNumber=0');
    assert.equal(body.facilities.length, 3);
    assert.equal(body.resultSummary.totalPages, 3);
    assert.equal(body.resultSummary.pageSize, 3);
  });

  it('returns last page with fewer results', async () => {
    const { body } = await get('/inventory/water-system/facility?pageSize=4&pageNumber=2');
    assert.equal(body.facilities.length, 1); // 9 total, page 2 of size 4 = 1 remaining
  });

  it('returns empty for page beyond range', async () => {
    const { body } = await get('/inventory/water-system/facility?pageSize=10&pageNumber=5');
    assert.equal(body.facilities.length, 0);
    assert.equal(body.resultSummary.totalCount, 9);
  });

  // ── Filters ──

  it('filters by waterSystemId prefix', async () => {
    const { body } = await get('/inventory/water-system/facility?waterSystemId=XX001');
    assert.equal(body.resultSummary.totalCount, 5); // XX0010001 has 5 facilities
    body.facilities.forEach(f => assert.ok(f.dwpWaterSystem.waterSystemId.startsWith('XX001')));
  });

  it('filters by facilityId', async () => {
    const { body } = await get('/inventory/water-system/facility?facilityId=37501');
    assert.equal(body.resultSummary.totalCount, 1);
    assert.equal(body.facilities[0].name, 'RIVERSIDE INTAKE');
  });

  it('filters by name (case-insensitive)', async () => {
    const { body } = await get('/inventory/water-system/facility?name=well');
    assert.ok(body.resultSummary.totalCount >= 4); // WL001, WL002, plus others
    body.facilities.forEach(f => assert.ok(f.name.toLowerCase().includes('well')));
  });

  it('filters by facilityTypeCode', async () => {
    const { body } = await get('/inventory/water-system/facility?facilityTypeCode=WL');
    body.facilities.forEach(f =>
      assert.equal(f.facilityType.facilityTypeCode, 'WL')
    );
    assert.ok(body.resultSummary.totalCount >= 4);
  });

  it('filters by facilityStatusCode', async () => {
    const { body } = await get('/inventory/water-system/facility?facilityStatusCode=I');
    body.facilities.forEach(f =>
      assert.equal(f.facilityStatus.facilityStatusCode, 'I')
    );
    assert.equal(body.resultSummary.totalCount, 1); // only the Cedar Grove well is inactive
  });

  it('filters by srcInd', async () => {
    const { body } = await get('/inventory/water-system/facility?srcInd=Y');
    body.facilities.forEach(f => assert.equal(f.srcInd, 'Y'));
    assert.ok(body.resultSummary.totalCount >= 4);
  });

  it('filters by facilityWaterTypeCode', async () => {
    const { body } = await get('/inventory/water-system/facility?facilityWaterTypeCode=SW');
    body.facilities.forEach(f =>
      assert.equal(f.waterType.facilityWaterTypeCode, 'SW')
    );
    assert.equal(body.resultSummary.totalCount, 2); // Riverside intake + TP
  });

  it('filters by treatmentStatusCode', async () => {
    const { body } = await get('/inventory/water-system/facility?treatmentStatusCode=C');
    body.facilities.forEach(f =>
      assert.equal(f.treatmentStatus.treatmentStatusCode, 'C')
    );
  });

  it('filters by paAssignedId prefix', async () => {
    const { body } = await get('/inventory/water-system/facility?paAssignedId=TF');
    body.facilities.forEach(f => assert.ok(f.paAssignedId.startsWith('TF')));
    assert.equal(body.resultSummary.totalCount, 2); // TF001 in two systems
  });

  it('combines multiple filters', async () => {
    const { body } = await get('/inventory/water-system/facility?waterSystemId=XX001&facilityTypeCode=WL');
    assert.equal(body.resultSummary.totalCount, 2); // WL001 and WL002 under XX0010001
    body.facilities.forEach(f => {
      assert.ok(f.dwpWaterSystem.waterSystemId.startsWith('XX001'));
      assert.equal(f.facilityType.facilityTypeCode, 'WL');
    });
  });

  // ── Sorting ──

  it('sorts by name ASC', async () => {
    const { body } = await get('/inventory/water-system/facility?sortColumns=name&sortOrders=ASC');
    const names = body.facilities.map(f => f.name);
    const sorted = [...names].sort();
    assert.deepEqual(names, sorted);
  });

  it('sorts by facilityId DESC', async () => {
    const { body } = await get('/inventory/water-system/facility?sortColumns=facilityId&sortOrders=DESC');
    const ids = body.facilities.map(f => f.facilityId);
    const sorted = [...ids].sort((a, b) => b - a);
    assert.deepEqual(ids, sorted);
  });

  // ── DTO shape ──

  it('returns correct DTO shape', async () => {
    const { body } = await get('/inventory/water-system/facility?facilityId=31001');
    const f = body.facilities[0];

    // Scalar fields
    assert.equal(typeof f.facilityId, 'number');
    assert.equal(typeof f.name, 'string');
    assert.equal(typeof f.paAssignedId, 'string');
    assert.equal(typeof f.dwpWaterSystem.waterSystemId, 'string');

    // Ref code objects
    assert.equal(typeof f.facilityType.facilityTypeCode, 'string');
    assert.equal(typeof f.facilityStatus.facilityStatusCode, 'string');

    // Nullable fields
    assert.ok('notes' in f);
    assert.ok('lastReportedToFedDt' in f);
    assert.ok('removeId' in f);
    assert.ok('removeDt' in f);
  });
});

// ── Get-by-ID endpoint ─────────────────────────────────────────────────

describe('GET /inventory/water-system/facility/:facilityId', () => {
  it('returns a facility by ID', async () => {
    const { status, body } = await get('/inventory/water-system/facility/31001');
    assert.equal(status, 200);
    assert.equal(body.error, null);
    assert.ok(body.facility);
    assert.equal(body.facility.facilityId, 31001);
  });

  it('returns the correct facility data', async () => {
    const { body } = await get('/inventory/water-system/facility/37501');
    const f = body.facility;
    assert.equal(f.name, 'RIVERSIDE INTAKE');
    assert.equal(f.dwpWaterSystem.waterSystemId, 'XX0020002');
    assert.equal(f.facilityType.facilityTypeCode, 'IN');
    assert.equal(f.srcInd, 'Y');
    assert.equal(f.waterBodyName, 'Pearl River');
  });

  it('populates dwpWaterSystem.name on get-by-ID', async () => {
    const { body } = await get('/inventory/water-system/facility/31001');
    assert.ok(body.facility.dwpWaterSystem.name, 'dwpWaterSystem.name must be populated');
  });

  it('returns 404 for nonexistent ID', async () => {
    const { status, body } = await get('/inventory/water-system/facility/99999');
    assert.equal(status, 404);
    assert.ok(body.error);
  });

  it('returns 404 for non-numeric ID', async () => {
    const { status, body } = await get('/inventory/water-system/facility/bogus');
    assert.equal(status, 404);
    assert.ok(body.error);
  });
});
