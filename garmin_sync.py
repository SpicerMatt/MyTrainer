"""Download recent Garmin activities locally using Garmin's official Personal API client."""
import csv
import json
from datetime import date, timedelta
from pathlib import Path

from garmin_personal_api import (
    GarminPersonalApiClient,
    PersonalApiAuthenticator,
    resolve_api_key,
)

DAYS = 90
OUTPUT = Path(__file__).resolve().parent / "garmin_data"


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    start_date = (date.today() - timedelta(days=DAYS)).isoformat()
    end_date = date.today().isoformat()

    key = resolve_api_key()
    with PersonalApiAuthenticator() as auth:
        token = auth.obtain_token(key)

    all_activities = []
    with GarminPersonalApiClient(token.access_token) as client:
        for start in range(0, 1000, 100):
            batch = client.search_activities(
                start=start, limit=100, start_date=start_date, end_date=end_date
            )
            if not batch:
                break
            if not isinstance(batch, list):
                raise ValueError("Unexpected Garmin activities response format")
            all_activities.extend(batch)
            if len(batch) < 100:
                break

        (OUTPUT / "activities.json").write_text(
            json.dumps(all_activities, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        rows = []
        for activity in all_activities:
            activity_id = activity.get("activityId")
            if not activity_id:
                continue
            try:
                detail = client.get_activity(activity_id)
                (OUTPUT / f"activity_{activity_id}.json").write_text(
                    json.dumps(detail, indent=2, ensure_ascii=False), encoding="utf-8"
                )
            except Exception as exc:
                print(f"Could not download details for {activity_id}: {exc}")
            rows.append({
                "id": activity_id,
                "date": activity.get("startTimeLocal", ""),
                "name": activity.get("activityName", ""),
                "type": (activity.get("activityType") or {}).get("typeKey", "")
                if isinstance(activity.get("activityType"), dict)
                else str(activity.get("activityType", "")),
                "distance_km": round((activity.get("distance") or 0) / 1000, 3),
                "duration_min": round((activity.get("duration") or 0) / 60, 2),
                "avg_hr": activity.get("averageHR", ""),
                "max_hr": activity.get("maxHR", ""),
                "cadence": activity.get("averageRunningCadenceInStepsPerMinute", ""),
                "elevation_gain_m": activity.get("elevationGain", ""),
            })

    with (OUTPUT / "activities.csv").open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "id", "date", "name", "type", "distance_km", "duration_min",
            "avg_hr", "max_hr", "cadence", "elevation_gain_m"
        ])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Downloaded {len(all_activities)} activities into {OUTPUT}")


if __name__ == "__main__":
    main()