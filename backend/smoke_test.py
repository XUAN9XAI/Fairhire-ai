"""Smoke test for the FairHire AI backend."""
import sys
sys.path.insert(0, '.')

print("=" * 50)
print("FairHire AI Backend Smoke Test")
print("=" * 50)

# 1. Test imports
print("\n[1/5] Testing imports...")
try:
    from bias_engine import train_model, compute_bias_metrics, get_feature_importance, apply_reweighting
    from sample_data import get_sample_dataset
    from db import db
    from gemini_engine import explain_bias, analyze_root_cause
    print("  OK - All modules imported successfully")
except Exception as e:
    print(f"  FAIL - Import error: {e}")
    sys.exit(1)

# 2. Test sample data
print("\n[2/5] Testing sample dataset...")
try:
    df = get_sample_dataset()
    print(f"  OK - {len(df)} rows, columns: {list(df.columns)}")
    print(f"  Gender distribution: {df['gender'].value_counts().to_dict()}")
    print(f"  Hired distribution: {df['hired'].value_counts().to_dict()}")
except Exception as e:
    print(f"  FAIL - {e}")
    sys.exit(1)

# 3. Test model training
print("\n[3/5] Testing model training...")
try:
    model, preds, encoders, features = train_model(df, 'hired', 'gender')
    print(f"  OK - Model trained. Features: {features}")
    print(f"  Predictions shape: {len(preds)}, unique vals: {set(preds)}")
except Exception as e:
    print(f"  FAIL - {e}")
    sys.exit(1)

# 4. Test metrics computation
print("\n[4/5] Testing bias metrics...")
try:
    metrics = compute_bias_metrics(df, 'hired', 'gender', preds)
    print(f"  OK - Status: {metrics['status']}")
    print(f"  DP Gap: {metrics['demographic_parity_gap']:.3f}")
    print(f"  Equal Opportunity Gap: {metrics['equal_opportunity']['gap']:.3f}")
    print(f"  EEOC 4/5ths Ratio: {metrics['eeoc_rule']['ratio']:.3f}")
    dp_rates = metrics['demographic_parity']['rates']
    for g, r in dp_rates.items():
        print(f"    {g}: rate={r['rate']:.3f}, n={r['count']}, CI={[round(x,3) for x in r['ci']]}")
except Exception as e:
    print(f"  FAIL - {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# 5. Test Gemini explain fallback (no API key)
print("\n[5/5] Testing Gemini explain (fallback mode)...")
try:
    explanation = explain_bias(metrics)
    root_cause = analyze_root_cause(get_feature_importance(model, features))
    print(f"  OK - Explanation length: {len(explanation)} chars")
    print(f"  OK - Root cause length: {len(root_cause)} chars")
except Exception as e:
    print(f"  FAIL - {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# 6. Test mitigation
print("\n[BONUS] Testing mitigation reweighting...")
try:
    weights = apply_reweighting(df, 'hired', 'gender')
    model2, preds2, _, _ = train_model(df, 'hired', 'gender', sample_weight=weights)
    metrics_after = compute_bias_metrics(df, 'hired', 'gender', preds2)
    print(f"  OK - Before gap: {metrics['demographic_parity_gap']:.3f}")
    print(f"  OK - After gap:  {metrics_after['demographic_parity_gap']:.3f}")
    improvement = metrics['demographic_parity_gap'] - metrics_after['demographic_parity_gap']
    print(f"  OK - Improvement: {improvement:.3f}")
except Exception as e:
    print(f"  FAIL - {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\n" + "=" * 50)
print("ALL TESTS PASSED")
print("=" * 50)
