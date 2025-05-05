const socket = io();
let map, marker;
let lobbyId, userName, isHost, updateInterval = 5000;
let markers = {};

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
    map = L.map('map').setView([0, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
}

function startLocationUpdates() {
    setInterval(() => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(position => {
                const coords = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                socket.emit('locationUpdate', coords);
            });
        }
    }, updateInterval);
}

function setIntervalFromHost() {
    const interval = parseInt(document.getElementById('interval').value);
    if (!isNaN(interval)) socket.emit('setUpdateInterval', interval);
}

socket.on('updateInterval', interval => {
    updateInterval = interval;
});

socket.on('userList', users => {
    for (const id in markers) {
        map.removeLayer(markers[id]);
    }
    markers = {};

    for (const id in users) {
        const user = users[id];
        if (user.location) {
            const marker = L.marker([user.location.lat, user.location.lng]).addTo(map);
            marker.bindPopup(user.name);
            markers[id] = marker;
        }
    }
});