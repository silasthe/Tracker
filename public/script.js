const socket = io();
let map, marker;
let lobbyId, userName, isHost, updateInterval = 5000;
let markers = {};
let drawnBox = null;
let locationUpdateIntervalId = null;
let tempBox = null; // Track the temporary rectangle during drawing
const boxList = []; // Maintain a list of all boxes

let rectangle = null;
let drawingRect = false;
let rectStartLatLng = null;

// Canvas setup
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let drawing = false;
let startX, startY;

// Host draws a box
canvas.addEventListener('mousedown', (e) => {
    drawing = true;
    startX = e.offsetX;
    startY = e.offsetY;
});

canvas.addEventListener('mouseup', (e) => {
    if (!drawing) return;
    drawing = false;
    const endX = e.offsetX;
    const endY = e.offsetY;
    const box = {
        x: Math.min(startX, endX),
        y: Math.min(startY, endY),
        width: Math.abs(endX - startX),
        height: Math.abs(endY - startY)
    };
    drawBox(box);
    socket.emit('draw-box', box); // Send to server
});

// Draw box on canvas
function drawBox(box) {
    ctx.strokeStyle = 'red';
    ctx.strokeRect(box.x, box.y, box.width, box.height);
}

// Listen for box events from server
socket.on('draw-box', (box) => {
    drawBox(box);
});

function joinLobby() {
    lobbyId = document.getElementById('lobbyId').value;
    userName = document.getElementById('userName').value;
    isHost = document.getElementById('isHost').checked;

    if (!lobbyId || !userName) return alert("Fill all fields!");

    socket.emit('joinLobby', { lobbyId, userName, isHost });
    if (isHost) document.getElementById('intervalControl').style.display = 'block';
    initMap();
    startLocationUpdates();
}

function initMap() {
    if (map) {
        console.warn("Map is already initialized.");
        return;
    }
    console.log("Initializing map...");
    map = L.map('map').setView([0, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    console.log("Map initialized.");
}

function addDrawingControl() {
    const DrawingControl = L.Control.extend({
        options: {
            position: 'topleft' // Position it under the zoom controls
        },
        onAdd: function () {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
            const button = L.DomUtil.create('a', '', container);
            button.innerHTML = '□';
            button.title = 'Enable Drawing Mode';
            button.href = '#';
            button.style.width = '30px'; // Match the size of the zoom buttons
            button.style.height = '30px'; // Match the size of the zoom buttons
            button.style.lineHeight = '30px'; // Center the text vertically
            button.style.textAlign = 'center'; // Center the text horizontally
            button.style.fontSize = '18px'; // Match the font size of the zoom buttons

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
    const DeleteBoxControl = L.Control.extend({
        options: {
            position: 'topleft' // Position it under the drawing button
        },
        onAdd: function () {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
            const button = L.DomUtil.create('a', '', container);
            button.innerHTML = '✖'; // Use an "X" symbol for delete
            button.title = 'Delete Box';
            button.href = '#';
            button.style.width = '30px'; // Match the size of the zoom buttons
            button.style.height = '30px';
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

function startLocationUpdates() {
    console.log("Starting location updates...");
    if (locationUpdateIntervalId) {
        clearInterval(locationUpdateIntervalId);
        console.log("Cleared existing location update interval.");
    }

    locationUpdateIntervalId = setInterval(() => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(position => {
                const coords = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                console.log("Location obtained:", coords);
                socket.emit('locationUpdate', coords);
            }, error => {
                console.error("Error obtaining location:", error);
            });
        } else {
            console.warn("Geolocation is not supported by this browser.");
        }
    }, updateInterval);
}

function setIntervalFromHost() {
    const interval = parseInt(document.getElementById('interval').value);
    if (!isNaN(interval)) {
        console.log("Setting update interval to:", interval);
        socket.emit('setUpdateInterval', interval);
    } else {
        console.warn("Invalid interval value entered.");
    }
}

socket.on('updateInterval', interval => {
    console.log("Update interval received from host:", interval);
    updateInterval = interval;
    startLocationUpdates(); // Restart location updates with the new interval
});

socket.on('userList', users => {
    console.log("Received updated user list:", users);
    for (const id in markers) {
        map.removeLayer(markers[id]);
    }
    markers = {};

    // Update the user list in the UI
    const userListElement = document.getElementById('userList');
    userListElement.innerHTML = ''; // Clear the existing list
    for (const id in users) {
        const user = users[id];
        const listItem = document.createElement('li');
        listItem.textContent = user.name;
        userListElement.appendChild(listItem);

        if (user.location) {
            console.log(`Adding marker for user: ${user.name} at location:`, user.location);
            const marker = L.marker([user.location.lat, user.location.lng]).addTo(map);
            marker.bindPopup(user.name);
            markers[id] = marker;
        }
    }

    // Check if the host has drawn a box and display it
    const host = Object.values(users).find(user => user.isHost);
    if (host && host.boxBounds) {
        console.log("Host has drawn a box. Displaying it on the map:", host.boxBounds);
        if (drawnBox) {
            map.removeLayer(drawnBox);
        }
        drawnBox = L.rectangle([
            [host.boxBounds.southWest.lat, host.boxBounds.southWest.lng],
            [host.boxBounds.northEast.lat, host.boxBounds.northEast.lng]
        ], { color: 'red', weight: 2 }).addTo(map);
    }
});

socket.on('boxList', (boxes) => {
    boxList.length = 0; // Clear the array
    const boxListElement = document.getElementById('boxList');
    boxListElement.innerHTML = ''; // Clear the HTML list

    boxes.forEach((boxBounds, idx) => {
        boxList.push(boxBounds);
        addBoxToMap(boxBounds);
        // Add to HTML
        const listItem = document.createElement('li');
        listItem.textContent = `Box ${idx + 1}: SW(${boxBounds.southWest.lat.toFixed(4)}, ${boxBounds.southWest.lng.toFixed(4)}) NE(${boxBounds.northEast.lat.toFixed(4)}, ${boxBounds.northEast.lng.toFixed(4)})`;
        boxListElement.appendChild(listItem);
    });
});

socket.on('newBox', (boxBounds) => {
    boxList.push(boxBounds);
    addBoxToMap(boxBounds);
    // Add to HTML
    const boxListElement = document.getElementById('boxList');
    const listItem = document.createElement('li');
    listItem.textContent = `Box ${boxList.length}: SW(${boxBounds.southWest.lat.toFixed(4)}, ${boxBounds.southWest.lng.toFixed(4)}) NE(${boxBounds.northEast.lat.toFixed(4)}, ${boxBounds.northEast.lng.toFixed(4)})`;
    boxListElement.appendChild(listItem);
});

function addBoxToMap(boxBounds) {
    L.rectangle([
        [boxBounds.southWest.lat, boxBounds.southWest.lng],
        [boxBounds.northEast.lat, boxBounds.northEast.lng]
    ], { color: 'red', weight: 2 }).addTo(map);
}

document.addEventListener('DOMContentLoaded', () => {
    // Initialize the map and add the drawing control after the map is ready
    initMap();
    addDrawingControl();
    addDeleteBoxControl();
});

// Host draws rectangle and emits bounds
if (isHost) {
    map.on('mousedown', function(e) {
        drawingRect = true;
        rectStartLatLng = e.latlng;
        if (rectangle) {
            map.removeLayer(rectangle);
            rectangle = null;
        }
    });

    map.on('mousemove', function(e) {
        if (!drawingRect) return;
        if (rectangle) map.removeLayer(rectangle);
        rectangle = L.rectangle([rectStartLatLng, e.latlng], {color: "red", weight: 2, fillOpacity: 0.2}).addTo(map);
    });

    map.on('mouseup', function(e) {
        if (!drawingRect) return;
        drawingRect = false;
        if (rectangle) {
            const bounds = rectangle.getBounds();
            socket.emit('draw-rectangle', {
                southWest: bounds.getSouthWest(),
                northEast: bounds.getNorthEast()
            });
        }
    });
}

// All clients (host and users) listen for rectangle event and draw it
socket.on('draw-rectangle', (data) => {
    if (rectangle) map.removeLayer(rectangle);
    rectangle = L.rectangle([
        [data.southWest.lat, data.southWest.lng],
        [data.northEast.lat, data.northEast.lng]
    ], {color: "red", weight: 2, fillOpacity: 0.2}).addTo(map);
});

function enableDrawingMode() {
    if (!isHost) {
        console.warn("Only the host can draw the playing area.");
        return;
    }
    console.log("Drawing mode enabled. Click and drag to draw a box.");
    map.on('mousedown', startDrawing);
}

function startDrawing(e) {
    const startLatLng = e.latlng;
    console.log("Drawing started at:", startLatLng);

    if (tempBox) {
        map.removeLayer(tempBox); // Remove any existing temporary rectangle
    }

    tempBox = L.rectangle([startLatLng, startLatLng], { color: 'blue', weight: 2 }).addTo(map);

    map.on('mousemove', (moveEvent) => {
        const endLatLng = moveEvent.latlng;
        tempBox.setBounds([startLatLng, endLatLng]);
    });

    map.once('mouseup', (endEvent) => {
        const endLatLng = endEvent.latlng;
        console.log("Drawing ended at:", endLatLng);

        if (drawnBox) {
            map.removeLayer(drawnBox); // Remove the previous finalized box
        }
        drawnBox = L.rectangle([startLatLng, endLatLng], { color: 'red', weight: 2 }).addTo(map);
        console.log("Final box bounds:", drawnBox.getBounds());

        // Broadcast the box bounds to the server
        const boxBounds = drawnBox.getBounds();
        socket.emit('drawBox', {
            northEast: boxBounds.getNorthEast(),
            southWest: boxBounds.getSouthWest()
        });

        map.off('mousemove');
        map.off('mousedown');
        map.removeLayer(tempBox); // Remove the temporary rectangle after finalizing
        tempBox = null; // Clear the temporary rectangle reference
    });
}

socket.on('updateBox', (boxBounds) => {
    console.log("Received updated box bounds from host:", boxBounds);
    if (drawnBox) {
        map.removeLayer(drawnBox); // Remove any existing box
    }
    // Add the new box to the map
    drawnBox = L.rectangle([
        [boxBounds.southWest.lat, boxBounds.southWest.lng],
        [boxBounds.northEast.lat, boxBounds.northEast.lng]
    ], { color: 'red', weight: 2 }).addTo(map);
    console.log("Box added to the map.");
});

function clearBox() {
    if (drawnBox) {
        map.removeLayer(drawnBox); // Remove the finalized box
        drawnBox = null;
        console.log("Finalized box cleared.");
    }
    if (tempBox) {
        map.removeLayer(tempBox); // Remove the temporary rectangle
        tempBox = null;
        console.log("Temporary box cleared.");
    }
}

document.getElementById('clearBoxButton').addEventListener('click', clearBox);