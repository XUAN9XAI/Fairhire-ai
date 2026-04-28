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

def compute_bias_metrics(df, sensitive_col, predictions):
    """Calculates selection rate and demographic parity gap."""
    groups = df[sensitive_col].unique()
    metrics = {}
    
    df_eval = pd.DataFrame({
        'group': df[sensitive_col],
        'prediction': predictions
    })
    
    selection_rates = {}
    for g in groups:
        # Selection rate = Positive predictions / Total predictions for the group
        group_df = df_eval[df_eval['group'] == g]
        if len(group_df) > 0:
            rate = group_df['prediction'].mean()
            selection_rates[str(g)] = float(rate)
        else:
            selection_rates[str(g)] = 0.0
            
    if not selection_rates:
         return {"error": "No groups found"}

    max_rate = max(selection_rates.values())
    min_rate = min(selection_rates.values())
    
    gap = max_rate - min_rate
    
    # Bias score normalized (0 is perfect parity)
    bias_score = gap
    
    # Simple threshold: if gap > 0.1 (10%), it fails
    status = "FAIL" if gap > 0.1 else "PASS"
    
    return {
        "bias_score": float(bias_score),
        "status": status,
        "selection_rates": selection_rates,
        "demographic_parity_gap": float(gap)
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
