import pickle
import numpy as np
import pandas as pd

# Tell pandas to print all columns clearly without truncation
pd.set_option('display.max_columns', None)
pd.set_option('display.width', 1000)

# ---------------------------------------------------------
# STEP 1: Master Domain Inventory
# ---------------------------------------------------------

domain_groups = {
    "Technical / Core Engineering": [
        "AI/ML", "Data Science", "Web Development", "App Development",
        "Cybersecurity", "Blockchain/Web3", "Cloud Computing", "DevOps",
        "Embedded Systems/IoT", "Robotics", "Computer Vision", "NLP",
        "Game Development", "AR/VR", "Competitive Programming",
        "Open Source", "Electronics/Circuit Design", "Mechanical Design",
        "Civil/Structural Engineering", "Automation",
    ],
    "Business, Finance & Management": [
        "Fintech", "Algorithmic Trading", "Entrepreneurship/Startups",
        "Marketing", "Digital Marketing", "Sales", "Business Analytics",
        "Product Management", "Consulting", "Supply Chain/Operations",
        "Human Resources", "Investment Banking", "Venture Capital", "E-commerce",
    ],
    "Design & Creative": [
        "UI/UX Design", "Graphic Design", "Animation", "Video Editing",
        "Photography", "Fashion Design", "Interior Design",
        "Content Writing", "Creative Writing", "Illustration/Art",
    ],
    "Communication & Soft Skills": [
        "Public Speaking", "Debate", "Model United Nations (MUN)",
        "Journalism", "Anchoring/Hosting", "Leadership",
        "Teaching/Mentorship", "Event Management",
    ],
    "Performing Arts & Culture": [
        "Dance", "Music", "Theatre/Drama", "Stand-up Comedy",
        "Fine Arts", "Literature/Poetry", "Film Making",
    ],
    "Sports & Fitness": [
        "Cricket", "Football", "Basketball", "Athletics/Track & Field",
        "Chess", "Esports/Gaming", "Yoga/Fitness", "Adventure Sports",
    ],
    "Social Impact & Culture": [
        "Social Work/NGO", "Sustainability/Environment", "Community Service",
        "Cultural Heritage", "Diversity & Inclusion", "Mental Health Awareness",
    ],
    "Science & Research": [
        "Physics", "Chemistry", "Biology/Biotech", "Mathematics/Statistics",
        "Astronomy", "Research & Academia", "Quantum Computing",
    ],
    "Competition Formats": [
        "Hackathon", "Case Study Competition", "Quiz/Trivia",
        "Debate Competition", "Ideathon", "Business Plan Competition",
        "Coding Contest", "Design Challenge", "Talent Show",
    ],
}

all_domains = [domain for group in domain_groups.values() for domain in group]

def encode(domain_list):
    """Encodes domains directly into binary multi-hot vectors."""
    domain_set = set(domain_list)
    return np.array([1 if domain in domain_set else 0 for domain in all_domains])

# ---------------------------------------------------------
# STEP 2: In-Memory Storage
# ---------------------------------------------------------
events_db = []
volunteers_db = []

def add_event(event_id, title, organizer_selected_domains):
    vector = encode(organizer_selected_domains)
    events_db.append({
        "event_id": event_id,
        "title": title,
        "domains": organizer_selected_domains,
        "vector": vector
    })

def add_volunteer(volunteer_id, name, user_selected_domains):
    vector = encode(user_selected_domains)
    volunteers_db.append({
        "volunteer_id": volunteer_id,
        "name": name,
        "domains": user_selected_domains,
        "vector": vector
    })

# ---------------------------------------------------------
# STEP 3: Profile Interest Update Function
# ---------------------------------------------------------

def update_volunteer_interests(volunteer_id, new_selected_domains):
    """Allows an attendee to update their domain interests directly."""
    volunteer = next((v for v in volunteers_db if v["volunteer_id"] == volunteer_id), None)
    if volunteer:
        volunteer["domains"] = new_selected_domains
        volunteer["vector"] = encode(new_selected_domains)
        print(f"\n[Profile Updated] {volunteer['name']}'s interests updated to: {new_selected_domains}")
    else:
        print(f"\nVolunteer ID {volunteer_id} not found.")

# ---------------------------------------------------------
# STEP 4: Pure Vector Matching Logic
# ---------------------------------------------------------

def suggest_events_for_volunteer(volunteer_id, top_n=5):
    volunteer = next((v for v in volunteers_db if v["volunteer_id"] == volunteer_id), None)
    if not volunteer or not events_db:
        return pd.DataFrame()

    vol_vector = volunteer["vector"]
    results = []

    for event in events_db:
        event_vector = event["vector"]
        
        # Multiply vectors directly element-by-element
        overlap_vector = vol_vector * event_vector
        overlap_count = np.sum(overlap_vector)
        
        # Map active vector positions back to domain names
        matched_domains = [all_domains[i] for i in range(len(all_domains)) if overlap_vector[i] == 1]

        if overlap_count > 0:
            results.append({
                "event_id": event["event_id"],
                "title": event["title"],
                "matched_domains": matched_domains,
                "matches": overlap_count
            })

    df = pd.DataFrame(results)
    if df.empty:
        return df

    df = df.sort_values(by="matches", ascending=False)
    return df[["event_id", "title", "matched_domains", "matches"]].head(top_n)

# ---------------------------------------------------------
# STEP 5: Execution Demo & PKL Saving
# ---------------------------------------------------------

if __name__ == "__main__":
    # Save PKL File
    ml_artifact = {
        "all_domains": all_domains,
        "total_domains": len(all_domains),
        "domain_groups": domain_groups
    }

    with open("master_domains.pkl", "wb") as f:
        pickle.dump(ml_artifact, f)

    print(f"[ML Pipeline Complete] Successfully saved 'master_domains.pkl' ({len(all_domains)} domains).\n")

    # Populate Sample Events
    add_event(1, "AI Hackathon", ["AI/ML", "Data Science", "Hackathon"])
    add_event(2, "Fintech Meetup", ["Fintech", "AI/ML", "Entrepreneurship/Startups"])
    add_event(3, "UI/UX Design Sprint", ["UI/UX Design", "Design Challenge"])
    add_event(4, "Public Speaking 101", ["Public Speaking", "Leadership"])
    add_event(5, "Sustainability Summit", ["Sustainability/Environment", "Social Work/NGO"])

    # Register Riya
    add_volunteer(102, "Riya", ["UI/UX Design", "Design Challenge", "Content Writing"])

    print("--- Initial Recommendations for Riya ---")
    print(suggest_events_for_volunteer(102))

    # Update Riya's Interests
    update_volunteer_interests(102, ["UI/UX Design", "Public Speaking", "Leadership"])

    print("\n--- Updated Recommendations for Riya (After Profile Change) ---")
    print(suggest_events_for_volunteer(102))