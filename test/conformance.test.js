/**
 * Conformance tests — validate API responses against the original OpenAPI spec.
 *
 * Every field in an API response must exist in the original DW-SFTIES spec
 * with the correct type/structure. Extra fields not in the spec are violations.
 * Missing fields must be in the explicit exception list (conformance.json)
 * with a documented reason.
 *
 * Exception list lives in conformance.json — one entry per entity, with
 * field-level reasons. When a field is implemented, remove it from exceptions;
 * the test will then enforce its presence and type.
 *
 * If this test fails, the API does not conform to the SF specification.
 */

process.env.DEMO_MODE = 'true';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');

const express = require('express');
const db = require('../db');
const facilityRoutes = require('../routes/facility');
const waterSystemRoutes = require('../routes/water-system');

// ── Load config and spec ────────────────────────────────────────────────

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'conformance.json'), 'utf8')
);
const specPath = path.join(__dirname, config.specPath);
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const schemas = spec.components.schemas;

// ── Schema helpers ──────────────────────────────────────────────────────

function getExpectedFields(schemaName) {
  const schema = schemas[schemaName];
  if (!schema || !schema.properties) return {};

  const fields = {};
  for (const [name, prop] of Object.entries(schema.properties)) {
    if (prop.$ref) {
      fields[name] = `ref:${prop.$ref.split('/').pop()}`;
    } else if (prop.type === 'array') {
      const items = prop.items || {};
      const ref = items.$ref ? items.$ref.split('/').pop() : (items.type || 'unknown');
      fields[name] = `array:${ref}`;
    } else {
      fields[name] = prop.type || 'unknown';
    }
  }
  return fields;
}

function checkType(fieldName, value, expectedType) {
  if (value === null || value === undefined) return null;

  if (expectedType.startsWith('ref:')) {
    if (typeof value !== 'object' || Array.isArray(value))
      return `${fieldName}: expected object (${expectedType}), got ${typeof value}`;
    return null;
  }
  if (expectedType.startsWith('array:')) {
    if (!Array.isArray(value))
      return `${fieldName}: expected array (${expectedType}), got ${typeof value}`;
    return null;
  }

  const jsType = typeof value;
  switch (expectedType) {
    case 'string':
      if (jsType !== 'string') return `${fieldName}: expected string, got ${jsType}`;
      break;
    case 'integer':
    case 'number':
      if (jsType !== 'number') return `${fieldName}: expected ${expectedType}, got ${jsType}`;
      break;
    case 'boolean':
      if (jsType !== 'boolean') return `${fieldName}: expected boolean, got ${jsType}`;
      break;
    case 'object':
      if (jsType !== 'object' || Array.isArray(value))
        return `${fieldName}: expected object, got ${jsType}`;
      break;
  }
  return null;
}

function validate(responseObj, schemaName, exceptions) {
  const expected = getExpectedFields(schemaName);
  const expectedNames = new Set(Object.keys(expected));
  const exceptionSet = new Set(Object.keys(exceptions));
  const actualNames = new Set(Object.keys(responseObj));

  const extraFields = [];
  const missingFields = [];
  const typeViolations = [];

  for (const name of actualNames) {
    if (!expectedNames.has(name)) extraFields.push(name);
  }
  for (const name of expectedNames) {
    if (!actualNames.has(name) && !exceptionSet.has(name)) missingFields.push(name);
  }
  for (const name of actualNames) {
    if (expectedNames.has(name)) {
      const v = checkType(name, responseObj[name], expected[name]);
      if (v) typeViolations.push(v);
    }
  }

  return { extraFields, missingFields, typeViolations };
}

// ── HTTP test server ────────────────────────────────────────────────────

let server;
let baseUrl;

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${urlPath}`, (res) => {
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
  app.use('/inventory/water-system', waterSystemRoutes);

  return new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(() => new Promise((resolve) => server.close(resolve)));

// ── Generate tests from config ──────────────────────────────────────────

for (const entity of config.entities) {
  describe(`Spec Conformance: ${entity.dto}`, () => {

    it(`list response conforms to ${entity.dto}`, async () => {
      const { body } = await get(entity.listPath);
      const items = body[entity.listCollection];
      assert.ok(items && items.length > 0, `Need at least one ${entity.dto} in list`);

      const result = validate(items[0], entity.dto, entity.exceptions);

      if (result.extraFields.length)
        assert.fail(`EXTRA fields not in ${entity.dto} spec: ${result.extraFields.join(', ')}`);
      if (result.typeViolations.length)
        assert.fail(`TYPE violations: ${result.typeViolations.join('; ')}`);
      if (result.missingFields.length)
        assert.fail(`MISSING fields (add to exceptions or implement): ${result.missingFields.join(', ')}`);
    });

    it(`get-by-ID response conforms to ${entity.dto}`, async () => {
      const { body } = await get(entity.itemPath);
      const item = body[entity.itemKey];
      assert.ok(item, `Need a valid ${entity.dto} from ${entity.itemPath}`);

      const result = validate(item, entity.dto, entity.exceptions);

      if (result.extraFields.length)
        assert.fail(`EXTRA fields not in ${entity.dto} spec: ${result.extraFields.join(', ')}`);
      if (result.typeViolations.length)
        assert.fail(`TYPE violations: ${result.typeViolations.join('; ')}`);
      if (result.missingFields.length)
        assert.fail(`MISSING fields (add to exceptions or implement): ${result.missingFields.join(', ')}`);
    });
  });
}
