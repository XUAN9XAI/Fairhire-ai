from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import pandas as pd
import io
import os
import json

from bias_engine import train_model, compute_bias_metrics, get_feature_importance, apply_reweighting
from gemini_engine import explain_bias, simulate_whatif, analyze_root_cause

app = FastAPI(title="FairHire AI API")

# Setup CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for the current session (simulating a DB for MVP)
session_data = {
    "df": None,
    "model": None,
    "encoders": None,
    "features": None,
    "metrics_before": None,
    "metrics_after": None,
    "target_col": None,
    "sensitive_col": None
}

class AuditRequest(BaseModel):
    target_col: str
    sensitive_col: str

class WhatIfRequest(BaseModel):
    candidate_id: str
    target_group: str

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")
    
    contents = await file.read()
    try:
        df = pd.read_csv(io.StringIO(contents.decode('utf-8')))
        session_data["df"] = df
        return {"columns": df.columns.tolist(), "rows": len(df)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error parsing CSV: {str(e)}")

@app.post("/api/audit")
async def run_audit(request: AuditRequest):
    df = session_data.get("df")
    if df is None:
        raise HTTPException(status_code=400, detail="No dataset uploaded")
        
    session_data["target_col"] = request.target_col
    session_data["sensitive_col"] = request.sensitive_col
    
    # 1. Train Model
    model, predictions, encoders, features = train_model(
        df, request.target_col, request.sensitive_col
    )
    
    session_data["model"] = model
    session_data["encoders"] = encoders
    session_data["features"] = features
    
    # 2. Compute Metrics
    metrics = compute_bias_metrics(df, request.sensitive_col, predictions)
    if "error" in metrics:
         raise HTTPException(status_code=400, detail=metrics["error"])
    session_data["metrics_before"] = metrics
    
    # 3. Feature Importance
    feature_importances = get_feature_importance(model, features)
    
    # 4. Explanations (Gemini)
    explanation = explain_bias(metrics)
    root_cause = analyze_root_cause(feature_importances)
    
    # Send some candidate IDs to the frontend for the what-if simulator
    candidate_ids = df['candidate_id'].head(5).tolist() if 'candidate_id' in df.columns else []
    
    return {
        "metrics": metrics,
        "feature_importances": feature_importances[:5], # Top 5
        "explanation": explanation,
        "root_cause": root_cause,
        "candidate_ids": candidate_ids
    }

@app.post("/api/whatif")
async def run_whatif(request: WhatIfRequest):
    df = session_data.get("df")
    metrics = session_data.get("metrics_before")
    sensitive_col = session_data.get("sensitive_col")
    
    if df is None or metrics is None:
        raise HTTPException(status_code=400, detail="Run audit first")
        
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
    current_prediction = candidate_data.get(session_data["target_col"], 0)
    
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
    df = session_data.get("df")
    target_col = session_data.get("target_col")
    sensitive_col = session_data.get("sensitive_col")
    
    if df is None or target_col is None:
         raise HTTPException(status_code=400, detail="Run audit first")
         
    # Apply Reweighting
    weights = apply_reweighting(df, target_col, sensitive_col)
    
    # Retrain model with weights
    model, predictions, _, _ = train_model(
        df, target_col, sensitive_col, sample_weight=weights
    )
    
    # Recompute metrics
    metrics_after = compute_bias_metrics(df, sensitive_col, predictions)
    session_data["metrics_after"] = metrics_after
    
    metrics_before = session_data.get("metrics_before")
    
    return {
        "before": metrics_before,
        "after": metrics_after,
        "improvement": metrics_before["bias_score"] - metrics_after["bias_score"]
    }

@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}

# Mount frontend static files last so API routes take precedence
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
