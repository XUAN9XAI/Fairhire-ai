from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import pandas as pd
import numpy as np
import io
import os
import json
import pickle

# Import engine modules (Vercel adds api/ to sys.path)
import sys
sys.path.insert(0, os.path.dirname(__file__))
from bias_engine import train_model, compute_bias_metrics, get_feature_importance, apply_reweighting
from gemini_engine import explain_bias, simulate_whatif, analyze_root_cause
from sample_data import get_sample_dataset

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
    use_sample: Optional[bool] = False

class WhatIfRequest(BaseModel):
    candidate_id: str
    target_group: str

# --- Shared audit pipeline ---
def _run_audit_pipeline(df, target_col, sensitive_col, mode="standard"):
    """Core audit logic reused by /audit and /audit/sample."""
    try:
        save_csv(df)
        save_session("config", {"target_col": target_col, "sensitive_col": sensitive_col})

        # Handle NaN values
        df_clean = df.copy()
        for col in df_clean.select_dtypes(include=["number"]).columns:
            df_clean[col] = df_clean[col].fillna(df_clean[col].median())

        model, predictions, encoders, features = train_model(df_clean, target_col, sensitive_col)
        save_session("model_data", {"encoders": encoders, "features": features})

        metrics = compute_bias_metrics(df_clean, sensitive_col, predictions)
        if "error" in metrics:
            return {"error": metrics["error"]}
        save_session("metrics_before", metrics)

        feature_importances = get_feature_importance(model, features)
        explanation = explain_bias(metrics)
        root_cause = analyze_root_cause(feature_importances)

        candidate_ids = df['candidate_id'].head(5).tolist() if 'candidate_id' in df.columns else []

        return {
            "metrics": metrics,
            "feature_importances": feature_importances[:5],
            "explanation": explanation,
            "root_cause": root_cause,
            "candidate_ids": candidate_ids,
            "mode": mode
        }
    except Exception as e:
        return {"error": str(e), "mode": mode}

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
    if request.use_sample:
        df = get_sample_dataset()
        result = _run_audit_pipeline(df, request.target_col, request.sensitive_col, mode="prototype")
    else:
        df = load_csv()
        if df is None:
            raise HTTPException(status_code=400, detail="No dataset uploaded")
        result = _run_audit_pipeline(df, request.target_col, request.sensitive_col, mode="standard")

    if "error" in result and "metrics" not in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@app.post("/api/audit/sample")
async def run_sample_audit():
    """One-click demo: bias audit on internal sample data. No input required."""
    try:
        df = get_sample_dataset()
        result = _run_audit_pipeline(df, target_col="hired", sensitive_col="gender", mode="prototype")

        if "error" in result and "metrics" not in result:
            raise HTTPException(status_code=500, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        return {
            "error": str(e),
            "mode": "prototype",
            "metrics": {"bias_score": 0.0, "status": "ERROR", "selection_rates": {}, "demographic_parity_gap": 0.0},
            "feature_importances": [],
            "explanation": "An error occurred during the sample audit.",
            "root_cause": "Unable to process sample data.",
            "candidate_ids": []
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

    # Compute anchored group probabilities
    group_probs = {}
    for g in df[sensitive_col].unique():
        group_df = df[df[sensitive_col] == g]
        if len(group_df) > 0:
            group_probs[str(g)] = float(group_df[target_col].mean())

    candidate_row = df[df['candidate_id'] == request.candidate_id]
    if candidate_row.empty:
        raise HTTPException(status_code=404, detail="Candidate not found")
    
    candidate_data = candidate_row.iloc[0].to_dict()
    for k, v in candidate_data.items():
        try:
            if hasattr(v, 'item'):
                candidate_data[k] = v.item()
        except (ValueError, AttributeError):
            candidate_data[k] = str(v)
    
    current_prediction = candidate_data.get(target_col, 0)
    current_group = str(candidate_data.get(sensitive_col, ""))
    current_prob = group_probs.get(current_group, 0.5)
    target_prob = group_probs.get(request.target_group, 0.5)
    delta = target_prob - current_prob

    enriched_metrics = {**metrics, "group_probs": group_probs, "delta": delta}

    whatif_explanation = simulate_whatif(
        candidate_data, current_prediction, sensitive_col, request.target_group, enriched_metrics
    )
    
    return {
        "candidate_data": candidate_data,
        "whatif_explanation": whatif_explanation,
        "group_probabilities": group_probs,
        "delta": round(delta * 100, 1)
    }

@app.post("/api/mitigate")
async def run_mitigation():
    df = load_csv()
    config = load_session("config")
    
    if df is None or config is None:
        raise HTTPException(status_code=400, detail="Run audit first")
    
    target_col = config["target_col"]
    sensitive_col = config["sensitive_col"]

    df_clean = df.copy()
    for col in df_clean.select_dtypes(include=["number"]).columns:
        df_clean[col] = df_clean[col].fillna(df_clean[col].median())

    weights = apply_reweighting(df_clean, target_col, sensitive_col)
    model, predictions, _, _ = train_model(df_clean, target_col, sensitive_col, sample_weight=weights)
    metrics_after = compute_bias_metrics(df_clean, sensitive_col, predictions)
    metrics_before = load_session("metrics_before")
    
    return {
        "before": metrics_before,
        "after": metrics_after,
        "improvement": metrics_before["bias_score"] - metrics_after["bias_score"]
    }
