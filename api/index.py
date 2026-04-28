from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import numpy as np
import io
import os
import json
import pickle
import tempfile

# Import engine modules (Vercel adds api/ to sys.path)
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from bias_engine import train_model, compute_bias_metrics, get_feature_importance, apply_reweighting
from gemini_engine import explain_bias, simulate_whatif, analyze_root_cause

app = FastAPI(title="FairHire AI API")

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Session state via /tmp (serverless-compatible) ---
TMP_DIR = "/tmp/fairhire"

def _ensure_tmp():
    os.makedirs(TMP_DIR, exist_ok=True)

def save_session(key, data):
    _ensure_tmp()
    with open(os.path.join(TMP_DIR, f"{key}.pkl"), "wb") as f:
        pickle.dump(data, f)

def load_session(key):
    path = os.path.join(TMP_DIR, f"{key}.pkl")
    if os.path.exists(path):
        with open(path, "rb") as f:
            return pickle.load(f)
    return None

def save_csv(df):
    _ensure_tmp()
    df.to_csv(os.path.join(TMP_DIR, "current.csv"), index=False)

def load_csv():
    path = os.path.join(TMP_DIR, "current.csv")
    if os.path.exists(path):
        return pd.read_csv(path)
    return None

# --- Models ---
class AuditRequest(BaseModel):
    target_col: str
    sensitive_col: str

class WhatIfRequest(BaseModel):
    candidate_id: str
    target_group: str

# --- Endpoints ---

@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")
    
    contents = await file.read()
    try:
        df = pd.read_csv(io.StringIO(contents.decode('utf-8')))
        save_csv(df)
        return {"columns": df.columns.tolist(), "rows": len(df)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error parsing CSV: {str(e)}")

@app.post("/api/audit")
async def run_audit(request: AuditRequest):
    df = load_csv()
    if df is None:
        raise HTTPException(status_code=400, detail="No dataset uploaded")
    
    save_session("config", {
        "target_col": request.target_col,
        "sensitive_col": request.sensitive_col
    })
    
    # 1. Train Model
    model, predictions, encoders, features = train_model(
        df, request.target_col, request.sensitive_col
    )
    
    # Save model info for later
    save_session("model_data", {
        "encoders": encoders,
        "features": features
    })
    
    # 2. Compute Metrics
    metrics = compute_bias_metrics(df, request.sensitive_col, predictions)
    if "error" in metrics:
        raise HTTPException(status_code=400, detail=metrics["error"])
    save_session("metrics_before", metrics)
    
    # 3. Feature Importance
    feature_importances = get_feature_importance(model, features)
    
    # 4. Explanations (Gemini)
    explanation = explain_bias(metrics)
    root_cause = analyze_root_cause(feature_importances)
    
    # Candidate IDs for what-if
    candidate_ids = df['candidate_id'].head(5).tolist() if 'candidate_id' in df.columns else []
    
    return {
        "metrics": metrics,
        "feature_importances": feature_importances[:5],
        "explanation": explanation,
        "root_cause": root_cause,
        "candidate_ids": candidate_ids
    }

@app.post("/api/whatif")
async def run_whatif(request: WhatIfRequest):
    df = load_csv()
    metrics = load_session("metrics_before")
    config = load_session("config")
    
    if df is None or metrics is None or config is None:
        raise HTTPException(status_code=400, detail="Run audit first")
    
    sensitive_col = config["sensitive_col"]
    target_col = config["target_col"]
    
    if 'candidate_id' not in df.columns:
        raise HTTPException(status_code=400, detail="Dataset missing candidate_id column")
    
    candidate_row = df[df['candidate_id'] == request.candidate_id]
    if candidate_row.empty:
        raise HTTPException(status_code=404, detail="Candidate not found")
    
    candidate_data = candidate_row.iloc[0].to_dict()
    # Convert numpy types to native Python for JSON serialization
    for k, v in candidate_data.items():
        try:
            if hasattr(v, 'item'):
                candidate_data[k] = v.item()
        except (ValueError, AttributeError):
            candidate_data[k] = str(v)
    
    current_prediction = candidate_data.get(target_col, 0)
    
    whatif_explanation = simulate_whatif(
        candidate_data,
        current_prediction,
        sensitive_col,
        request.target_group,
        metrics
    )
    
    return {
        "candidate_data": candidate_data,
        "whatif_explanation": whatif_explanation
    }

@app.post("/api/mitigate")
async def run_mitigation():
    df = load_csv()
    config = load_session("config")
    
    if df is None or config is None:
        raise HTTPException(status_code=400, detail="Run audit first")
    
    target_col = config["target_col"]
    sensitive_col = config["sensitive_col"]
    
    # Apply Reweighting
    weights = apply_reweighting(df, target_col, sensitive_col)
    
    # Retrain model with weights
    model, predictions, _, _ = train_model(
        df, target_col, sensitive_col, sample_weight=weights
    )
    
    # Recompute metrics
    metrics_after = compute_bias_metrics(df, sensitive_col, predictions)
    metrics_before = load_session("metrics_before")
    
    return {
        "before": metrics_before,
        "after": metrics_after,
        "improvement": metrics_before["bias_score"] - metrics_after["bias_score"]
    }
