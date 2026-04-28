# FairHire AI

An AI-powered hiring bias auditor designed to detect, explain, and mitigate systemic bias in hiring processes. This project utilizes the Google Gemini API to translate complex machine learning fairness metrics into human-readable explanations.

## Features

1. **Bias Detection**: Uses Random Forest and statistical parity metrics to detect unfair hiring patterns.
2. **AI Explanations (Gemini)**: Explains the "why" behind the bias in plain English suitable for HR professionals.
3. **What-If Simulator**: A powerful storytelling tool that simulates how a specific candidate's outcome would change if their demographic attributes were different.
4. **Mitigation Engine**: Applies reweighting algorithms to mathematically balance the training data, reducing the bias gap.

## Project Structure
- `/backend`: FastAPI Python server, Scikit-learn ML logic, Gemini API integration.
- `/frontend`: Vanilla HTML/CSS/JS single-page application with a premium dark-mode design.

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
Set your Gemini API key. The application will use a mock mode if the key is not found, but you won't get the rich AI explanations.
```bash
# Windows
set GEMINI_API_KEY=your_api_key_here
# Mac/Linux
export GEMINI_API_KEY="your_api_key_here"
```

### 3. Generate Sample Dataset
Run the data generator to create a biased dataset (`backend/sample_data.csv`).
```bash
python dataset_generator.py
```
*Note: This generates a dataset with ~500 rows, intentionally embedding a bias against women returning to work and candidates from Tier-2/3 cities.*

### 4. Run the Server
```bash
uvicorn main:app --reload
```
The application will be available at `http://localhost:8000`. The frontend is served statically from the root route.

## Demo Walkthrough

To showcase the platform's impact, follow this storyline:
1. **Upload**: Upload `sample_data.csv`. Select `hired` as target and `gender` as the sensitive column.
2. **Audit**: Run the audit. Notice the ~22% Demographic Parity Gap.
3. **Explain**: Read the Gemini explanation of how proxy variables (like employment gaps) affect women.
4. **Simulate**: Select `Candidate CAND-001` (Priya). Change the target group to `Male`. Read the Gemini simulation showing how systemic bias rejected her.
5. **Mitigate**: Apply the mitigation engine to drop the bias gap to acceptable levels (<10%).
