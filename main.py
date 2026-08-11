from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List
import pickle
import numpy as np

app = FastAPI(title="Event Recommendation Engine API")

ALL_DOMAINS = []

# ---------------------------------------------------------
# STEP 1: Load PKL Artifact on Server Startup
# ---------------------------------------------------------

@app.on_event("startup")
def load_ml_artifact():
    global ALL_DOMAINS
    try:
        with open("master_domains.pkl", "rb") as f:
            data = pickle.load(f)
            ALL_DOMAINS = data["all_domains"]
        print(f"[FastAPI Ready] Loaded {len(ALL_DOMAINS)} master domains from master_domains.pkl")
    except FileNotFoundError:
        print("[ERROR] master_domains.pkl missing! Run 'python build_ml_pipeline.py' first.")

def encode_domains(domain_list: List[str]) -> np.ndarray:
    domain_set = set(domain_list)
    return np.array([1 if d in domain_set else 0 for d in ALL_DOMAINS])

# In-memory storage for active session
events_db = []
volunteers_db = []

# Data Schemas
class EventCreate(BaseModel):
    event_id: int
    title: str
    domains: List[str]

class VolunteerCreate(BaseModel):
    volunteer_id: int
    name: str
    domains: List[str]

class VolunteerUpdate(BaseModel):
    domains: List[str]

class VectorRequest(BaseModel):
    vector: List[int]

# ---------------------------------------------------------
# STEP 2: REST API Endpoints
# ---------------------------------------------------------

@app.get("/")
def root():
    return {"status": "Active", "total_domains": len(ALL_DOMAINS)}

@app.post("/events/create", status_code=201)
def create_event(event: EventCreate):
    vector = encode_domains(event.domains)
    events_db.append({
        "event_id": event.event_id,
        "title": event.title,
        "domains": event.domains,
        "vector": vector
    })
    return {"status": "Event created", "event_id": event.event_id, "title": event.title, "domains": event.domains}

@app.post("/volunteers/register", status_code=201)
def register_volunteer(volunteer: VolunteerCreate):
    vector = encode_domains(volunteer.domains)
    volunteers_db.append({
        "volunteer_id": volunteer.volunteer_id,
        "name": volunteer.name,
        "domains": volunteer.domains,
        "vector": vector
    })
    return {"status": "Volunteer registered", "volunteer_id": volunteer.volunteer_id, "domains": volunteer.domains}

@app.put("/volunteers/{volunteer_id}/update-interests")
def update_interests(volunteer_id: int, payload: VolunteerUpdate):
    volunteer = next((v for v in volunteers_db if v["volunteer_id"] == volunteer_id), None)
    if not volunteer:
        raise HTTPException(status_code=404, detail="Volunteer not found")
    
    volunteer["domains"] = payload.domains
    volunteer["vector"] = encode_domains(payload.domains)
    return {"status": "Interests updated", "volunteer_id": volunteer_id, "domains": payload.domains}

@app.get("/volunteers/{volunteer_id}/recommendations")
def get_recommendations(volunteer_id: int, top_n: int = 5):
    volunteer = next((v for v in volunteers_db if v["volunteer_id"] == volunteer_id), None)
    if not volunteer:
        raise HTTPException(status_code=404, detail="Volunteer not found")

    if not events_db:
        return {"recommendations": []}

    vol_vector = volunteer["vector"]
    results = []

    for event in events_db:
        overlap = vol_vector * event["vector"]
        match_count = int(np.sum(overlap))
        
        # Convert overlap indices to string domain names via PKL lookup
        matched_domain_names = [ALL_DOMAINS[i] for i, bit in enumerate(overlap) if bit == 1]

        if match_count > 0:
            results.append({
                "event_id": event["event_id"],
                "title": event["title"],
                "matched_domains": matched_domain_names,
                "matches": match_count
            })

    results.sort(key=lambda x: x["matches"], reverse=True)

    return {
        "volunteer_id": volunteer_id,
        "volunteer_name": volunteer["name"],
        "user_interests": volunteer["domains"],
        "recommendations": results[:top_n]
    }

@app.post("/vector-to-domains")
def convert_vector_to_domains(payload: VectorRequest):
    """Converts a raw binary vector into human-readable domain name strings."""
    vec = payload.vector
    if len(vec) != len(ALL_DOMAINS):
        raise HTTPException(
            status_code=400,
            detail=f"Expected vector length {len(ALL_DOMAINS)}, got {len(vec)}"
        )

    domain_names = [ALL_DOMAINS[i] for i, bit in enumerate(vec) if bit == 1]
    return {"matched_domains": domain_names}