import React, { useState, useEffect } from "react";
import { MapContainer, TileLayer, Circle, Tooltip } from "react-leaflet";
import axios from "axios";
import { format } from "date-fns";
import "leaflet/dist/leaflet.css";
import "./App.css";

// API base URL - change to your deployed backend URL in production
const API_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

function App() {
  const [userLocation, setUserLocation] = useState(null);
  const [satelliteLocation, setSatelliteLocation] = useState(null);
  const [passes, setPasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Get user location on component mount
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setUserLocation({ lat: latitude, lng: longitude });
        },
        (err) => {
          console.error("Error getting location:", err);
          setError(
            "Failed to get your location. Please enable location access."
          );
          // Default to a fallback location
          setUserLocation({ lat: 40.7128, lng: -74.006 }); // New York City
        }
      );
    } else {
      setError("Geolocation is not supported by your browser");
      // Default to a fallback location
      setUserLocation({ lat: 40.7128, lng: -74.006 }); // New York City
    }
  }, []);

  // Fetch pass predictions when user location is available
  useEffect(() => {
    if (userLocation) {
      fetchPasses();
    }
  }, [userLocation]);

  // Fetch satellite location on an interval
  useEffect(() => {
    if (userLocation) {
      fetchSatelliteLocation();

      // Update satellite position every 5 seconds
      const intervalId = setInterval(fetchSatelliteLocation, 5000);

      return () => clearInterval(intervalId);
    }
  }, [userLocation]);

  const fetchPasses = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/api/passes`, {
        params: {
          lat: userLocation.lat,
          lon: userLocation.lng,
        },
      });
      setPasses(response.data);
      setLoading(false);
    } catch (err) {
      console.error("Error fetching passes:", err);
      setError("Failed to fetch satellite passes. Please try again later.");
      setLoading(false);
    }
  };

  const fetchSatelliteLocation = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/location/ISS`);
      setSatelliteLocation({
        lat: response.data.lat,
        lng: response.data.lon,
        alt: response.data.alt,
        name: response.data.name,
        timestamp: new Date(response.data.timestamp),
      });
    } catch (err) {
      console.error("Error fetching satellite location:", err);
    }
  };

  // Format time for display
  const formatTime = (timeString) => {
    try {
      return format(new Date(timeString), "h:mm a");
    } catch (e) {
      return "Invalid time";
    }
  };

  // Format date for display
  const formatDate = (timeString) => {
    try {
      return format(new Date(timeString), "MMM d");
    } catch (e) {
      return "Invalid date";
    }
  };

  // Return loading state if location or data is not yet available
  if (loading || !userLocation) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-blue-500"></div>
        <p className="mt-4 text-lg">Loading Zenith...</p>
        {error && <p className="mt-2 text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 shadow-lg p-4">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-blue-400">
            ⛰ Zenith
          </h1>
          <p className="text-sm md:text-base text-gray-300">
            Real-time Satellite Tracker
          </p>
        </div>
      </header>

      <main className="container mx-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Map Container */}
          <div className="lg:col-span-2 bg-gray-800 rounded-lg shadow-lg overflow-hidden h-[500px]">
            <MapContainer
              center={[userLocation.lat, userLocation.lng]}
              zoom={3}
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {/* User Location Marker */}
              <Circle
                center={[userLocation.lat, userLocation.lng]}
                radius={100000}
                pathOptions={{
                  color: "green",
                  fillColor: "green",
                  fillOpacity: 0.5,
                }}
              >
                <Tooltip permanent>Your Location</Tooltip>
              </Circle>

              {/* Satellite Location Marker */}
              {satelliteLocation && (
                <Circle
                  center={[satelliteLocation.lat, satelliteLocation.lng]}
                  radius={50000}
                  pathOptions={{
                    color: "red",
                    fillColor: "red",
                    fillOpacity: 0.8,
                  }}
                >
                  <Tooltip permanent>
                    {satelliteLocation.name}
                    <br />
                    Alt: {Math.round(satelliteLocation.alt)} km
                    <br />
                    {format(satelliteLocation.timestamp, "HH:mm:ss")}
                  </Tooltip>
                </Circle>
              )}
            </MapContainer>
          </div>

          {/* Pass Predictions Panel */}
          <div className="bg-gray-800 rounded-lg shadow-lg p-4">
            <h2 className="text-xl font-semibold mb-4 text-blue-300">
              Upcoming ISS Passes
            </h2>

            {passes.length > 0 ? (
              <div className="space-y-4">
                {passes.map((pass, index) => (
                  <div
                    key={index}
                    className="border border-gray-700 rounded-lg p-3 bg-gray-800 hover:bg-gray-700 transition"
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-lg font-medium">
                        {formatDate(pass.start_time)}
                      </span>
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          pass.visibility_score > 0.7
                            ? "bg-green-900 text-green-200"
                            : pass.visibility_score > 0.4
                            ? "bg-yellow-900 text-yellow-200"
                            : "bg-red-900 text-red-200"
                        }`}
                      >
                        Visibility: {Math.round(pass.visibility_score * 100)}%
                      </span>
                    </div>

                    <div className="flex justify-between text-sm text-gray-300">
                      <div>
                        <p>Rise: {formatTime(pass.start_time)}</p>
                        <p>Max: {formatTime(pass.max_time)}</p>
                        <p>Set: {formatTime(pass.end_time)}</p>
                      </div>
                      <div className="text-right">
                        <p>
                          Duration:{" "}
                          {Math.round(
                            (new Date(pass.end_time) -
                              new Date(pass.start_time)) /
                              60000
                          )}{" "}
                          min
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400">
                No visible ISS passes in the next 24 hours for your location.
              </p>
            )}

            <button
              onClick={fetchPasses}
              className="mt-4 w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
            >
              Refresh Passes
            </button>
          </div>
        </div>

        {/* Information Section */}
        <div className="mt-8 bg-gray-800 rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold mb-4 text-blue-300">
            About Zenith
          </h2>
          <p className="text-gray-300 mb-4">
            Zenith makes real-time satellite tracking accessible, educational,
            and beautiful. Watch as the International Space Station orbits above
            you in real-time, and see when it will next be visible from your
            location.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="bg-gray-700 p-3 rounded-lg">
              <h3 className="font-medium text-blue-300 mb-2">
                What am I seeing?
              </h3>
              <p className="text-gray-300">
                The map shows the current position of the ISS as it orbits Earth
                at approximately 28,000 km/h. The table shows upcoming passes
                visible from your location.
              </p>
            </div>
            <div className="bg-gray-700 p-3 rounded-lg">
              <h3 className="font-medium text-blue-300 mb-2">
                How to spot the ISS
              </h3>
              <p className="text-gray-300">
                The ISS looks like a bright, fast-moving star. It's best seen at
                night when the sky is clear. Check the visibility score - higher
                is better!
              </p>
            </div>
            <div className="bg-gray-700 p-3 rounded-lg">
              <h3 className="font-medium text-blue-300 mb-2">Data Source</h3>
              <p className="text-gray-300">
                Orbital data comes from Celestrak and calculations are performed
                using the Skyfield library. Your location is used only for pass
                calculations.
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="bg-gray-800 mt-8 py-4 text-center text-gray-400 text-sm">
        <div className="container mx-auto">
          <p>⛰ Zenith Satellite Tracker | {new Date().getFullYear()}</p>
          <p className="mt-1">Made with ❤️ for space enthusiasts everywhere</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
