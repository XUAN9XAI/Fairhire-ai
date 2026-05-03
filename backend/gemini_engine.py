import os
import time
import signal
from google import genai
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

# Thread pool for timeout enforcement
_executor = ThreadPoolExecutor(max_workers=2)

# Initialize client. It will automatically use the GEMINI_API_KEY environment variable.
def get_client():
    try:
        if "GEMINI_API_KEY" in os.environ and os.environ["GEMINI_API_KEY"]:
            return genai.Client()
        return None
    except Exception as e:
        print(f"Error initializing Gemini client: {e}")
        return None

# Model preference order — try gemini-2.5-flash first, then fall back
MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite"]

GEMINI_TIMEOUT_SECONDS = 2

def _call_gemini(client, prompt, max_retries=1):
    """Call Gemini with retry, model fallback, and 2-second timeout."""
    for model_name in MODELS:
        for attempt in range(max_retries + 1):
            try:
                future = _executor.submit(
                    client.models.generate_content,
                    model=model_name,
                    contents=prompt,
                )
                response = future.result(timeout=GEMINI_TIMEOUT_SECONDS)
                return response.text
            except FuturesTimeoutError:
                print(f"Gemini timeout (model={model_name}, attempt={attempt+1}): exceeded {GEMINI_TIMEOUT_SECONDS}s")
                break  # Try next model immediately
            except Exception as e:
                err_str = str(e)
                print(f"Gemini API Error (model={model_name}, attempt={attempt+1}): {err_str[:200]}")
                
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                    if attempt < max_retries:
                        time.sleep(1)
                        continue
                    else:
                        break
                else:
                    break
    
    return None  # All models failed


def explain_bias(metrics):
    """Generates a plain-English explanation of the bias metrics."""
    # Extract selection rates from the new nested structure
    dp = metrics.get('demographic_parity', {})
    rates = dp.get('rates', {})
    # rates is now {group: {rate, count, ci}} — extract flat rates
    flat_rates = {}
    for k, v in rates.items():
        if isinstance(v, dict):
            flat_rates[k] = v.get('rate', 0)
        else:
            flat_rates[k] = v
    
    dp_gap = metrics.get('demographic_parity_gap', 0)
    status = metrics.get('status', 'UNKNOWN')
    
    rates_str = ", ".join([f"{k}: {v:.1%}" for k, v in flat_rates.items()])
    fallback = f"Bias analysis complete. The demographic parity gap is {dp_gap:.1%}. Selection rates are: {rates_str}. "
    
    if status == 'FAIL':
        sorted_rates = sorted(flat_rates.items(), key=lambda x: x[1], reverse=True)
        fallback += f"The group '{sorted_rates[0][0]}' has a significantly higher selection rate ({sorted_rates[0][1]:.1%}) compared to '{sorted_rates[-1][0]}' ({sorted_rates[-1][1]:.1%}). This indicates potential discrimination in the hiring process."
    else:
        fallback += "The gap is within acceptable limits, suggesting relatively fair outcomes across groups."
    
    client = get_client()
    if not client:
        return fallback

    prompt = f"""
    You are an AI fairness expert evaluating a hiring model.

    Explain the following bias result in simple, human-friendly language for a non-technical HR audience.

    Data:
    - Status: {status}
    - Gap (Difference in selection rates): {dp_gap * 100:.1f}%
    - Selection Rates by Group:
    """
    for group, rate in flat_rates.items():
         prompt += f"  - {group}: {rate * 100:.1f}%\n"

    prompt += """
    Explain:
    1. What is happening (which group is favored)
    2. Why it is unfair
    3. Real-world impact (e.g., hiring discrimination in India)
    4. Keep it strictly under 100 words. No technical jargon.
    """

    result = _call_gemini(client, prompt)
    return result if result else fallback


def simulate_whatif(candidate_data, current_prediction, sensitive_col, target_group, metrics):
    """Simulates what would happen if the candidate belonged to a different group.
    Anchored to actual computed probability differences."""
    pred_str = "Hired" if current_prediction == 1 else "Rejected"
    gap_pct = metrics['demographic_parity_gap'] * 100
    
    # Extract anchored values if available
    group_probs = metrics.get('group_probs', {})
    delta = metrics.get('delta', 0)
    delta_pct = abs(delta * 100)
    direction = "increase" if delta > 0 else "decrease"
    
    # Build anchored fallback with real numbers
    prob_str = ", ".join([f"{g}: {p:.0%}" for g, p in group_probs.items()]) if group_probs else ""
    
    fallback = f"Based on our bias analysis, this candidate was {pred_str}. "
    if prob_str:
        fallback += f"Group hiring rates are: {prob_str}. "
    if current_prediction == 0:
        fallback += f"If their '{sensitive_col}' were changed to '{target_group}', their probability of being hired would {direction} by approximately {delta_pct:.1f}%. "
        fallback += f"This reflects the {gap_pct:.1f}% demographic parity gap driven by proxy variables like employment gaps and location."
    else:
        fallback += f"If their '{sensitive_col}' were changed to '{target_group}', the outcome might remain the same, but the probability would shift by {delta_pct:.1f}% due to systemic bias."
    
    client = get_client()
    if not client:
        return fallback

    candidate_str = "\n".join([f"- {k}: {v}" for k, v in candidate_data.items() if k not in ['candidate_id', 'hired']])

    prompt = f"""
    You are an AI fairness analyst. A candidate was evaluated by our hiring model.

    Candidate Details:
    {candidate_str}

    Model Prediction: {pred_str}
    Actual computed group hiring rates: {prob_str}
    Probability delta if group changed: {delta_pct:.1f}% {direction}
    Demographic parity gap: {gap_pct:.1f}%

    Simulate what would happen if this candidate's `{sensitive_col}` was changed to `{target_group}`.
    Use ONLY the numbers provided above. Do NOT invent new percentages.
    Explain clearly and ethically. Keep it under 60 words.
    """

    result = _call_gemini(client, prompt)
    return result if result else fallback


def analyze_root_cause(feature_importances):
    """Analyzes feature importance to find proxy variables."""
    top_features = [f['feature'] for f in feature_importances[:3]]
    fallback = f"The model relies heavily on: {', '.join(top_features)}. "
    fallback += "Features like 'employment_gap_years' can disproportionately penalize women returning to work after caregiving. "
    fallback += "'english_proficiency' and 'city' often correlate with socioeconomic background rather than job competence, acting as proxy variables that secretly encode demographic bias."
    
    client = get_client()
    if not client:
        return fallback

    feats_str = "\n".join([f"- {f['feature']}: {f['importance']:.3f}" for f in feature_importances[:5]])
    
    prompt = f"""
    You are an AI fairness auditor. We removed direct sensitive attributes (like Gender or City) from our hiring model, but it still shows bias. 
    Here are the top features the model is relying on (Feature Importance):

    {feats_str}

    Explain how these specific features might act as "proxy variables" that secretly encode bias. 
    For example, do 'employment_gap_years' disproportionately affect women returning to work?
    Keep the explanation brief (under 80 words) and insightful.
    """

    result = _call_gemini(client, prompt)
    return result if result else fallback
