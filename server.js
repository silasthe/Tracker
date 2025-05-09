const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(path.join(__dirname, 'public')));

const lobbies = {};
const userStates = {}; // In-memory store to track user states (inside or outside)

io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`); // Debug log for new connection

    socket.on('joinLobby', ({ lobbyId, userName, isHost, latitude, longitude }) => {
        console.log(`joinLobby event: socketId=${socket.id}, lobbyId=${lobbyId}, userName=${userName}, isHost=${isHost}, latitude=${latitude}, longitude=${longitude}`); // Debug log for joinLobby

        socket.join(lobbyId);
        socket.lobbyId = lobbyId;
        socket.userName = userName;
        socket.isHost = isHost;
        socket.updateInterval = 10000;

        if (!lobbies[lobbyId]) {
            lobbies[lobbyId] = { users: {}, boxes: [] };
            console.log(`Created new lobby: ${lobbyId}`); // Debug log for new lobby creation
        }

        // Register the user in the lobby after lobbyId is defined, with location if provided
        lobbies[lobbyId].users[socket.id] = { 
            name: userName, 
            location: (typeof latitude === "number" && typeof longitude === "number")
                ? { latitude, longitude }
                : null,
            interval: 10000, 
            isHost 
        };

        if (isHost) {
            console.log(`Host ${userName} reconnected. Clearing box list for lobby ${lobbyId}.`); // Debug log for host reconnection
            lobbies[lobbyId].boxes = [];
            io.to(lobbyId).emit('boxList', []);
        }

        const boxes = lobbies[lobbyId].boxes.slice(-5);
        socket.emit('boxList', boxes);
        console.log(`Sent last 5 boxes to ${userName}:`, boxes); // Debug log for box list

        io.to(lobbyId).emit('userList', Object.fromEntries(
            Object.entries(lobbies[lobbyId].users).filter(([_, user]) => user.location && user.location.lat !== 0 && user.location.lng !== 0)
        ));
        console.log(`Updated user list for lobby ${lobbyId}:`, lobbies[lobbyId].users); // Debug log for user list

        // Find the host's interval for this lobby
        const host = Object.values(lobbies[lobbyId].users).find(u => u.isHost);
        if (host && host.interval) {
            // Send the current interval to the new user
            socket.emit('updateInterval', host.interval);

            // Update the new user's interval property to match the host's
            lobbies[lobbyId].users[socket.id].interval = host.interval;
        }

        socket.on('updateLocation', ({ latitude, longitude }) => {
            const lobbyId = socket.lobbyId;
            if (lobbyId && lobbies[lobbyId] && lobbies[lobbyId].users[socket.id]) {
                lobbies[lobbyId].users[socket.id].location = { latitude, longitude };
                console.log(`Updated location for ${socket.userName}:`, latitude, longitude);
            }
        });
        
    });

    socket.on('locationUpdate', (location) => {
        console.log(`locationUpdate event: socketId=${socket.id}, location=${JSON.stringify(location)}`); // Debug log for location update
        const lobby = lobbies[socket.lobbyId];
        if (lobby && lobby.users[socket.id]) {
            // Update the user's location
            lobby.users[socket.id].location = location;

            // Broadcast the updated user list to the lobby
            io.to(socket.lobbyId).emit('userList', lobby.users);
            console.log(`Updated location for user ${socket.userName} in lobby ${socket.lobbyId}`); // Debug log for location update
        }
    });
    
    socket.on('setUpdateInterval', (interval) => {
        console.log(`setUpdateInterval event: socketId=${socket.id}, interval=${interval}`); // Debug log for event trigger
        if (socket.isHost) {
            const validatedInterval = Math.max(interval, 10000); // Enforce a minimum of 10 seconds
            console.log(`Host ${socket.userName} set update interval to ${validatedInterval} ms`); // Debug log for host action

            // Update the interval for all users in the lobby
            const lobby = lobbies[socket.lobbyId];
            if (lobby) {
                for (const id in lobby.users) {
                    lobby.users[id].interval = validatedInterval;
                }
            }

            io.to(socket.lobbyId).emit('updateInterval', validatedInterval); // Broadcast the new interval to all clients
            console.log(`Broadcasted new update interval to lobby ${socket.lobbyId}`); // Debug log for broadcast
        } else {
            console.warn(`Non-host user ${socket.userName} attempted to set update interval.`); // Warning for unauthorized action
        }
    });

    socket.on('draw-rectangle', (bounds) => {
        console.log(`draw-rectangle event: socketId=${socket.id}, bounds=${JSON.stringify(bounds)}`); // Debug log for event trigger
        if (socket.isHost) {
            console.log(`Host ${socket.userName} drew a new box:`, bounds); // Debug log for new box
            lobbies[socket.lobbyId].boxes.push(bounds);
            if (lobbies[socket.lobbyId].boxes.length > 5) {
                lobbies[socket.lobbyId].boxes.shift();
            }
            io.to(socket.lobbyId).emit('newBox', bounds);
            io.to(socket.lobbyId).emit('boxList', lobbies[socket.lobbyId].boxes);
            console.log(`Updated box list for lobby ${socket.lobbyId}:`, lobbies[socket.lobbyId].boxes); // Debug log for updated box list
        } else {
            console.warn(`Non-host user ${socket.userName} attempted to draw a box.`); // Warning for unauthorized action
        }
    });

    socket.on('disconnect', () => {
        console.log(`Disconnect event: socketId=${socket.id}`); // Debug log for disconnection
        const lobby = lobbies[socket.lobbyId];
        if (lobby) {
            delete lobby.users[socket.id];
            // Filter out users with invalid locations before broadcasting
            const filteredUsers = Object.fromEntries(
                Object.entries(lobby.users).filter(([_, user]) => user.location && user.location.lat !== 0 && user.location.lng !== 0)
            );
            io.to(socket.lobbyId).emit('userList', filteredUsers);
            console.log(`Removed user ${socket.userName} from lobby ${socket.lobbyId}`); // Debug log for user removal
        }
    });
});

// Haversine formula to check if a point is inside a circular geofence
function checkIfInside(lat, lng, centerLat, centerLng, radius) {
    const toRadians = (degrees) => degrees * (Math.PI / 180);
    const earthRadius = 6371000; // Earth's radius in meters

    const dLat = toRadians(lat - centerLat);
    const dLng = toRadians(lng - centerLng);

    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRadians(centerLat)) * Math.cos(toRadians(lat)) *
              Math.sin(dLng / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = earthRadius * c;

    return distance <= radius; // Returns true if within the radius
}

// Modify the /location route to handle geofence entry/exit
app.post("/location", (req, res) => {
    const { userId, lat, lng } = req.body;

    const centerLat = YOUR_CENTER_LAT; // Replace with your geofence center latitude
    const centerLng = YOUR_CENTER_LNG; // Replace with your geofence center longitude
    const radius = YOUR_RADIUS_METERS; // Replace with your geofence radius in meters

    const isInside = checkIfInside(lat, lng, centerLat, centerLng, radius);
    const newState = isInside ? "inside" : "outside";
    const prevState = userStates[userId];

    if (prevState !== newState) {
        console.log(`${userId} ${prevState || "unknown"} → ${newState}`);
        // Add custom logic here for entry/exit events
    }

    if (newState === "outside") {
        console.warn(`Warning: User ${userId} is outside the boundaries!`);
        // Emit warning to the specific user if they are connected via socket
        const userSocket = Object.keys(lobbies).flatMap(lobbyId =>
            Object.entries(lobbies[lobbyId].users)
                .filter(([id, user]) => user.name === userId)
                .map(([id]) => id)
        )[0];
        if (userSocket && io.sockets.sockets.get(userSocket)) {
            io.sockets.sockets.get(userSocket).emit('showWarning', "⚠️ OUTSIDE");
        }
    }

    userStates[userId] = newState; // Update the user's state

    res.send({ status: newState });
});

server.listen(3000, () => {
    console.log('Server running at http://localhost:3000'); // Debug log for server start
});