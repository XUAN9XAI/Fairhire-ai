import os
from typing import Optional, List, Dict

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

class Database:
    def __init__(self):
        self.enabled = False
        if SUPABASE_URL and SUPABASE_KEY:
            try:
                from supabase import create_client
                self.client = create_client(SUPABASE_URL, SUPABASE_KEY)
                self.enabled = True
                print("Supabase connected.")
            except ImportError:
                print("supabase package not installed. Running in local-only mode.")
            except Exception as e:
                print(f"Supabase connection failed: {e}")
        else:
            print("Supabase credentials missing. Running in local-only mode.")

    def save_dataset(self, filename: str, content: List[Dict], target: str, sensitive: str) -> Optional[str]:
        if not self.enabled:
            return "local-id"
        try:
            data = {
                "filename": filename,
                "content": content,
                "target_col": target,
                "sensitive_col": sensitive
            }
            res = self.client.table("datasets").insert(data).execute()
            return res.data[0]["id"]
        except Exception as e:
            print(f"DB Error (save_dataset): {e}")
            return "local-id"

    def save_audit(self, dataset_id: str, metrics: Dict, feature_importance: List, explanation: str, threshold: float):
        if not self.enabled:
            return
        try:
            data = {
                "dataset_id": dataset_id if dataset_id != "local-id" else None,
                "metrics": metrics,
                "feature_importance": feature_importance,
                "ai_explanation": explanation,
                "threshold": threshold
            }
            self.client.table("audits").insert(data).execute()
        except Exception as e:
            print(f"DB Error (save_audit): {e}")

    def get_history(self) -> List[Dict]:
        if not self.enabled:
            return []
        try:
            res = self.client.table("audits").select("*, datasets(filename)").order("created_at", desc=True).execute()
            return res.data
        except Exception as e:
            print(f"DB Error (get_history): {e}")
            return []

db = Database()
