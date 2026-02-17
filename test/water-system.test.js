/**
 * Integration tests for water system endpoints.
 *
 * Runs in demo mode (no database needed) using supertest to exercise
 * the Express routes against bundled synthetic data.
 *
 * Usage:
 *   cd dw_sfties/api
 *   npm test
 */

// Force demo mode before any module loads
process.env.DEMO_MODE = 'true';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

// Load the Express app (but don't call .listen())
const express = require('express');
const db = require('../db');
const waterSystemRoutes = require('../routes/water-system');

let server;
let baseUrl;

// Helper: HTTP GET as promise returning parsed JSON
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
  app.use('/inventory/water-system', waterSystemRoutes);
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', datasource: db.mode });
  });

  return new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

after(() => {
  return new Promise((resolve) => {
    server.close(resolve);
  });
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  it('returns demo mode', async () => {
    const { status, body } = await get('/health');
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.datasource, 'demo');
  });
});

// ---------------------------------------------------------------------------
// List endpoint
// ---------------------------------------------------------------------------

describe('GET /inventory/water-system', () => {
  it('returns all 10 demo systems by default', async () => {
    const { status, body } = await get('/inventory/water-system');
    assert.equal(status, 200);
    assert.equal(body.error, null);
    assert.equal(body.resultSummary.totalCount, 10);
    assert.equal(body.resultSummary.pageNumber, 0);
    assert.equal(body.resultSummary.pageSize, 10);
    assert.equal(body.resultSummary.totalPages, 1);
    assert.equal(body.waterSystems.length, 10);
  });

  it('paginates correctly', async () => {
    const { body } = await get('/inventory/water-system?pageSize=3&pageNumber=0');
    assert.equal(body.waterSystems.length, 3);
    assert.equal(body.resultSummary.totalPages, 4); // ceil(10/3)

    const { body: page2 } = await get('/inventory/water-system?pageSize=3&pageNumber=1');
    assert.equal(page2.waterSystems.length, 3);
    // Pages should return different systems
    assert.notEqual(body.waterSystems[0].waterSystemId, page2.waterSystems[0].waterSystemId);
  });

  it('respects pageSize limit of 100', async () => {
    const { body } = await get('/inventory/water-system?pageSize=999');
    assert.equal(body.resultSummary.pageSize, 100);
  });

  it('handles last page with fewer results', async () => {
    const { body } = await get('/inventory/water-system?pageSize=4&pageNumber=2');
    assert.equal(body.waterSystems.length, 2); // 10 - 4*2 = 2 remaining
  });

  it('returns empty for page beyond range', async () => {
    const { body } = await get('/inventory/water-system?pageNumber=100');
    assert.equal(body.waterSystems.length, 0);
    assert.equal(body.resultSummary.totalCount, 10);
  });

  // --- Filters ---

  it('filters by waterSystemId prefix', async () => {
    const { body } = await get('/inventory/water-system?waterSystemId=XX001');
    assert.ok(body.resultSummary.totalCount > 0);
    for (const ws of body.waterSystems) {
      assert.ok(ws.waterSystemId.startsWith('XX001'));
    }
  });

  it('filters by name (case-insensitive contains)', async () => {
    const { body } = await get('/inventory/water-system?name=spring');
    assert.ok(body.resultSummary.totalCount > 0);
    for (const ws of body.waterSystems) {
      assert.ok(ws.name.toLowerCase().includes('spring'));
    }
  });

  it('filters by wsStatusCode', async () => {
    const { body } = await get('/inventory/water-system?wsStatusCode=A');
    assert.ok(body.resultSummary.totalCount > 0);
    for (const ws of body.waterSystems) {
      assert.equal(ws.waterSystemStatus.wsStatusCode, 'A');
    }
  });

  it('filters by inactive status', async () => {
    const { body } = await get('/inventory/water-system?wsStatusCode=I');
    assert.ok(body.resultSummary.totalCount > 0);
    for (const ws of body.waterSystems) {
      assert.equal(ws.waterSystemStatus.wsStatusCode, 'I');
    }
  });

  it('filters by fedWSSourceCode', async () => {
    const { body } = await get('/inventory/water-system?fedWSSourceCode=GW');
    assert.ok(body.resultSummary.totalCount > 0);
    for (const ws of body.waterSystems) {
      assert.equal(ws.fedWaterSystemSourceType.wsSourceCode, 'GW');
    }
  });

  it('filters by fedWSTypeCode', async () => {
    const { body } = await get('/inventory/water-system?fedWSTypeCode=C');
    assert.ok(body.resultSummary.totalCount > 0);
    for (const ws of body.waterSystems) {
      assert.equal(ws.fedWaterSystemType.wsTypeCode, 'C');
    }
  });

  it('filters by wsOwnerTypeCode', async () => {
    const { body } = await get('/inventory/water-system?wsOwnerTypeCode=L');
    assert.ok(body.resultSummary.totalCount > 0);
    for (const ws of body.waterSystems) {
      assert.equal(ws.ownerType.wsOwnerTypeCode, 'L');
    }
  });

  it('filters by population range', async () => {
    const { body } = await get('/inventory/water-system?fedPopulationFrom=1000&fedPopulationTo=10000');
    assert.ok(body.resultSummary.totalCount > 0);
    for (const ws of body.waterSystems) {
      assert.ok(ws.fedPopulation >= 1000, `${ws.name} pop ${ws.fedPopulation} < 1000`);
      assert.ok(ws.fedPopulation <= 10000, `${ws.name} pop ${ws.fedPopulation} > 10000`);
    }
  });

  it('filters by minimum population only', async () => {
    const { body } = await get('/inventory/water-system?fedPopulationFrom=50000');
    assert.ok(body.resultSummary.totalCount > 0);
    for (const ws of body.waterSystems) {
      assert.ok(ws.fedPopulation >= 50000);
    }
  });

  it('combines multiple filters', async () => {
    const { body } = await get('/inventory/water-system?wsStatusCode=A&fedWSSourceCode=GW&fedWSTypeCode=C');
    for (const ws of body.waterSystems) {
      assert.equal(ws.waterSystemStatus.wsStatusCode, 'A');
      assert.equal(ws.fedWaterSystemSourceType.wsSourceCode, 'GW');
      assert.equal(ws.fedWaterSystemType.wsTypeCode, 'C');
    }
  });

  it('returns empty for impossible filter combo', async () => {
    const { body } = await get('/inventory/water-system?wsStatusCode=Z');
    assert.equal(body.resultSummary.totalCount, 0);
    assert.equal(body.waterSystems.length, 0);
  });

  // --- Sorting ---

  it('sorts by name ASC', async () => {
    const { body } = await get('/inventory/water-system?sortColumns=name&sortOrders=ASC');
    const names = body.waterSystems.map(ws => ws.name);
    for (let i = 1; i < names.length; i++) {
      assert.ok(names[i] >= names[i - 1], `${names[i]} should be >= ${names[i - 1]}`);
    }
  });

  it('sorts by fedPopulation DESC', async () => {
    const { body } = await get('/inventory/water-system?sortColumns=fedPopulation&sortOrders=DESC');
    const pops = body.waterSystems.map(ws => ws.fedPopulation);
    for (let i = 1; i < pops.length; i++) {
      assert.ok(pops[i] <= pops[i - 1], `pop ${pops[i]} should be <= ${pops[i - 1]}`);
    }
  });

  it('sorts by waterSystemId ASC', async () => {
    const { body } = await get('/inventory/water-system?sortColumns=waterSystemId&sortOrders=ASC');
    const ids = body.waterSystems.map(ws => ws.waterSystemId);
    for (let i = 1; i < ids.length; i++) {
      assert.ok(ids[i] >= ids[i - 1]);
    }
  });

  // --- DTO shape ---

  it('returns correct DTO shape', async () => {
    const { body } = await get('/inventory/water-system?pageSize=1');
    const ws = body.waterSystems[0];

    // Required scalar fields
    assert.ok('waterSystemId' in ws);
    assert.ok('name' in ws);
    assert.ok('fedPopulation' in ws);
    assert.ok('createDt' in ws);
    assert.ok('updateDt' in ws);

    // Reference code objects
    assert.ok(ws.ownerType === null || 'wsOwnerTypeCode' in ws.ownerType);
    assert.ok(ws.waterSystemStatus === null || 'wsStatusCode' in ws.waterSystemStatus);
    assert.ok(ws.fedWaterSystemType === null || 'wsTypeCode' in ws.fedWaterSystemType);
    assert.ok(ws.fedWaterSystemSourceType === null || 'wsSourceCode' in ws.fedWaterSystemSourceType);

    // Water source percentages
    for (const pct of ['swPCT', 'gwPCT', 'swPurchasePCT', 'gwPurchasePCT', 'gwUDIPCT', 'gwUDIPurchasePCT']) {
      assert.ok(pct in ws, `Missing field: ${pct}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Get by ID endpoint
// ---------------------------------------------------------------------------

describe('GET /inventory/water-system/:waterSystemId', () => {
  it('returns a system by ID', async () => {
    // First get a valid ID from the list
    const { body: list } = await get('/inventory/water-system?pageSize=1');
    const id = list.waterSystems[0].waterSystemId;

    const { status, body } = await get(`/inventory/water-system/${id}`);
    assert.equal(status, 200);
    assert.equal(body.error, null);
    assert.equal(body.waterSystem.waterSystemId, id);
  });

  it('returns the correct system data', async () => {
    const { status, body } = await get('/inventory/water-system/XX0010001');
    assert.equal(status, 200);
    assert.equal(body.waterSystem.waterSystemId, 'XX0010001');
    assert.ok(body.waterSystem.name);
    assert.ok(body.waterSystem.fedPopulation > 0);
  });

  it('returns 404 for nonexistent ID', async () => {
    const { status, body } = await get('/inventory/water-system/DOESNOTEXIST');
    assert.equal(status, 404);
    assert.ok(body.error);
    assert.ok(body.error.message.includes('DOESNOTEXIST'));
  });

  it('returns 404 for empty string ID', async () => {
    // Express will match the list route for empty path, so test a clearly wrong ID
    const { status } = await get('/inventory/water-system/XX9999999');
    assert.equal(status, 404);
  });
});
