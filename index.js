const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Database file path
const DB_FILE = './patients.db';

// Create DB if it doesn't exist
const dbExists = fs.existsSync(DB_FILE);
const db = new sqlite3.Database(DB_FILE);

if (!dbExists) {
    console.log('Database not found, creating new database...');
    initializeDatabase();
} else {
    console.log('Database found!');
}

// Create tables
function initializeDatabase() {
    db.serialize(() => {
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

        console.log('Database tables created!');
    });
}

// Helper functions
function calculateAge(dob) {
    const birth = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
}

function calculateLengthOfStay(adm, dis) {
    if (!dis) return null;
    const a = new Date(adm), d = new Date(dis);
    return Math.ceil((d - a)/(1000*60*60*24)) + 1;
}

// Routes

// Register patient
app.post('/api/patients', (req, res) => {
    const { protocol_number, name, gender, date_of_birth, admission_date, discharge_date, icd_codes } = req.body;

    if (!protocol_number || !name || !gender || !date_of_birth || !admission_date) 
        return res.status(400).json({ error: 'All required fields must be filled' });

    if (!icd_codes || !Array.isArray(icd_codes) || icd_codes.length === 0 || !icd_codes.some(c => c.code && c.code.trim()))
        return res.status(400).json({ error: 'At least one ICD-10 code is required' });

    db.run(
        `INSERT INTO patients (protocol_number, name, gender, date_of_birth, admission_date, discharge_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [protocol_number, name, gender, date_of_birth, admission_date, discharge_date || null],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Protocol number already exists' });
                return res.status(500).json({ error: err.message });
            }

            const patientId = this.lastID;
            const stmt = db.prepare(`INSERT INTO patient_icd_codes (patient_id, icd_code, description) VALUES (?, ?, ?)`);
            icd_codes.forEach(c => stmt.run(patientId, c.code, c.description || ''));
            stmt.finalize();

            res.json({ success: true, message: 'Patient registered successfully', patientId });
        }
    );
});

// Get all patients
app.get('/api/patients', (req, res) => {
    db.all(`
        SELECT p.*, GROUP_CONCAT(pic.icd_code) AS icd_codes
        FROM patients p
        LEFT JOIN patient_icd_codes pic ON p.id = pic.patient_id
        GROUP BY p.id
        ORDER BY p.created_at DESC
    `, [], (err, rows) => {
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
    db.run('DELETE FROM patients WHERE protocol_number = ?', [protocolNumber], function(err) {
        if (err) return res.status(500).json({ error: 'Error deleting patient' });
        if (this.changes === 0) return res.status(404).json({ error: 'Patient not found' });
        res.json({ message: 'Patient deleted successfully' });
    });
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));