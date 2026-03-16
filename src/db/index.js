// src/db/index.js

import mysql from 'mysql2/promise';
import { DB_NAME } from "../constants.js";

let pool;

// Initialize the connection pool
const connectDB = () => {
  try {
    if (!pool) {
      pool = mysql.createPool({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: DB_NAME,
        port: process.env.MYSQL_PORT,
        connectionLimit: 100,       // Limit the number of connections in the pool
        waitForConnections: true,   // Queue connection requests when the limit is reached
        queueLimit: 0,               // Unlimited queue length for waiting connections
        enableKeepAlive: true,
        keepAliveInitialDelay: 10 * 60000  // Ping in every 10 minutes to keep connection alive
      });
      console.log(`\nMySQL connection pool created! DB HOST: ${process.env.MYSQL_HOST}`);
    }
    return pool;
    
  } catch (error) {
    console.error("MySQL connection pool creation FAILED:", error.message);
    throw error;
  }
};


export default connectDB;
