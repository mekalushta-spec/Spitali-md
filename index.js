const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 5000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Initialize database
const db = new sqlite3.Database('./patients.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Create tables
function initializeDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      protocol_number TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      gender TEXT NOT NULL,
      date_of_birth DATE NOT NULL,
      admission_date DATE NOT NULL,
      discharge_date DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS patient_icd_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      icd_code TEXT NOT NULL,
      description TEXT,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    )
  `);
}

// Helper function to calculate age
function calculateAge(dateOfBirth) {
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  return age;
}

// Helper function to calculate length of stay
function calculateLengthOfStay(admissionDate, dischargeDate) {
  const admission = new Date(admissionDate);
  const discharge = new Date(dischargeDate);
  const timeDiff = discharge - admission;
  const days = Math.ceil(timeDiff / (1000 * 60 * 60 * 24)) + 1; // +1 to include admission day
  return days;
}

// API Routes

// Register new patient
app.post('/api/patients', (req, res) => {
  const { protocol_number, name, gender, date_of_birth, admission_date, discharge_date, icd_codes } = req.body;

  // Validate required fields
  if (!protocol_number || !name || !gender || !date_of_birth || !admission_date) {
    return res.status(400).json({ error: 'Të gjitha fushat e nevojshme duhet të plotësohen' });
  }

  // Validate ICD codes - at least one required
  if (!icd_codes || !Array.isArray(icd_codes) || icd_codes.length === 0 || !icd_codes.some(icd => icd.code && icd.code.trim())) {
    return res.status(400).json({ error: 'Duhet të shënohet të paktën një kod ICD-10' });
  }

  // Insert patient
  const sql = `INSERT INTO patients (protocol_number, name, gender, date_of_birth, admission_date, discharge_date) 
               VALUES (?, ?, ?, ?, ?, ?)`;
  
  db.run(sql, [protocol_number, name, gender, date_of_birth, admission_date, discharge_date || null], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ error: 'Numri i protokollit ekziston tashmë' });
      }
      return res.status(500).json({ error: err.message });
    }

    const patientId = this.lastID;

    // Insert ICD codes if provided
    if (icd_codes && Array.isArray(icd_codes) && icd_codes.length > 0) {
      const icdSql = `INSERT INTO patient_icd_codes (patient_id, icd_code, description) VALUES (?, ?, ?)`;
      
      icd_codes.forEach(icd => {
        db.run(icdSql, [patientId, icd.code, icd.description || '']);
      });
    }

    res.json({ 
      success: true, 
      message: 'Pacienti u regjistrua me sukses',
      patientId: patientId 
    });
  });
});

// Get all patients
app.get('/api/patients', (req, res) => {
  const sql = `
    SELECT p.*, GROUP_CONCAT(pic.icd_code) as icd_codes
    FROM patients p
    LEFT JOIN patient_icd_codes pic ON p.id = pic.patient_id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const patientsWithDetails = rows.map(patient => ({
      ...patient,
      age: calculateAge(patient.date_of_birth),
      length_of_stay: patient.discharge_date 
        ? calculateLengthOfStay(patient.admission_date, patient.discharge_date)
        : null,
      icd_codes: patient.icd_codes ? patient.icd_codes.split(',') : []
    }));

    res.json(patientsWithDetails);
  });
});

// Search patients by ICD code and age
app.get('/api/patients/search', (req, res) => {
  const { icd_code, min_age, gender } = req.query;

  let sql = `
    SELECT DISTINCT p.*, GROUP_CONCAT(DISTINCT pic.icd_code) as icd_codes
    FROM patients p
    LEFT JOIN patient_icd_codes pic ON p.id = pic.patient_id
    WHERE 1=1
  `;
  const params = [];

  if (icd_code) {
    sql += ` AND p.id IN (
      SELECT patient_id FROM patient_icd_codes WHERE icd_code LIKE ?
    )`;
    params.push(`%${icd_code}%`);
  }

  if (gender) {
    sql += ` AND p.gender = ?`;
    params.push(gender);
  }

  sql += ` GROUP BY p.id`;

  db.all(sql, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    let patientsWithDetails = rows.map(patient => ({
      ...patient,
      age: calculateAge(patient.date_of_birth),
      length_of_stay: patient.discharge_date 
        ? calculateLengthOfStay(patient.admission_date, patient.discharge_date)
        : null,
      icd_codes: patient.icd_codes ? patient.icd_codes.split(',') : []
    }));

    // Filter by age if specified
    if (min_age) {
      patientsWithDetails = patientsWithDetails.filter(p => p.age >= parseInt(min_age));
    }

    res.json({
      count: patientsWithDetails.length,
      patients: patientsWithDetails
    });
  });
});

// Statistics endpoint
app.get('/api/statistics', (req, res) => {
  const stats = {};

  // Total patients
  db.get('SELECT COUNT(*) as total FROM patients', [], (err, row) => {
    stats.total = row.total;

    // Gender distribution
    db.all('SELECT gender, COUNT(*) as count FROM patients GROUP BY gender', [], (err, rows) => {
      stats.byGender = rows;

      // Age groups
      db.all('SELECT * FROM patients', [], (err, patients) => {
        const ageGroups = { '0-18': 0, '19-64': 0, '65+': 0 };
        
        patients.forEach(p => {
          const age = calculateAge(p.date_of_birth);
          if (age <= 18) ageGroups['0-18']++;
          else if (age <= 64) ageGroups['19-64']++;
          else ageGroups['65+']++;
        });

        stats.ageGroups = ageGroups;
        res.json(stats);
      });
    });
  });
});

// Serve HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close(() => {
    console.log('Database connection closed');
    process.exit(0);
  });
});
// Delete patient by protocol number
app.delete('/api/patients/:protocol_number', (req, res) => {
    const protocolNumber = req.params.protocol_number;

    const sql = 'DELETE FROM patients WHERE protocol_number = ?';
    db.run(sql, [protocolNumber], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Gabim gjatë fshirjes së pacientit' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Pacienti nuk u gjet' });
        }
        res.json({ message: 'Pacienti u fshi me sukses' });
    });
});