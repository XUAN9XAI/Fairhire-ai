# FairHire AI

An AI-powered hiring bias auditor designed to detect, explain, and mitigate systemic bias in hiring processes. This project utilizes the Google Gemini API to translate complex machine learning fairness metrics into human-readable explanations.

## Features

1. **Bias Detection**: Uses Random Forest and statistical parity metrics to detect unfair hiring patterns.
2. **AI Explanations (Gemini)**: Explains the "why" behind the bias in plain English suitable for HR professionals.
3. **What-If Simulator**: A powerful storytelling tool that simulates how a specific candidate's outcome would change if their demographic attributes were different.
4. **Mitigation Engine**: Applies reweighting algorithms to mathematically balance the training data, reducing the bias gap.
5. **Multi-Dataset Upload**: Upload and audit multiple datasets in a single session.
6. **Audit History**: Track all past audits with timestamps, bias scores, and status.

## Project Structure
- `/api`: FastAPI Python serverless functions (deployed to Vercel)
- `/public`: Frontend static files (HTML/CSS/JS)
- `/backend`: Local development server files

## Live Demo

Deployed on Vercel: *(add your URL here)*

## Quick Start (Local Development)

### Prerequisites
- Python 3.9+
- A Google Gemini API Key

### 1. Setup Backend
```bash
cd backend
python -m venv venv
# Activate venv (Windows: .\venv\Scripts\activate, Mac/Linux: source venv/bin/activate)
pip install -r requirements.txt
```

### 2. Configure Environment
```bash
# Create .env file in the backend/ folder
cp backend/.env.example backend/.env
# Edit backend/.env and add your Gemini API key
```

### 3. Generate Sample Dataset
```bash
cd backend
python dataset_generator.py
```

### 4. Run the Server
```bash
cd backend
uvicorn main:app --reload --env-file .env
```
The application will be available at `http://localhost:8000`.

## Deploy to Vercel

1. Push to GitHub
2. Import the repo in [Vercel](https://vercel.com)
3. Add the environment variable `GEMINI_API_KEY` in Vercel Settings → Environment Variables
4. Deploy!

## Demo Walkthrough

1. **Upload**: Upload `sample_data.csv`. Select `hired` as target and `gender` as the sensitive column.
2. **Audit**: Run the audit. Notice the Demographic Parity Gap.
3. **Explain**: Read the Gemini explanation of how proxy variables affect outcomes.
4. **Simulate**: Select a candidate. Change the target group. Read the simulation.
5. **Mitigate**: Apply the mitigation engine to reduce the bias gap.
6. **History**: Review all past audits in the Audit History tab.
