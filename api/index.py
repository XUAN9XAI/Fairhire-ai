from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional
import pandas as pd
import io
import os
import json
import sys

# Import engine modules (Vercel requires api/ to be in sys.path)
sys.path.insert(0, os.path.dirname(__file__))

from bias_engine import train_model, compute_bias_metrics, get_feature_importance, apply_reweighting
from gemini_engine import explain_bias, simulate_whatif, analyze_root_cause
from sample_data import get_sample_dataset
from db import db

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
    threshold: Optional[float] = 0.1
    use_sample: Optional[bool] = False

class WhatIfRequest(BaseModel):
    candidate_id: str
    target_group: str

class ExplainRequest(BaseModel):
    metrics: dict
    feature_importances: list

# --- Shared audit pipeline (reused by /audit and /audit/sample) ---

def _run_audit_pipeline(df, target_col, sensitive_col, threshold=0.1, mode="standard"):
    """Core audit logic. Returns the full response dict. Raises on error."""
    try:
        # Store session
        session_data["df"] = df
        session_data["target_col"] = target_col
        session_data["sensitive_col"] = sensitive_col

        # Handle NaN values — fill with sensible defaults before training
        df_clean = df.copy()
        for col in df_clean.select_dtypes(include=["number"]).columns:
            df_clean[col] = df_clean[col].fillna(df_clean[col].median())

        # 1. Train Model
        model, predictions, encoders, features = train_model(
            df_clean, target_col, sensitive_col
        )

        session_data["model"] = model
        session_data["encoders"] = encoders
        session_data["features"] = features

        # 2. Compute Metrics
        metrics = compute_bias_metrics(df_clean, target_col, sensitive_col, predictions, threshold=threshold)
        if "error" in metrics:
            return {"error": metrics["error"]}
        session_data["metrics_before"] = metrics

        # 3. Feature Importance
        feature_importances = get_feature_importance(model, features)

        # 4. Save to Database (Task 8)
        dataset_id = session_data.get("dataset_id")
        db.save_audit(
            dataset_id=dataset_id,
            metrics=metrics,
            feature_importance=feature_importances,
            explanation=metrics.get("explanation", ""), # AI explanation is usually separate, but we can store metrics
            threshold=threshold
        )

        # Candidate IDs for what-if simulator
        candidate_ids = df['candidate_id'].head(5).tolist() if 'candidate_id' in df.columns else []

        result = {
            "metrics": metrics,
            "feature_importances": feature_importances[:5],
            "candidate_ids": candidate_ids,
            "mode": mode
        }
        return result

    except Exception as e:
        return {"error": str(e), "mode": mode}


# --- Endpoints ---

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")
    
    contents = await file.read()
    try:
        df = pd.read_csv(io.StringIO(contents.decode('utf-8')))
        session_data["df"] = df
        
        # Save to DB (Task 8)
        ds_id = db.save_dataset(
            filename=file.filename,
            content=df.to_dict('records'),
            target="", # Filled later
            sensitive=""
        )
        session_data["dataset_id"] = ds_id
        
        return {"columns": df.columns.tolist(), "rows": len(df)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error parsing CSV: {str(e)}")

@app.get("/api/history")
async def get_audit_history():
    return db.get_history()

@app.post("/api/audit")
async def run_audit(request: AuditRequest):
    if request.use_sample:
        df = get_sample_dataset()
        session_data["df"] = df
        result = _run_audit_pipeline(df, request.target_col, request.sensitive_col, threshold=request.threshold, mode="prototype")
    else:
        df = session_data.get("df")
        if df is None:
            raise HTTPException(status_code=400, detail="No dataset uploaded")
        result = _run_audit_pipeline(df, request.target_col, request.sensitive_col, threshold=request.threshold, mode="standard")

    if "error" in result and "metrics" not in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@app.post("/api/audit/sample")
async def run_sample_audit(request: Optional[dict] = None):
    """One-click demo: runs bias audit on internal sample dataset. Supports custom target/sensitive if provided."""
    try:
        target_col = "hired"
        sensitive_col = "gender"
        if request:
            target_col = request.get("target_col", "hired")
            sensitive_col = request.get("sensitive_col", "gender")
            
        df = get_sample_dataset()
        threshold = request.get("threshold", 0.1) if request else 0.1
        result = _run_audit_pipeline(df, target_col=target_col, sensitive_col=sensitive_col, threshold=threshold, mode="prototype")

        if "error" in result and "metrics" not in result:
            raise HTTPException(status_code=500, detail=result["error"])

        return result
    except HTTPException:
        raise
    except Exception as e:
        return {
            "error": str(e),
            "mode": "prototype",
            "metrics": {
                "bias_score": 0.0,
                "status": "ERROR",
                "selection_rates": {},
                "demographic_parity_gap": 0.0
            },
            "feature_importances": [],
            "candidate_ids": []
        }

@app.post("/api/explain")
async def get_explanation(request: ExplainRequest):
    """Generates AI explanation for the provided metrics and features."""
    try:
        explanation = explain_bias(request.metrics)
        root_cause = analyze_root_cause(request.feature_importances)
        return {
            "explanation": explanation,
            "root_cause": root_cause
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/whatif")
async def run_whatif(request: WhatIfRequest):
    df = session_data.get("df")
    metrics = session_data.get("metrics_before")
    sensitive_col = session_data.get("sensitive_col")
    
    if df is None or metrics is None:
        raise HTTPException(status_code=400, detail="Run audit first")
        
    if 'candidate_id' not in df.columns:
        raise HTTPException(status_code=400, detail="Dataset missing candidate_id column")

    # Compute actual group probabilities for anchored what-if
    target_col = session_data.get("target_col", "hired")
    group_probs = {}
    for g in df[sensitive_col].unique():
        group_df = df[df[sensitive_col] == g]
        if len(group_df) > 0:
            group_probs[str(g)] = float(group_df[target_col].mean())

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

    # Compute anchored delta for the what-if
    current_group = str(candidate_data.get(sensitive_col, ""))
    current_prob = group_probs.get(current_group, 0.5)
    target_prob = group_probs.get(request.target_group, 0.5)
    delta = target_prob - current_prob

    # --- Real Model Inference (Task 3) ---
    model = session_data.get("model")
    features = session_data.get("features")
    encoders = session_data.get("encoders")
    
    new_prob = 0.5
    if model and features and encoders:
        try:
            # Prepare row for prediction
            row_df = pd.DataFrame([candidate_data])
            # Swap sensitive attribute
            row_df[sensitive_col] = request.target_group
            
            # Encode
            for col in features:
                if col in encoders:
                    row_df[col] = encoders[col].transform(row_df[col].astype(str))
                elif row_df[col].dtype == 'object':
                    row_df[col] = 0 # Fallback
            
            # Predict
            prob = model.predict_proba(row_df[features])[0][1]
            new_prob = float(prob)
        except Exception as e:
            print(f"Inference error: {e}")

    # Enrich metrics with anchored values for the explanation
    enriched_metrics = {**metrics, "group_probs": group_probs, "delta": delta}

    whatif_explanation = simulate_whatif(
        candidate_data, 
        current_prediction, 
        sensitive_col, 
        request.target_group,
        enriched_metrics
    )
    
    return {
        "candidate_data": candidate_data,
        "whatif_explanation": whatif_explanation,
        "group_probabilities": group_probs,
        "new_probability": round(new_prob * 100, 1),
        "delta": round(delta * 100, 1)
    }

@app.post("/api/validate")
async def validate_data(request: AuditRequest):
    """Performs Task 4: Robust CSV Validation."""
    df = session_data.get("df")
    if df is None:
        raise HTTPException(status_code=400, detail="No dataset uploaded")
    
    target = request.target_col
    sensitive = request.sensitive_col
    
    checks = []
    
    # 1. Binary Target Check
    target_vals = df[target].dropna().unique()
    is_binary = len(target_vals) == 2
    checks.append({
        "pass": is_binary,
        "message": f"Target column '{target}' must be binary (0/1). Found: {list(target_vals)[:3]}"
    })
    
    # 2. Sensitive Groups Check
    sensitive_vals = df[sensitive].dropna().unique()
    has_groups = len(sensitive_vals) >= 2
    checks.append({
        "pass": has_groups,
        "message": f"Sensitive attribute '{sensitive}' must have at least 2 groups. Found: {len(sensitive_vals)}"
    })
    
    # 3. Sample Size Check
    min_size = 30
    all_large = True
    for val in sensitive_vals:
        count = len(df[df[sensitive] == val])
        if count < min_size:
            all_large = False
            break
    
    checks.append({
        "pass": all_large,
        "message": f"Each group should have at least {min_size} rows for statistical reliability."
    })
    
    return {"checks": checks}

@app.post("/api/mitigate")
async def run_mitigation(request: Optional[dict] = None):
    df = session_data.get("df")
    target_col = session_data.get("target_col")
    sensitive_col = session_data.get("sensitive_col")
    
    # Auto-recovery for prototype mode or expired sessions
    if df is None:
        # If we have target/sensitive info from the request, we can try to recover
        if request and request.get("target_col") and request.get("sensitive_col"):
            target_col = request.get("target_col")
            sensitive_col = request.get("sensitive_col")
            # For now, we assume recovery means reloading sample data
            df = get_sample_dataset()
            session_data["df"] = df
            session_data["target_col"] = target_col
            session_data["sensitive_col"] = sensitive_col
            # Re-run audit to get metrics_before
            audit_res = _run_audit_pipeline(df, target_col, sensitive_col)
            session_data["metrics_before"] = audit_res["metrics"]
        else:
            raise HTTPException(status_code=400, detail="Session expired. Please re-run audit.")

    if target_col is None:
        target_col = "hired"
    if sensitive_col is None:
        sensitive_col = "gender"

    # Handle NaN values
    df_clean = df.copy()
    for col in df_clean.select_dtypes(include=["number"]).columns:
        df_clean[col] = df_clean[col].fillna(df_clean[col].median())

    # Apply Reweighting
    weights = apply_reweighting(df_clean, target_col, sensitive_col)
    
    # Retrain model with weights
    model, predictions, _, _ = train_model(
        df_clean, target_col, sensitive_col, sample_weight=weights
    )
    
    # Recompute metrics
    metrics_after = compute_bias_metrics(df_clean, target_col, sensitive_col, predictions, threshold=0.1)
    session_data["metrics_after"] = metrics_after
    
    metrics_before = session_data.get("metrics_before")
    
    return {
        "before": metrics_before,
        "after": metrics_after,
        "improvement": metrics_before["demographic_parity_gap"] - metrics_after["demographic_parity_gap"]
    }

@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}

# Mount frontend static files last so API routes take precedence
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
