require('dotenv').config();
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const db = require('./db');
const waterSystemRoutes = require('./routes/water-system');
const facilityRoutes = require('./routes/facility');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Swagger docs
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'SDWIS Translation API',
      version: '0.1.0',
      description: 'DW-SFTIES compatible read-only API backed by SDWIS/STATE data',
    },
    servers: [{ url: '/' }],
  },
  apis: ['./routes/*.js'],
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Routes — facility must be before water-system so "facility" doesn't match :waterSystemId
app.use('/inventory/water-system/facility', facilityRoutes);
app.use('/inventory/water-system', waterSystemRoutes);

// Root → Swagger docs
app.get('/', (req, res) => res.redirect('/api-docs'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', datasource: db.mode });
});

app.listen(PORT, () => {
  console.log(`SDWIS Translation API listening on port ${PORT} [${db.mode} mode]`);
  console.log(`Swagger docs: http://localhost:${PORT}/api-docs`);
});
