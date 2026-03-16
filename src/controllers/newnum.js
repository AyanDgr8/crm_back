// src/controllers/newnum.js

import connectDB from '../db/index.js';

// Function to check if customer exists by phone number
export const checkCustomerByPhone = async (req, res) => {
  const { phone_no } = req.params;

  try {
    // Establish database connection
    const connection = await connectDB();

    // Query to check if customer exists
    const [rows] = await connection.execute(
      'SELECT * FROM customers WHERE phone_no = ?',
      [phone_no]
    );

    // If customer exists, return their data
    if (rows.length > 0) {
      res.status(200).json({ exists: true, customer: rows[0] });
    } else {
      // If customer does not exist, respond with exists: false
      res.status(404).json({ exists: false });
    }
  } catch (error) {
    console.error('Error checking customer by phone:', error);
    res.status(500).json({ message: 'Failed to check customer' });
  }
};


export const insertPrimaryNum = async(req, res)=>{
  const { phone_no } = req.params;

  try {
    // Establish database connection
    const connection = await connectDB();

    // Get the latest C_unique_id
    const [lastIdResult] = await connection.query(
      'SELECT C_unique_id FROM customers ORDER BY CAST(SUBSTRING(C_unique_id, 4) AS UNSIGNED) DESC LIMIT 1'
    );
    
    const lastId = lastIdResult[0]?.C_unique_id || 'FF_0';
    const lastNumericPart = parseInt(lastId.split('_')[1]) || 0;
    const nextUniqueId = `FF_${lastNumericPart + 1}`;

    // Insert new customer with phone number
    const [result] = await connection.execute(
      'INSERT INTO customers (phone_no, C_unique_id) VALUES (?, ?)',
      [phone_no, nextUniqueId]
    );

    // If insertion successful, return success
    if (result.insertId) {
      res.status(201).json({ 
        success: true, 
        message: 'Customer created successfully',
        customerId: result.insertId,
        C_unique_id: nextUniqueId
      });
    } else {
      res.status(400).json({ success: false, message: 'Failed to create customer' });
    }
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({ message: 'Failed to create customer' });
  }
};

