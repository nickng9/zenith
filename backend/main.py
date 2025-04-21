import os
import time
from datetime import datetime, timedelta
import sqlite3
import uuid
import json
from typing import List, Optional

import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np
from skyfield.api import load, wgs84, EarthSatellite
from skyfield.timelib import Time

app = FastAPI(title="Zenith API", description="Satellite tracking and pass prediction API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database setup
DB_PATH = os.environ.get("DB_PATH", "zenith.db")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create TLE cache table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS TLECache (
        satellite_id TEXT PRIMARY KEY,
        name TEXT,
        line1 TEXT,
        line2 TEXT,
        last_updated DATETIME
    )
    """)
    
    # Create pass prediction table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS PassPrediction (
        pass_id TEXT PRIMARY KEY,
        satellite_id TEXT,
        start_time DATETIME,
        max_time DATETIME,
        end_time DATETIME,
        visibility_score FLOAT
    )
    """)
    
    # Create user observer table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS UserObserver (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lat FLOAT,
        lon FLOAT,
        timestamp DATETIME
    )
    """)
    
    conn.commit()
    conn.close()

# Initialize DB on startup
init_db()

# Models
class TLECacheEntry(BaseModel):
    satellite_id: str
    name: str
    line1: str
    line2: str
    last_updated: datetime

class PassPrediction(BaseModel):
    pass_id: str
    satellite_id: str
    start_time: datetime
    max_time: datetime
    end_time: datetime
    visibility_score: float

class UserObserver(BaseModel):
    lat: float
    lon: float
    timestamp: datetime

class SatelliteLocation(BaseModel):
    satellite_id: str
    name: str
    lat: float
    lon: float
    alt: float
    timestamp: datetime

class PassPredictionResponse(BaseModel):
    start_time: datetime
    max_time: datetime
    end_time: datetime
    visibility_score: float

# TLE data management
def fetch_tle_data():
    """Fetch TLE data from Celestrak and update the cache"""
    satellites = [
        {"id": "ISS", "name": "International Space Station", "url": "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle"}
    ]
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    for sat in satellites:
        try:
            response = requests.get(sat["url"])
            if response.status_code == 200:
                lines = response.text.strip().split('\n')
                if len(lines) >= 3:
                    name = lines[0].strip()
                    line1 = lines[1].strip()
                    line2 = lines[2].strip()
                    
                    # Update or insert TLE data
                    cursor.execute(
                        "INSERT OR REPLACE INTO TLECache (satellite_id, name, line1, line2, last_updated) VALUES (?, ?, ?, ?, ?)",
                        (sat["id"], name, line1, line2, datetime.utcnow())
                    )
        except Exception as e:
            print(f"Error fetching TLE for {sat['id']}: {str(e)}")
    
    conn.commit()
    conn.close()

def get_tle_data(satellite_id: str):
    """Get TLE data from the cache, fetch if needed or expired"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM TLECache WHERE satellite_id = ?", (satellite_id,))
    result = cursor.fetchone()
    
    if not result or (datetime.utcnow() - datetime.fromisoformat(result[4])) > timedelta(hours=24):
        conn.close()
        fetch_tle_data()
        
        # Try again after fetching
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM TLECache WHERE satellite_id = ?", (satellite_id,))
        result = cursor.fetchone()
        
    conn.close()
    
    if not result:
        raise HTTPException(status_code=404, detail=f"TLE data for satellite {satellite_id} not found")
    
    return {
        "satellite_id": result[0],
        "name": result[1],
        "line1": result[2],
        "line2": result[3],
        "last_updated": result[4]
    }

# Satellite pass prediction
def calculate_passes(lat: float, lon: float, satellite_id: str = "ISS"):
    """Calculate satellite passes for the given location"""
    # Load time scale and location
    ts = load.timescale()
    location = wgs84.latlon(lat, lon)
    
    # Get TLE data
    tle_data = get_tle_data(satellite_id)
    
    # Create satellite object
    satellite = EarthSatellite(tle_data["line1"], tle_data["line2"], tle_data["name"], ts)
    
    # Define time span (next 24 hours)
    t0 = ts.now()
    t1 = ts.utc(t0.utc_datetime() + timedelta(hours=24))
    
    # Find satellite passes
    t, events = satellite.find_events(location, t0, t1, altitude_degrees=10.0)
    
    # Process and format pass results
    passes = []
    current_pass = {}
    
    for ti, event in zip(t, events):
        time_utc = ti.utc_datetime()
        
        if event == 0:  # Rise above horizon
            current_pass = {"start_time": time_utc}
        elif event == 1 and current_pass:  # Maximum elevation
            current_pass["max_time"] = time_utc
        elif event == 2 and "start_time" in current_pass and "max_time" in current_pass:  # Set below horizon
            current_pass["end_time"] = time_utc
            
            # Calculate visibility score based on max elevation
            time_diff = (current_pass["end_time"] - current_pass["start_time"]).total_seconds() / 60
            if time_diff > 3:  # Only count passes longer than 3 minutes
                difference = satellite - location
                topocentric = difference.at(ts.from_datetime(current_pass["max_time"]))
                alt, az, distance = topocentric.altaz()
                
                # Calculate visibility score (0-1) based on elevation and pass duration
                visibility = min(1.0, (alt.degrees / 90) * (time_diff / 10))
                
                current_pass["visibility_score"] = round(visibility, 2)
                passes.append(current_pass)
            
            current_pass = {}
    
    return passes

# API Endpoints
@app.get("/api/passes", response_model=List[PassPredictionResponse])
async def get_passes(lat: float = Query(...), lon: float = Query(...), satellite_id: str = "ISS"):
    """Get upcoming visible satellite passes for a location"""
    # Save observer location
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO UserObserver (lat, lon, timestamp) VALUES (?, ?, ?)",
        (lat, lon, datetime.utcnow())
    )
    conn.commit()
    conn.close()
    
    # Calculate passes
    try:
        passes = calculate_passes(lat, lon, satellite_id)
        return passes
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating passes: {str(e)}")

@app.get("/api/location/{satellite_id}", response_model=SatelliteLocation)
async def get_satellite_location(satellite_id: str):
    """Get current location of a satellite"""
    try:
        # Get TLE data
        tle_data = get_tle_data(satellite_id)
        
        # Load time scale
        ts = load.timescale()
        t = ts.now()
        
        # Create satellite object
        satellite = EarthSatellite(tle_data["line1"], tle_data["line2"], tle_data["name"], ts)
        
        # Get current position
        geocentric = satellite.at(t)
        subpoint = wgs84.subpoint(geocentric)
        
        return {
            "satellite_id": satellite_id,
            "name": tle_data["name"],
            "lat": subpoint.latitude.degrees,
            "lon": subpoint.longitude.degrees,
            "alt": subpoint.elevation.km,
            "timestamp": t.utc_datetime()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting satellite location: {str(e)}")

@app.get("/")
async def root():
    """API health check"""
    return {"status": "online", "message": "Zenith API is running"}

# Initialize TLE data on startup
@app.on_event("startup")
async def startup_event():
    fetch_tle_data()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)