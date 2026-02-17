# SDWIS Translation API

A read-only REST API that exposes [DW-SFTIES](https://www.epa.gov/sdwis/dw-sfties)-compatible endpoints backed by an existing SDWIS/STATE database. The purpose is to allow states to begin migrating custom applications, reports, and integrations to the new DW-SFTIES API contract in preparation for the federal transition, without waiting for DW-SFTIES to go live or changing the underlying database.

The API reads from SDWIS/STATE tables (SQL Server, Oracle, or PostgreSQL replicas) and translates the data into DW-SFTIES response DTOs. Once DW-SFTIES is available, applications written against this API can be pointed at the real endpoints with minimal changes.

A demo mode with bundled synthetic data is included so the API can be evaluated without a database connection.

## Try It Now

You can run the API with demo data directly in your browser using GitHub Codespaces — no local install required.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/SDWIS-Applications/sdwis-translation-api?quickstart=1)

1. Click the button above and wait for the Codespace to finish building (about a minute).
2. The API server starts automatically. When port 3000 appears in the **Ports** tab, click the globe icon — it opens directly to the interactive Swagger documentation. (If your browser blocks the pop-up, allow pop-ups for `github.dev` and click again.)
3. Try some requests from the Swagger UI:
   - `GET /inventory/water-system` — returns 10 demo water systems
   - `GET /inventory/water-system/XX0010001` — a single water system by PWSID
   - `GET /inventory/water-system/facility` — returns 9 demo facilities
   - `GET /inventory/water-system/facility?facilityTypeCode=WL` — filter to wells only
   - `GET /health` — shows `{"status":"ok","datasource":"demo"}`
5. To run the test suite, open the terminal in the Codespace and run `npm test`.

## Quick Start (Local)

```bash
git clone https://github.com/SDWIS-Applications/sdwis-translation-api.git
cd sdwis-translation-api
npm install
DEMO_MODE=true npm start
```

Then open http://localhost:3000/api-docs for interactive Swagger documentation.

## Connecting to Your Database

Copy the example config and edit it:

```bash
cp .env.example .env
```

### SQL Server (most SDWIS/STATE installations)

```env
SDWIS_ST_CODE=MS
MSSQL_SERVER=your-server
MSSQL_DATABASE=SDWIS_STATE
MSSQL_USER=your-username
MSSQL_PASSWORD=your-password
```

### Oracle

```env
SDWIS_ST_CODE=MS
ORACLE_USER=your-username
ORACLE_PASSWORD=your-password
ORACLE_CONNECT_STRING=(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=your-host)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=PROD)))
```

### Common Options

| Variable | Default | Description |
|----------|---------|-------------|
| `SDWIS_ST_CODE` | `MS` | Your two-letter state code |
| `SDWIS_SCHEMA` | *(none)* | Schema prefix if tables are in a named schema (e.g., `msr30`, `dbo`) |
| `PORT` | `3000` | HTTP port |
| `DEMO_MODE` | *(unset)* | Set to `true` to use bundled synthetic data |

## Implemented Endpoints

### Water System
| Method | Path | Description |
|--------|------|-------------|
| GET | `/inventory/water-system` | List water systems with filters, pagination, sorting |
| GET | `/inventory/water-system/:waterSystemId` | Get a single water system by PWSID |

**Filters:** waterSystemId, name, wsStatusCode, fedWSSourceCode, fedWSTypeCode, wsOwnerTypeCode, fedPopulationFrom, fedPopulationTo

### Facility
| Method | Path | Description |
|--------|------|-------------|
| GET | `/inventory/water-system/facility` | List facilities with filters, pagination, sorting |
| GET | `/inventory/water-system/facility/:facilityId` | Get a single facility by ID |

**Filters:** waterSystemId, facilityId, name, facilityTypeCode, facilityStatusCode, facilityAvailabilityCode, srcInd, facilityWaterTypeCode, treatmentStatusCode, paAssignedId, fedFacilityId

### Common Parameters

All list endpoints support:
- **Pagination:** `pageNumber` (0-indexed, default 0), `pageSize` (default 10, max 100)
- **Sorting:** `sortColumns` (comma-separated), `sortOrders` (ASC/DESC, comma-separated)

## Response Format

Responses follow the DW-SFTIES envelope format:

```json
{
  "error": null,
  "resultSummary": {
    "totalCount": 1190,
    "pageNumber": 0,
    "pageSize": 10,
    "totalPages": 119
  },
  "waterSystems": [...]
}
```

## Testing

```bash
npm test
```

Tests run in demo mode against bundled synthetic data — no database required. The test suite includes:

- **Unit tests** for each endpoint (filters, pagination, sorting, DTO shape, error cases)
- **Spec conformance tests** that validate API responses against the original DW-SFTIES OpenAPI specification, catching extra fields, missing fields, and type mismatches

## Architecture

```
server.js          Express app, Swagger UI at /api-docs
db.js              Multi-database adapter (SQL Server, Oracle, PostgreSQL, demo)
routes/            One file per entity, writes PostgreSQL SQL
demo/              Synthetic JSON data for demo mode
specs/             Original DW-SFTIES OpenAPI specs (used by conformance tests)
test/              Node built-in test runner (node:test)
```

Routes write standard PostgreSQL-style SQL. The database adapter (`db.js`) automatically translates parameter syntax, case-insensitive matching, and pagination to the target dialect:

| Feature | PostgreSQL | Oracle 11g | SQL Server |
|---------|-----------|------------|------------|
| Parameters | `$1, $2` | `:1, :2` | `@p1, @p2` |
| Case-insensitive | `ILIKE` | `UPPER() LIKE UPPER()` | `LIKE` (CI collation) |
| Pagination | `LIMIT/OFFSET` | `ROWNUM` wrapping | `OFFSET FETCH` |

## Spec Conformance

Every API response is validated against the original DW-SFTIES OpenAPI specification at test time. Fields not in the spec cause test failures. Fields that cannot be populated from SDWIS/STATE data are documented as explicit exceptions in `test/conformance.json` with reasons.

This ensures the translation API stays faithful to the federal specification as new entities are added.

## Documentation Sources

This project is built from two publicly available EPA resources:

**OpenAPI Specifications** — Downloaded from the DW-SFTIES UAT Swagger documentation. Each service publishes its own spec:

| Service | Spec URL |
|---------|----------|
| Inventory | `https://inventory.dwsfties-uat-api.epa.gov/api-docs/api-docs.json` |
| Legal Entity | `https://legalentity.dwsfties-uat-api.epa.gov/api-docs/api-docs.json` |
| Sampling | `https://sampling.dwsfties-uat-api.epa.gov/api-docs/api-docs.json` |

The Swagger UI is at https://dwsfties-uat.epa.gov/swagger/inventory (Inventory service shown; replace `inventory` with the service name for others). These specs define the API contract (endpoints, parameters, response DTOs) that this translation API implements.

**Data Dictionary** — The SF-to-SS column crosswalk is obtained from EPA's public [DW-SFTIES Data Dictionary](https://awsedap.epa.gov/public/single/?appid=659c09ba-0294-44c7-b09e-c26728c827d3) Qlik dashboard. It maps every SF table/column to its SS equivalent, including the SS table name, column name, and data type. Export the full dictionary as CSV to use with the mapping analyzer.

Additional EPA resources:
- [DW-SFTIES API Interaction examples (GitHub)](https://github.com/USEPA/DW_SFTIES_API_Interaction)
- [DW-SFTIES program page](https://www.epa.gov/sdwis/dw-sfties)

## License

MIT
