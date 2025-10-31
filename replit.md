# Overview

This is a patient registry management system built with Node.js and Express. The application allows healthcare providers to manage patient records, including personal information, admission/discharge dates, and ICD medical codes. The system uses a simple web interface with Albanian language support for data entry and viewing.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Backend Architecture

**Framework**: Express.js (v5.1.0) server running on port 5000

**Rationale**: Express provides a lightweight, unopinionated web framework that's well-suited for building RESTful APIs and serving static content. The simplicity allows for rapid development of CRUD operations for patient management.

**Middleware Stack**:
- `body-parser`: Handles JSON and URL-encoded form data parsing
- `express.static`: Serves static HTML/CSS/JS files from the `public` directory

## Data Storage

**Database**: SQLite3 with file-based storage (`patients.db`)

**Rationale**: SQLite is a serverless, zero-configuration database that's perfect for small to medium-scale applications. It eliminates the need for a separate database server while providing full relational database capabilities. The file-based approach simplifies deployment and backup procedures.

**Database Schema**:

1. **patients table**:
   - Primary patient information (protocol number, name, gender, DOB)
   - Admission and discharge tracking
   - Auto-incrementing ID as primary key
   - Unique constraint on protocol_number to prevent duplicates
   - Timestamps for record creation

2. **patient_icd_codes table**:
   - Many-to-one relationship with patients
   - Stores ICD diagnostic codes with descriptions
   - Foreign key with CASCADE delete ensures data integrity

**Design Decision**: The separation of ICD codes into a dedicated table allows multiple diagnoses per patient while maintaining normalized data structure.

## Frontend Architecture

**Technology**: Vanilla HTML/CSS/JavaScript with no frameworks

**Rationale**: For a simple CRUD application, vanilla JavaScript eliminates build complexity and dependency management. The tab-based interface provides clear separation between registration and search functionalities.

**Features**:
- Tab-based navigation system
- Albanian language interface (indicated by lang="sq")
- Gradient background with modern styling
- Responsive design considerations (viewport meta tag)

## API Design

The application follows a traditional server-rendered + AJAX pattern:
- Static HTML served from `/public`
- RESTful endpoints (implied but not visible in partial code) for patient CRUD operations
- JSON-based data exchange for dynamic operations

# External Dependencies

## NPM Packages

1. **express** (v5.1.0): Web application framework
2. **body-parser** (v2.2.0): Request parsing middleware
3. **sqlite3** (v5.1.7): SQLite database driver with verbose logging
4. **@types/node** (v22.13.11): TypeScript definitions for Node.js (development support)

## Database

- **SQLite3**: Embedded relational database (no external service required)
- Database file location: `./patients.db` in project root

## Third-Party Services

None currently integrated. The application operates entirely as a self-contained system without external API dependencies.

# Features

## Patient Registration
- Unique protocol number for each patient
- Patient name, gender, and date of birth
- Automatic age calculation based on date of birth
- Admission and discharge dates
- Automatic length of stay calculation (including admission day)
- Multiple ICD-10 codes per patient (required - at least one)
- Validation on both frontend and backend to ensure data integrity

## Patient Listing
- View all registered patients in a table format
- Display calculated age and length of stay
- Show all ICD-10 codes as badges

## Search Functionality
- Filter patients by ICD-10 code
- Filter by minimum age (e.g., 65+ years)
- Filter by gender (male/female)
- Combined filters for complex queries
- Results show count and detailed patient information

## Statistics Dashboard
- Total patient count
- Gender distribution
- Age group breakdown (0-18, 19-64, 65+)

# Recent Changes

**Date**: October 31, 2025
- Initial implementation of patient management system
- Created database schema with patients and patient_icd_codes tables
- Implemented patient registration with automatic calculations
- Added search and statistics functionality
- Added validation to require at least one ICD-10 code per patient
- Fixed favicon 404 error with inline SVG icon
