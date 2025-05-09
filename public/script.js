const socket = io();
let map; // Declare only once at the top of your script
let drawnBox = null, tempBox = null;
let lobbyId, userName, isHost, updateInterval = 10000; // Default update interval set to 10 seconds (10000 ms)
let markers = {};
let locationUpdateIntervalId = null;
const boxList = []; // List of all boxes (usually only one is shown)

// --- UI Elements ---
const intervalControl = document.getElementById('intervalControl');
const userListElement = document.getElementById('userList');
const boxListElement = document.getElementById('boxList');
const clearBoxButton = document.getElementById('clearBoxButton');

// Add this function near the top of your script.js, before any usage of requestLocationPermission
function requestLocationPermission(callback) {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            position => {
                callback(position.coords.latitude, position.coords.longitude);
            },
            error => {
                alert("Location permission denied or unavailable.");
                callback(null, null);
            }
        );
    } else {
        alert("Geolocation is not supported by this browser.");
        callback(null, null);
    }
}

function joinLobby() {
    lobbyId = document.getElementById('lobbyId').value;
    userName = document.getElementById('userName').value;
    isHost = document.getElementById('isHost').checked;

    if (!lobbyId || !userName) return alert("Fill all fields!");

    socket.emit('joinLobby', { lobbyId, userName, isHost });
    if (isHost && intervalControl) intervalControl.style.display = 'block';
    initMap();
    startLocationUpdates(); // <-- Start sending location right away
}

// --- Map Initialization ---
function initMap() {
    if (map) return; // Prevent re-initialization

    const mapContainer = document.getElementById('map');
    if (!mapContainer || mapContainer.offsetHeight === 0) {
        console.error("Map container is not properly styled or visible.");
        return;
    }

    map = L.map('map', {
      gestureHandling: false,
      zoomControl: true,
      dragging: true,
      tap: false // IMPORTANT for fixing touch issues on mobile
    }).setView([0, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    addDrawingControl();
    addDeleteBoxControl();
}

document.addEventListener('DOMContentLoaded', () => {
    // Ensure the map container has a defined height
    const mapContainer = document.getElementById('map');
    if (mapContainer) {
        mapContainer.style.height = '100vh'; // Set the height to fill the viewport
        mapContainer.style.width = '100%';  // Ensure full width
    }

    // Request location permission
    requestLocationPermission();
});

// --- Drawing Controls ---
function addDrawingControl() {
    // Adds a button to enable drawing mode (host only)
    const DrawingControl = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: function () {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
            const button = L.DomUtil.create('a', '', container);
            button.innerHTML = '□';
            button.title = 'Draw Box';
            button.href = '#';
            // Style button
            button.style.width = button.style.height = '30px';
            button.style.lineHeight = '30px';
            button.style.textAlign = 'center';
            button.style.fontSize = '18px';

            // Show only for host
            function updateVisibility() {
                container.style.display = isHost ? '' : 'none';
            }
            updateVisibility();
            const hostCheckbox = document.getElementById('isHost');
            if (hostCheckbox) {
                hostCheckbox.addEventListener('change', function() {
                    isHost = this.checked;
                    updateVisibility();
                });
            }

            L.DomEvent.on(button, 'click', (e) => {
                L.DomEvent.stopPropagation(e);
                L.DomEvent.preventDefault(e);
                enableDrawingMode();
            });
            L.DomEvent.on(button, 'touchstart', (e) => {
                L.DomEvent.stopPropagation(e);
                L.DomEvent.preventDefault(e);
                enableDrawingMode();
            }, { passive: false });

            return container;
        }
    });
    map.addControl(new DrawingControl());
}

function addDeleteBoxControl() {
    // Adds a button to clear the drawn box
    const DeleteBoxControl = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: function () {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
            const button = L.DomUtil.create('a', '', container);
            button.innerHTML = '✖';
            button.title = 'Delete Box';
            button.href = '#';
            button.style.width = button.style.height = '30px';
            button.style.lineHeight = '30px';
            button.style.textAlign = 'center';
            button.style.fontSize = '18px';

            L.DomEvent.on(button, 'click', (e) => {
                L.DomEvent.stopPropagation(e);
                L.DomEvent.preventDefault(e);
                clearBox();
            });

            return container;
        }
    });
    map.addControl(new DeleteBoxControl());
}

// --- Drawing Logic (Leaflet only, one rectangle at a time) ---
function enableDrawingMode() {
    if (!isHost) return console.warn("Only the host can draw the playing area.");

    let drawing = false;
    let startLatLng = null;
    let rectangle = null;

    // Mouse events
    function onMouseDown(e) {
        drawing = true;
        startLatLng = e.latlng;
        if (rectangle) map.removeLayer(rectangle);
    }

    function onMouseMove(e) {
        if (!drawing || !startLatLng) return;
        const bounds = L.latLngBounds(startLatLng, e.latlng);
        if (rectangle) map.removeLayer(rectangle);
        rectangle = L.rectangle(bounds, { color: 'blue', weight: 2 }).addTo(map);
    }

    function onMouseUp(e) {
        drawing = false;
        if (rectangle) {
            const bounds = rectangle.getBounds();
            // Emit box bounds to server
            socket.emit('draw-rectangle', {
                southWest: bounds.getSouthWest(),
                northEast: bounds.getNorthEast()
            });
        }
        cleanup();
    }

    // Touch events
    function onTouchStart(e) {
        if (e.latlng) {
            drawing = true;
            startLatLng = e.latlng;
            if (rectangle) map.removeLayer(rectangle);
        }
    }

    function onTouchMove(e) {
        if (!drawing || !startLatLng || !e.latlng) return;
        const bounds = L.latLngBounds(startLatLng, e.latlng);
        if (rectangle) map.removeLayer(rectangle);
        rectangle = L.rectangle(bounds, { color: 'blue', weight: 2 }).addTo(map);
    }

    function onTouchEnd(e) {
        drawing = false;
        if (rectangle) {
            const bounds = rectangle.getBounds();
            // Emit box bounds to server
            socket.emit('draw-rectangle', {
                southWest: bounds.getSouthWest(),
                northEast: bounds.getNorthEast()
            });
        }
        cleanup();
    }

    function cleanup() {
        map.off('mousedown', onMouseDown);
        map.off('mousemove', onMouseMove);
        map.off('mouseup', onMouseUp);
        map.off('touchstart', onTouchStart);
        map.off('touchmove', onTouchMove);
        map.off('touchend', onTouchEnd);
        if (rectangle) {
            map.removeLayer(rectangle);
            rectangle = null;
        }
        document.body.classList.remove('no-scroll');
        map.dragging.enable();
        map.doubleClickZoom.enable();
        map.scrollWheelZoom.enable();
    }

    // Disable map interactions while drawing
    map.dragging.disable();
    map.doubleClickZoom.disable();
    map.scrollWheelZoom.disable();
    document.body.classList.add('no-scroll');

    map.on('mousedown', onMouseDown);
    map.on('mousemove', onMouseMove);
    map.on('mouseup', onMouseUp);
    map.on('touchstart', onTouchStart);
    map.on('touchmove', onTouchMove);
    map.on('touchend', onTouchEnd);
}

// --- Box Management ---
function addBoxToMap(boxBounds) {
    // Remove previous box
    if (drawnBox) map.removeLayer(drawnBox);
    drawnBox = L.rectangle([
        [boxBounds.southWest.lat, boxBounds.southWest.lng],
        [boxBounds.northEast.lat, boxBounds.northEast.lng]
    ], { color: 'red', weight: 2 }).addTo(map);
}

function clearBox() {
    // Remove any drawn box from map
    if (drawnBox) {
        map.removeLayer(drawnBox);
        drawnBox = null;
    }
    if (tempBox) {
        map.removeLayer(tempBox);
        tempBox = null;
    }
}

// --- Location Updates ---
function startLocationUpdates() {
    // Clear any existing location update interval
    if (locationUpdateIntervalId) {
        clearInterval(locationUpdateIntervalId);
        locationUpdateIntervalId = null;
    }

    if (navigator.geolocation) {
        // Send location immediately on start
        navigator.geolocation.getCurrentPosition(
            position => {
                const coords = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                socket.emit('locationUpdate', coords);
            },
            error => {
                console.error("Error retrieving location:", error.message);
                alert("Unable to retrieve location. Please ensure location services are enabled.");
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 10000
            }
        );

        // Continue sending location at intervals
        locationUpdateIntervalId = setInterval(() => {
            navigator.geolocation.getCurrentPosition(
                position => {
                    const coords = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    };

                    socket.emit('locationUpdate', coords);

                    // Check if user is outside the geofence boundaries
                    if (boxList.length > 0 && !isInsideGeofence({ location: coords })) {
                        showWarning("⚠️ You are outside the allowed area!");
                    } else {
                        hideWarning();
                    }
                },
                error => {
                    console.error("Error retrieving location:", error.message);
                    alert("Unable to retrieve location. Please ensure location services are enabled.");
                },
                {
                    enableHighAccuracy: true, // Use high accuracy for better results
                    maximumAge: 0,           // Do not use cached positions
                    timeout: 10000           // Timeout after 10 seconds
                }
            );
        }, updateInterval); // Use the update interval set by the host
    } else {
        alert("Geolocation is not supported by your browser.");
    }
}

function setIntervalFromHost() {
    // Host sets location update interval
    const intervalInput = document.getElementById('interval');
    if (!intervalInput) {
        console.error("Interval input element not found.");
        return;
    }

    const interval = parseInt(intervalInput.value);
    if (!isNaN(interval)) {
        const validatedInterval = Math.max(interval, 10000); // Enforce a minimum of 10 seconds
        socket.emit('setUpdateInterval', validatedInterval);
    } else {
        alert("Please enter a valid number for the interval.");
    }
}

// --- Geofence Logic ---
function isInsideGeofence(user) {
    if (!user || !user.location || typeof user.location.lat !== 'number' || typeof user.location.lng !== 'number') {
        return true; // Treat users with invalid or null locations as inside geofence
    }

    if (boxList.length === 0) {
        return true; // No boxes on the map, treat as inside geofence
    }

    for (const box of boxList) {
        const bounds = L.latLngBounds(
            L.latLng(box.southWest.lat, box.southWest.lng),
            L.latLng(box.northEast.lat, box.northEast.lng)
        );

        if (bounds.contains([user.location.lat, user.location.lng])) {
            return true;
        }
    }

    return false; // User is outside all geofence boxes
}

function showWarning(message) {
    const warningDiv = document.getElementById('warning');
    warningDiv.textContent = message;
    warningDiv.style.display = 'flex';
    warningDiv.style.justifyContent = 'center';
    warningDiv.style.alignItems = 'center';
}

function hideWarning() {
    const warningDiv = document.getElementById('warning');
    warningDiv.style.display = 'none';
}

function updateUserList(users) {
    const userList = document.getElementById('userList');
    userList.innerHTML = '';

    Object.entries(users).forEach(([id, user]) => {
        if (!user.location) {
            console.warn(`Skipping user with null location: ${id}`);
            return; // Skip users without a valid location
        }

        const li = document.createElement('li');
        const inside = isInsideGeofence(user);
        li.textContent = user.name + (inside ? '' : ' ⚠️ OUTSIDE');
        userList.appendChild(li);

        // Show warning only if there are boxes on the map and the user is outside
        if (boxList.length > 0 && !inside) {
            showWarning(`⚠️ ${user.name} is outside the allowed area.`);
        } else {
            hideWarning();
        }
    });
}

// --- Map Bounds Check ---
function isInMapBounds(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number') {
        console.warn("Invalid lat/lng:", lat, lng);
        return false; // Or choose to return true to avoid false warnings
    }

    if (!map) return false; // Ensure map is initialized
    const bounds = map.getBounds();
    return bounds.contains([lat, lng]);
}

// --- Socket Events ---

// Update interval from host
socket.on('updateInterval', interval => {
    updateInterval = Math.max(interval, 10000); // Enforce a minimum of 10 seconds
    console.log(`Update interval set to ${updateInterval} ms`); // Debug log for interval update
    startLocationUpdates(); // Restart location updates with the new interval
});

// Update user list and markers
socket.on('userList', users => {
    console.log("Received user list:", users); // Debug log to inspect user data
    // Update user list and markers
    for (const id in markers) map.removeLayer(markers[id]); // Remove old markers
    markers = {};

    if (userListElement) userListElement.innerHTML = ''; // Clear user list UI
    for (const id in users) {
        const user = users[id];

        // Skip users with invalid or default locations
        if (!user.location || user.location.lat === 0 && user.location.lng === 0) {
            console.warn(`Skipping user with invalid location: ${id}`);
            continue;
        }

        const listItem = document.createElement('li');
        listItem.textContent = user.name;
        if (userListElement) userListElement.appendChild(listItem);

        const marker = L.marker([user.location.lat, user.location.lng]).addTo(map);
        marker.bindPopup(user.name);
        markers[id] = marker;
    }

    // Show host's box if present
    const host = Object.values(users).find(user => user.isHost);
    if (host && host.boxBounds) addBoxToMap(host.boxBounds);

    updateUserList(users); // Update the user list in the UI
});

socket.on('locationUpdate', ({ socketId, location }) => {
    console.log(`Location update received: socketId=${socketId}, location=`, location);
    if (markers[socketId]) {
        markers[socketId].setLatLng([location.lat, location.lng]); // Update marker position
    }
    const user = Object.values(users).find(u => u.socketId === socketId);
    if (user) {
        user.location = location; // Update user location in the client-side user list
        updateUserList(users); // Refresh the user list UI
    }
});

// Receive and display box list (last 5 boxes)
socket.on('boxList', (boxes) => {
    // Clear existing boxes and update the boxList array
    clearBox(); // Clear any drawn box on the map
    boxList.length = 0; // Clear the client-side box list
    boxList.push(...boxes); // Update the boxList array with the new data

    // Update the UI list
    if (boxListElement) {
        boxListElement.innerHTML = ''; // Clear the existing list
        boxList.forEach((box, index) => {
            const listItem = document.createElement('li');
            listItem.textContent = `Box ${index + 1}: SW(${box.southWest.lat.toFixed(4)}, ${box.southWest.lng.toFixed(4)}) NE(${box.northEast.lat.toFixed(4)}, ${box.northEast.lng.toFixed(4)})`;
            boxListElement.appendChild(listItem);
        });
    }

    // Add the latest box to the map
    if (boxList.length > 0) {
        const latestBox = boxList[boxList.length - 1];
        addBoxToMap(latestBox);
    }

    console.log('Updated box list:', boxList); // Log the updated box list to the console
});

// Receive new box from server
socket.on('newBox', (boxBounds) => {
    console.log('New box received:', boxBounds); // Debug log for new box
    boxList.push(boxBounds);
    if (boxList.length > 5) {
        boxList.shift(); // Keep only the last 5 boxes
    }

    // Update the UI list
    if (boxListElement) {
        boxListElement.innerHTML = ''; // Clear the existing list
        boxList.forEach((box, index) => {
            const listItem = document.createElement('li');
            listItem.textContent = `Box ${index + 1}: SW(${box.southWest.lat.toFixed(4)}, ${box.southWest.lng.toFixed(4)}) NE(${box.northEast.lat.toFixed(4)}, ${box.northEast.lng.toFixed(4)})`;
            boxListElement.appendChild(listItem);
        });
    }

    // Add the new box to the map
    addBoxToMap(boxBounds);

    console.log('Updated box list:', boxList); // Debug log for updated box list
});

// Draw rectangle from server event
socket.on('draw-rectangle', (data) => {
    addBoxToMap(data);
});

// Show warning message from server
socket.on('showWarning', () => {
  warningBanner.style.display = 'block';
});

socket.on('hideWarning', () => {
  warningBanner.style.display = 'none';
});

// --- UI Event Listeners ---
if (clearBoxButton) clearBoxButton.addEventListener('click', clearBox);

document.getElementById('joinBtn').addEventListener('click', () => {
    const lobbyId = document.getElementById('lobbyIdInput').value;
    const playerName = document.getElementById('nameInput').value;
    const isHost = document.getElementById('hostCheckbox').checked;
  
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser');
      return;
    }
  
    navigator.geolocation.getCurrentPosition(
      position => {
        const coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
  
        // Gem og send lokation sammen med resten
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-content').style.display = 'block';
  
        // Tilpas denne funktion så den tager imod coords
        joinLobby(lobbyId, playerName, isHost, coords);
      },
      error => {
        alert('Could not get your location. Please allow location access.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
  
  function sendLocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(position => {
        socket.emit('updateLocation', {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
      });
    }
  }
  

// Call this function when the page loads or when the user joins the lobby
document.addEventListener('DOMContentLoaded', requestLocationPermission);

// Warning banner for outside play area
const warningBanner = document.createElement('div');
warningBanner.id = 'warningBanner';
warningBanner.textContent = "⚠️ Someone is outside the play area!";
warningBanner.style.position = 'fixed';
warningBanner.style.top = '0';
warningBanner.style.left = '0';
warningBanner.style.width = '100%';
warningBanner.style.backgroundColor = 'red';
warningBanner.style.color = 'white';
warningBanner.style.fontSize = '1.5em';
warningBanner.style.textAlign = 'center';
warningBanner.style.padding = '10px';
warningBanner.style.zIndex = '1000';
warningBanner.style.display = 'none';
document.body.appendChild(warningBanner);

document.body.style.overscrollBehavior = 'none';
document.addEventListener('touchstart', (e) => {
  if (e.target.closest('#map')) {
    e.preventDefault();
  }
}, { passive: false });

document.addEventListener('touchmove', function (e) {
  if (e.target.closest('#map')) {
    e.preventDefault();
  }
}, { passive: false });

map.on('touchstart', function (e) {
  const touch = e.originalEvent.touches[0];
  const latlng = map.containerPointToLatLng(L.point(touch.clientX, touch.clientY));
  startBox({ latlng });
});

map.on('touchmove', function (e) {
  const touch = e.originalEvent.touches[0];
  const latlng = map.containerPointToLatLng(L.point(touch.clientX, touch.clientY));
  updateBox({ latlng });
});

map.on('touchend', function (e) {
  finishBox();
});