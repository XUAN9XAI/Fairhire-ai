import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder

def prepare_data(df, target_col, sensitive_col):
    """Encodes categorical features and separates features/target."""
    df_encoded = df.copy()
    encoders = {}
    
    # Don't use candidate_id or name for training
    cols_to_drop = [target_col]
    for col in ['candidate_id', 'name']:
        if col in df_encoded.columns:
            cols_to_drop.append(col)
            
    X = df_encoded.drop(columns=cols_to_drop)
    y = df_encoded[target_col]
    
    # Label encode categorical columns
    for col in X.columns:
        if X[col].dtype == 'object' or str(X[col].dtype) in ['string', 'str', 'string[python]']:
            le = LabelEncoder()
            X[col] = le.fit_transform(X[col].astype(str))
            encoders[col] = le
            
    return X, y, encoders

def train_model(df, target_col, sensitive_col, sample_weight=None):
    """Trains a Random Forest model."""
    X, y, encoders = prepare_data(df, target_col, sensitive_col)
    
    # Normally we might drop the sensitive column during training to avoid direct bias,
    # but often proxy variables exist. We'll train with it to see the direct effect,
    # or drop it depending on the fairness approach. Let's drop it to show that 
    # bias persists through proxy variables.
    features = [c for c in X.columns if c != sensitive_col]
    X_train = X[features]
    
    clf = RandomForestClassifier(n_estimators=100, random_state=42)
    clf.fit(X_train, y, sample_weight=sample_weight)
    
    # Get predictions
    predictions = clf.predict(X_train)
    
    return clf, predictions, encoders, features

def calculate_wilson_ci(p, n, z=1.96):
    """Calculates 95% Wilson confidence interval."""
    if n == 0: return [0, 0]
    denom = 1 + z**2/n
    center = (p + z**2/(2*n)) / denom
    spread = z * np.sqrt(p*(1-p)/n + z**2/(4*n**2)) / denom
    return [max(0, center - spread), min(1, center + spread)]

def compute_bias_metrics(df, target_col, sensitive_col, predictions, threshold=0.1):
    """Calculates multiple fairness metrics."""
    groups = df[sensitive_col].unique()
    y_true = df[target_col]
    
    df_eval = pd.DataFrame({
        'group': df[sensitive_col],
        'target': y_true,
        'prediction': predictions
    })
    
    # Identify the majority group (one with highest selection rate) for 4/5ths rule
    selection_rates = {}
    tpr_rates = {}
    fpr_rates = {}
    
    for g in groups:
        group_df = df_eval[df_eval['group'] == g]
        if len(group_df) > 0:
            # Selection Rate
            n = len(group_df)
            p = float(group_df['prediction'].mean())
            selection_rates[str(g)] = {
                "rate": p,
                "count": n,
                "ci": calculate_wilson_ci(p, n)
            }
            
            # TPR (True Positive Rate) - P(pred=1 | actual=1)
            positives = group_df[group_df['target'] == 1]
            if len(positives) > 0:
                tpr_rates[str(g)] = float(positives['prediction'].mean())
            else:
                tpr_rates[str(g)] = 0.0
                
            # FPR (False Positive Rate) - P(pred=1 | actual=0)
            negatives = group_df[group_df['target'] == 0]
            if len(negatives) > 0:
                fpr_rates[str(g)] = float(negatives['prediction'].mean())
            else:
                fpr_rates[str(g)] = 0.0
        else:
            selection_rates[str(g)] = {"rate": 0.0, "count": 0, "ci": [0, 0]}
            tpr_rates[str(g)] = 0.0
            fpr_rates[str(g)] = 0.0
            
    if not selection_rates:
         return {"error": "No groups found"}

    # 1. Demographic Parity Gap
    rates_vals = [r['rate'] for r in selection_rates.values()]
    dp_gap = max(rates_vals) - min(rates_vals)
    
    # 2. Equal Opportunity Gap (TPR diff)
    eo_gap = max(tpr_rates.values()) - min(tpr_rates.values())
    
    # 3. Equalized Odds Gap (Avg of TPR diff and FPR diff)
    fpr_gap = max(fpr_rates.values()) - min(fpr_rates.values())
    odds_gap = (eo_gap + fpr_gap) / 2
    
    # 4. EEOC 4/5ths Rule (Ratio)
    # Ratio of min selection rate to max selection rate
    advantaged_group = max(selection_rates, key=lambda k: selection_rates[k]['rate'])
    advantaged_rate = selection_rates[advantaged_group]['rate']
    
    impact_ratios = {}
    for g, r_obj in selection_rates.items():
        rate = r_obj['rate']
        if advantaged_rate > 0:
            impact_ratios[g] = rate / advantaged_rate
        else:
            impact_ratios[g] = 1.0
            
    min_impact_ratio = min(impact_ratios.values())
    
    # Status badges
    status_dp = "PASS" if dp_gap <= threshold else "FAIL"
    status_eo = "PASS" if eo_gap <= threshold else "FAIL"
    status_eeoc = "PASS" if min_impact_ratio >= 0.8 else "FAIL"
    
    return {
        "status": "FAIL" if (status_dp == "FAIL" or status_eeoc == "FAIL") else "PASS",
        "demographic_parity": {
            "gap": float(dp_gap),
            "status": status_dp,
            "rates": selection_rates
        },
        "equal_opportunity": {
            "gap": float(eo_gap),
            "status": status_eo,
            "rates": tpr_rates
        },
        "equalized_odds": {
            "gap": float(odds_gap),
            "status": "PASS" if odds_gap <= threshold else "FAIL"
        },
        "eeoc_rule": {
            "ratio": float(min_impact_ratio),
            "status": status_eeoc,
            "impact_ratios": impact_ratios
        },
        "demographic_parity_gap": float(dp_gap) # Legacy support
    }

def get_feature_importance(model, feature_names):
    """Extracts feature importance from the random forest."""
    importances = model.feature_importances_
    
    # Sort feature importances in descending order
    indices = np.argsort(importances)[::-1]
    
    # Rearrange feature names so they match the sorted feature importances
    names = [feature_names[i] for i in indices]
    
    return [{"feature": n, "importance": float(importances[i])} for i, n in zip(indices, names)]

def apply_reweighting(df, target_col, sensitive_col):
    """
    Applies reweighting mitigation.
    Calculates weights to equalize the probability of positive outcomes across groups.
    """
    groups = df[sensitive_col].unique()
    labels = df[target_col].unique()
    
    weights = np.ones(len(df))
    n_total = len(df)
    
    # Calculate W = (N(sensitive=s) * N(target=y)) / (N * N(sensitive=s, target=y))
    # This is standard reweighing for demographic parity
    for g in groups:
        for l in labels:
            n_s = len(df[df[sensitive_col] == g])
            n_y = len(df[df[target_col] == l])
            n_sy = len(df[(df[sensitive_col] == g) & (df[target_col] == l)])
            
            if n_sy > 0:
                weight = (n_s * n_y) / (n_total * n_sy)
                mask = (df[sensitive_col] == g) & (df[target_col] == l)
                weights[mask] = weight
                
    return weights
