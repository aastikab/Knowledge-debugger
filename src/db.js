require('dotenv').config();
const { Pool } = require('pg');

// Create a reusable connection pool to PostgreSQL.
// Credentials come from the .env file (never hard-coded).
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

module.exports = pool;
