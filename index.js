const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Initialize database
const db = new sqlite3.Database('./patients.db', (err) => {
    if (err) console.error('Error opening database:', err);
    else initializeDatabase();
});

// Create tables if they don't exist
function initializeDatabase() {
    db.run(`
        CREATE TABLE IF NOT EXISTS patients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            protocol_number TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            gender TEXT NOT NULL,
            date_of_birth TEXT NOT NULL,
            admission_date TEXT NOT NULL,
            discharge_date TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS patient_icd_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER NOT NULL,
            icd_code TEXT NOT NULL,
            description TEXT,
            FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
        )
    `);
}

// Helpers
const calculateAge = dob => {
    const today = new Date();
    const birth = new Date(dob);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
};

const calculateLengthOfStay = (admission, discharge) => {
    if (!discharge) return null;
    const a = new Date(admission), d = new Date(discharge);
    return Math.ceil((d - a) / (1000*60*60*24)) + 1;
};

// Routes

// Register patient
app.post('/api/patients', (req, res) => {
    const { protocol_number, name, gender, date_of_birth, admission_date, discharge_date, icd_codes } = req.body;

    if (!protocol_number || !name || !gender || !date_of_birth || !admission_date) {
        return res.status(400).json({ error: 'Të gjitha fushat e nevojshme duhet të plotësohen' });
    }

    if (!icd_codes || !Array.isArray(icd_codes) || icd_codes.length === 0 || !icd_codes.some(c => c.code)) {
        return res.status(400).json({ error: 'Duhet të shënohet të paktën një kod ICD-10' });
    }

    const sql = `INSERT INTO patients (protocol_number, name, gender, date_of_birth, admission_date, discharge_date)
                 VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(sql, [protocol_number, name, gender, date_of_birth, admission_date, discharge_date || null], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Numri i protokollit ekziston tashmë' });
            return res.status(500).json({ error: err.message });
        }

        const patientId = this.lastID;

        const icdSql = `INSERT INTO patient_icd_codes (patient_id, icd_code, description) VALUES (?, ?, ?)`;
        const stmt = db.prepare(icdSql);
        icd_codes.forEach(icd => stmt.run(patientId, icd.code, icd.description || ''));
        stmt.finalize();

        res.json({ success: true, message: 'Pacienti u regjistrua me sukses', patientId });
    });
});

// Get all patients
app.get('/api/patients', (req, res) => {
    const sql = `
        SELECT p.*, GROUP_CONCAT(pic.icd_code) AS icd_codes
        FROM patients p
        LEFT JOIN patient_icd_codes pic ON p.id = pic.patient_id
        GROUP BY p.id
        ORDER BY p.created_at DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const patients = rows.map(p => ({
            ...p,
            age: calculateAge(p.date_of_birth),
            length_of_stay: calculateLengthOfStay(p.admission_date, p.discharge_date),
            icd_codes: p.icd_codes ? p.icd_codes.split(',') : []
        }));
        res.json(patients);
    });
});

// Delete patient
app.delete('/api/patients/:protocol_number', (req, res) => {
    const protocolNumber = req.params.protocol_number;
    const sql = 'DELETE FROM patients WHERE protocol_number = ?';
    db.run(sql, [protocolNumber], function(err) {
        if (err) return res.status(500).json({ error: 'Gabim gjatë fshirjes së pacientit' });
        if (this.changes === 0) return res.status(404).json({ error: 'Pacienti nuk u gjet' });
        res.json({ message: 'Pacienti u fshi me sukses' });
    });
});

// Search patients
app.get('/api/patients/search', (req, res) => {
    const { icd_code, min_age, gender } = req.query;
    let sql = `
        SELECT DISTINCT p.*, GROUP_CONCAT(pic.icd_code) AS icd_codes
        FROM patients p
        LEFT JOIN patient_icd_codes pic ON p.id = pic.patient_id
        WHERE 1=1
    `;
    const params = [];
    if (icd_code) { sql += ` AND p.id IN (SELECT patient_id FROM patient_icd_codes WHERE icd_code LIKE ?)`; params.push(`%${icd_code}%`); }
    if (gender) { sql += ` AND p.gender = ?`; params.push(gender); }
    sql += ` GROUP BY p.id`;

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        let patients = rows.map(p => ({
            ...p,
            age: calculateAge(p.date_of_birth),
            length_of_stay: calculateLengthOfStay(p.admission_date, p.discharge_date),
            icd_codes: p.icd_codes ? p.icd_codes.split(',') : []
        }));
        if (min_age) patients = patients.filter(p => p.age >= parseInt(min_age));
        res.json({ count: patients.length, patients });
    });
});

// Statistics
app.get('/api/statistics', (req, res) => {
    const stats = {};
    db.get('SELECT COUNT(*) AS total FROM patients', [], (err, row) => {
        stats.total = row.total;
        db.all('SELECT gender, COUNT(*) AS count FROM patients GROUP BY gender', [], (err, rows) => {
            stats.byGender = rows;
            db.all('SELECT date_of_birth FROM patients', [], (err, patients) => {
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

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));