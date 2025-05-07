const socket = io();
let map, drawnBox = null, tempBox = null;
let lobbyId, userName, isHost, updateInterval = 5000;
let markers = {};
let locationUpdateIntervalId = null;
const boxList = []; // List of all boxes (usually only one is shown)

// --- UI Elements ---
const intervalControl = document.getElementById('intervalControl');
const userListElement = document.getElementById('userList');
const boxListElement = document.getElementById('boxList');
const clearBoxButton = document.getElementById('clearBoxButton');

// --- Lobby Join ---
function joinLobby() {
    lobbyId = document.getElementById('lobbyId').value;
    userName = document.getElementById('userName').value;
    isHost = document.getElementById('isHost').checked;

    if (!lobbyId || !userName) return alert("Fill all fields!");

    socket.emit('joinLobby', { lobbyId, userName, isHost });
    if (isHost && intervalControl) intervalControl.style.display = 'block';
    initMap();
    // Start location updates only after a user gesture
    document.getElementById('map').addEventListener('click', startLocationUpdates, { once: true });
}

// --- Map Initialization ---
function initMap() {
    if (map) return; // Prevent re-initialization
    map = L.map('map').setView([0, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    addDrawingControl();
    addDeleteBoxControl();
}

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
    // Only host can draw
    if (!isHost) return console.warn("Only the host can draw the playing area.");
    // Start drawing on mousedown
    map.once('mousedown', function(e) {
        const startLatLng = e.latlng;
        tempBox = L.rectangle([startLatLng, startLatLng], { color: 'blue', weight: 2 }).addTo(map);

        function onMove(moveEvent) {
            tempBox.setBounds([startLatLng, moveEvent.latlng]);
        }
        function onMouseUp(endEvent) {
            map.off('mousemove', onMove);
            map.removeLayer(tempBox);
            tempBox = null;
            if (drawnBox) map.removeLayer(drawnBox);
            const bounds = L.latLngBounds(startLatLng, endEvent.latlng);
            drawnBox = L.rectangle(bounds, { color: 'red', weight: 2 }).addTo(map);
            // Emit box bounds to server
            socket.emit('draw-rectangle', {
                southWest: bounds.getSouthWest(),
                northEast: bounds.getNorthEast()
            });
        }
        map.on('mousemove', onMove);
        map.once('mouseup', onMouseUp);
    });
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
    // Send location to server at set interval
    if (locationUpdateIntervalId) clearInterval(locationUpdateIntervalId);
    locationUpdateIntervalId = setInterval(() => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(position => {
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
            });
        }
    }, updateInterval);
}

function setIntervalFromHost() {
    // Host sets location update interval
    const interval = parseInt(document.getElementById('interval').value);
    if (!isNaN(interval)) socket.emit('setUpdateInterval', interval);
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
    updateInterval = interval;
    startLocationUpdates();
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
        const listItem = document.createElement('li');
        listItem.textContent = user.name;
        if (userListElement) userListElement.appendChild(listItem);

        if (user.location) {
            const marker = L.marker([user.location.lat, user.location.lng]).addTo(map);
            marker.bindPopup(user.name);
            markers[id] = marker;
        }
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

// --- UI Event Listeners ---
if (clearBoxButton) clearBoxButton.addEventListener('click', clearBox);

// --- Notes ---
// - Only one rectangle (box) is shown at a time on the map.
// - Only the host can draw a box.
// - All drawing is handled via Leaflet, not canvas.
// - Code is simplified for clarity and maintainability.

function requestLocationPermission() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                console.log("Location permission granted:", position);
            },
            (error) => {
                console.error("Error requesting location permission:", error.message);
                alert("Please enable location permissions for this app to work correctly.");
            }
        );
    } else {
        alert("Geolocation is not supported by your browser.");
    }
}

// Call this function when the page loads or when the user joins the lobby
document.addEventListener('DOMContentLoaded', requestLocationPermission);