#!/bin/bash
# SDWIS Translation API — curl examples
# Usage: start the API first (npm start), then run any of these.

API=http://localhost:3000

# --- Health check ---
curl -s $API/health | python3 -m json.tool

# --- Water Systems ---

# List first 5 water systems
curl -s "$API/inventory/water-system?pageSize=5" | python3 -m json.tool

# Search by name
curl -s "$API/inventory/water-system?name=spring&pageSize=5" | python3 -m json.tool

# Filter by status
curl -s "$API/inventory/water-system?wsStatusCode=A&pageSize=5" | python3 -m json.tool

# Filter by source type (ground water)
curl -s "$API/inventory/water-system?fedWSSourceCode=GW&pageSize=5" | python3 -m json.tool

# Filter by population range
curl -s "$API/inventory/water-system?fedPopulationFrom=1000&fedPopulationTo=10000&pageSize=5" | python3 -m json.tool

# Sort by population descending
curl -s "$API/inventory/water-system?sortColumns=fedPopulation&sortOrders=DESC&pageSize=5" | python3 -m json.tool

# Get a single water system by PWSID
curl -s "$API/inventory/water-system/MS0010001" | python3 -m json.tool

# --- Facilities ---

# List first 5 facilities
curl -s "$API/inventory/water-system/facility?pageSize=5" | python3 -m json.tool

# Facilities for a specific water system
curl -s "$API/inventory/water-system/facility?waterSystemId=MS0010001&pageSize=5" | python3 -m json.tool

# Filter by type (wells only)
curl -s "$API/inventory/water-system/facility?facilityTypeCode=WL&pageSize=5" | python3 -m json.tool

# Filter by type (treatment plants)
curl -s "$API/inventory/water-system/facility?facilityTypeCode=TP&pageSize=5" | python3 -m json.tool

# Filter by water type (surface water facilities)
curl -s "$API/inventory/water-system/facility?facilityWaterTypeCode=SW&pageSize=5" | python3 -m json.tool

# Sources only
curl -s "$API/inventory/water-system/facility?srcInd=Y&pageSize=5" | python3 -m json.tool

# Get a single facility by ID
curl -s "$API/inventory/water-system/facility/37556" | python3 -m json.tool

# --- Combining filters ---

# Active ground water wells sorted by name
curl -s "$API/inventory/water-system/facility?facilityTypeCode=WL&facilityWaterTypeCode=GW&facilityStatusCode=A&sortColumns=name&sortOrders=ASC&pageSize=10" | python3 -m json.tool
